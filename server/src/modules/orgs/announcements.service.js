const prisma = require('../../config/db');
const { todayIst } = require('../../lib/istDate');
const env = require('../../config/env');
const logger = require('../../config/logger');

const DAY = 86400000;

/** The next time a month/day falls on or after `today` (UTC-midnight dates). 29 Feb is celebrated on 28 Feb in other years. */
function nextOccurrence(date, today) {
  const month = date.getUTCMonth();
  let day = date.getUTCDate();
  const make = (year) => {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return new Date(Date.UTC(year, month, month === 1 && day === 29 && !isLeap ? 28 : day));
  };
  let next = make(today.getUTCFullYear());
  if (next < today) next = make(today.getUTCFullYear() + 1);
  return next;
}

/**
 * Upcoming birthdays and work anniversaries of the company's employees in the next `days` days (today included).
 * Contractors, people who left and deleted people are left out. A birthday carries no year; an anniversary carries the
 * number of years (an employee who joined this year has none yet).
 */
async function upcoming(orgId, { days = 14, today = todayIst(), viewerMembershipId = null } = {}) {
  const people = await prisma.orgMembership.findMany({
    where: { org_id: orgId, worker_type: { not: 'contractor' }, employment_status: { in: ['active', 'on_leave', 'notice_period'] } },
    select: { id: true, date_of_birth: true, joined_at: true, person: { select: { name: true } }, department: { select: { name: true } } },
  });
  const birthdays = [];
  const anniversaries = [];
  for (const p of people) {
    if (p.date_of_birth) {
      const next = nextOccurrence(p.date_of_birth, today);
      const away = Math.round((next - today) / DAY);
      if (away <= days) birthdays.push({ org_membership_id: p.id, name: p.person?.name || null, department: p.department?.name || null, date: next.toISOString().slice(0, 10), days_away: away });
    }
    if (p.joined_at) {
      const next = nextOccurrence(p.joined_at, today);
      const away = Math.round((next - today) / DAY);
      const years = next.getUTCFullYear() - p.joined_at.getUTCFullYear();
      if (away <= days && years >= 1) anniversaries.push({ org_membership_id: p.id, name: p.person?.name || null, department: p.department?.name || null, date: next.toISOString().slice(0, 10), days_away: away, years });
    }
  }
  const order = (a, b) => a.days_away - b.days_away || String(a.name).localeCompare(String(b.name));

  // Wishes exist only for today's celebrations: read for today only (older rows are also deleted nightly), shown when the card row is opened.
  const wishes = await prisma.celebrationWish.findMany({
    where: { org_id: orgId, on_date: today },
    orderBy: { created_at: 'asc' },
    select: { org_membership_id: true, kind: true, from_membership_id: true, message: true, gif_url: true, created_at: true, sender: { select: { person: { select: { name: true } } } } },
  });
  const decorate = (item, kind) => {
    item.is_me = item.org_membership_id === viewerMembershipId;
    if (item.days_away !== 0) return item;
    const mine = wishes.filter((w) => w.org_membership_id === item.org_membership_id && w.kind === kind);
    item.wishes = mine.map((w) => ({ from_name: w.sender?.person?.name || 'A colleague', message: w.message, gif_url: w.gif_url, at: w.created_at, is_mine: w.from_membership_id === viewerMembershipId }));
    item.wished_by_me = mine.some((w) => w.from_membership_id === viewerMembershipId);
    return item;
  };
  return {
    days,
    birthdays: birthdays.sort(order).map((i) => decorate(i, 'birthday')),
    anniversaries: anniversaries.sort(order).map((i) => decorate(i, 'anniversary')),
  };
}

const DEFAULT_WISH = { birthday: 'Happy birthday! 🎂', anniversary: 'Happy work anniversary! 🎉' };

/**
 * `user` wishes a colleague on today's birthday / work anniversary (one wish per person per celebration). Only today's celebrations can be wished,
 * never your own. The celebrant gets a bell notification (not copied to the admins).
 */
async function sendWish(orgId, user, { org_membership_id, kind, message, gif_url }, { today = todayIst() } = {}) {
  if (org_membership_id === user.org_membership_id) return { error: 'self' };
  const data = await upcoming(orgId, { days: 0, today });
  const list = kind === 'birthday' ? data.birthdays : data.anniversaries;
  const target = list.find((i) => i.org_membership_id === org_membership_id);
  if (!target) return { error: 'not_today' };
  // A GIF can stand in for the text; with neither, the default line is used.
  const text = String(message || '').trim() || (gif_url ? '' : DEFAULT_WISH[kind]);
  try {
    await prisma.celebrationWish.create({ data: { org_id: orgId, org_membership_id, kind, on_date: today, from_membership_id: user.org_membership_id, message: text, gif_url: gif_url || null } });
  } catch (err) {
    if (err.code === 'P2002') return { error: 'already_wished' };
    throw err;
  }
  const celebrant = await prisma.orgMembership.findUnique({ where: { id: org_membership_id }, select: { person_id: true } });
  const { notify } = require('../../lib/notifications');
  await notify(prisma, { type: 'celebration_wish', actorId: user.id, recipientIds: [celebrant?.person_id].filter(Boolean), context: { actorName: user.name, kind, message: text, hasGif: Boolean(gif_url), skipAdmins: true, metadata: { org_membership_id } } });
  return { ok: true };
}

/** Wishes are only for their own day: drop every wish from an earlier day (nightly job; reads are already limited to today). */
async function purgeOldWishes({ today = todayIst() } = {}) {
  const { count } = await prisma.celebrationWish.deleteMany({ where: { on_date: { lt: today } } });
  return { deleted: count };
}

// GIF suggestions for what the person is typing (Giphy, G-rated). The key stays on the server; unset = {enabled:false}. Small in-memory cache so
// typing does not hit Giphy for every keystroke of the same words.
const gifCache = new Map();
const GIF_CACHE_MS = 10 * 60 * 1000;

async function searchGifs(q) {
  const key = env.gifs.apiKey;
  if (!key) return { enabled: false, results: [] };
  const term = String(q).trim().toLowerCase();
  const hit = gifCache.get(term);
  if (hit && Date.now() - hit.at < GIF_CACHE_MS) return { enabled: true, results: hit.results };
  try {
    const url = `https://api.giphy.com/v1/gifs/search?${new URLSearchParams({ api_key: key, q: term, limit: '8', rating: 'g', lang: 'en', bundle: 'messaging_non_clips' })}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`giphy ${res.status}`);
    const body = await res.json();
    const results = (body.data || []).map((g) => ({
      id: g.id,
      title: g.title || '',
      url: g.images?.fixed_height?.url,
      preview: g.images?.fixed_height_small?.url || g.images?.fixed_height?.url,
    })).filter((g) => g.url);
    if (gifCache.size > 200) gifCache.clear();
    gifCache.set(term, { at: Date.now(), results });
    return { enabled: true, results };
  } catch (err) {
    logger.warn('gif_search_failed', { err: err.message });
    return { enabled: true, results: [], unavailable: true };
  }
}

module.exports = { upcoming, nextOccurrence, sendWish, purgeOldWishes, searchGifs };
