const prisma = require('../../config/db');
const env = require('../../config/env');
const { codeKey } = require('./jobFields');

// The open jobs of the website, searchable. One loader, one ranking, used by the public careers pages and by Internal Jobs.
// The open set is read once and kept for a few seconds (the Jest suite never caches), then every search is an in-memory
// ranking of already lower-cased fields, so 300+ jobs cost a few milliseconds and no query per keystroke.

const OPEN = { status: 'published', requirement: { status: 'in_progress', deleted_at: null } };
// Everything an employee needs to judge a job, from the requirement. Never the budget, billing, client or owner.
const REQUIREMENT_SELECT = { id: true, job_description: true, description: true, designation: true, seats_total: true, primary_tech_stack: true, secondary_tech_stack: true, domain_experience: true, experience_min: true, experience_max: true, certifications_required: true, work_mode: true, work_location: true, time_zone_preference: true, contract_duration_months: true, notice_period_max_days: true, start_date_target: true, jd_document_url: true };

// A job's location is free text such as "Indore · On-site", "Remote · Remote" or "Gurgaon, Haryana & Ahmedabad".
// Everything after the "·" is how people work there (On-site / Remote / Hybrid), not a place, so the Location filter
// looks only at the part before it, splits it into separate places, and leaves out state names ("Haryana").
const STATES = new Set(['andhra pradesh', 'assam', 'bihar', 'chhattisgarh', 'delhi', 'goa', 'gujarat', 'haryana', 'himachal pradesh', 'jharkhand', 'karnataka', 'kerala', 'madhya pradesh', 'maharashtra', 'odisha', 'punjab', 'rajasthan', 'tamil nadu', 'telangana', 'uttar pradesh', 'uttarakhand', 'west bengal']);

function placesOf(job) {
  const base = String(job.location || '').split(/[·|]/)[0];
  const seen = new Set();
  const out = [];
  for (const part of base.split(/\s*(?:&|\/|;|,|\band\b)\s*/i)) {
    const name = part.trim();
    const key = name.toLowerCase();
    if (!name || STATES.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** How the job is worked, when the location says so ("On-site" in "Indore · On-site"); empty when it only repeats the place. */
function modeOf(job) {
  const rest = String(job.location || '').split(/[·|]/).slice(1).map((s) => s.trim()).filter(Boolean);
  const place = placesOf(job).map((p) => p.toLowerCase());
  return rest.find((m) => !place.includes(m.toLowerCase())) || '';
}

const lower = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** The posting plus the lower-cased text the search looks at. */
function indexRow(p) {
  const r = p.requirement || {};
  const skills = [...(r.primary_tech_stack || []), ...(r.secondary_tech_stack || [])];
  const places = placesOf(p);
  return {
    posting: p,
    org_slug: p.org?.slug || null,
    places,
    s_code: codeKey(p.job_code),
    s_title: lower(p.title),
    s_dept: lower(p.department),
    s_loc: lower(p.location),
    s_skills: lower(skills.join(' ')),
    s_desc: lower(`${p.public_description || ''} ${r.designation || ''} ${r.domain_experience || ''}`),
    created: p.created_at ? new Date(p.created_at).getTime() : 0,
  };
}

const cache = new Map();
const TTL_MS = 10000;

async function loadOpen(orgSlug) {
  const key = orgSlug || '*';
  const hit = cache.get(key);
  if (hit && env.nodeEnv !== 'test' && Date.now() - hit.at < TTL_MS) return hit.rows;
  const rows = (await prisma.websiteJobPosting.findMany({
    where: { ...OPEN, slug: { not: null }, ...(orgSlug ? { org: { slug: orgSlug } } : {}) },
    include: { requirement: { select: REQUIREMENT_SELECT }, org: { select: { slug: true } } },
    orderBy: { created_at: 'desc' },
  })).map(indexRow);
  // A company without recruitment requirements publishes plain jobs of its own (Hiring in its workspace); they are listed, searched
  // and opened by the same pages. `company_job` marks them so an application goes to that company's own table.
  if (orgSlug) {
    const own = await prisma.companyJob.findMany({ where: { status: 'published', deleted_at: null, org: { slug: orgSlug } }, include: { org: { select: { slug: true } } }, orderBy: { created_at: 'desc' } });
    rows.push(...own.map((j) => indexRow({ ...j, company_job: true, public_description: j.description, requirement: null })));
    rows.sort((a, b) => b.created - a.created);
  }
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

const wordHit = (text, phrase) => new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text);

/**
 * Relevance of one job for a query, 0 = not a match. Order: exact Job ID > partial Job ID > exact title > the whole phrase in
 * the title > every word in the title > the words spread over title, skills, department, location and description.
 * Every word of the query has to be found somewhere.
 */
function score(row, q, tokens, qKey) {
  if (qKey && row.s_code === qKey) return 1000;
  if (qKey.length >= 3 && (/\d/.test(qKey) || row.s_code.startsWith(qKey))) {
    if (row.s_code.startsWith(qKey)) return 900;
    if (row.s_code.includes(qKey)) return 880;
  }
  const all = `${row.s_title} ${row.s_dept} ${row.s_loc} ${row.s_skills} ${row.s_desc}`;
  if (!tokens.every((t) => all.includes(t))) return 0;
  if (row.s_title === q) return 800;
  if (wordHit(row.s_title, q)) return 700;
  if (row.s_title.includes(q)) return 600;
  const inTitle = tokens.filter((t) => row.s_title.includes(t)).length;
  if (inTitle === tokens.length) return 400 + 10 * tokens.length;
  let s = inTitle * 60;
  for (const t of tokens) {
    if (row.s_title.includes(t)) continue;
    if (row.s_skills.includes(t)) s += 40;
    else if (row.s_dept.includes(t)) s += 30;
    else if (row.s_loc.includes(t)) s += 30;
    else s += 10;
  }
  return Math.min(300, s) || 1;
}

const SORTS = ['relevance', 'newest', 'oldest', 'title'];
const csv = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map(lower).filter(Boolean);

/**
 * Filters (department / location), searches and sorts the open jobs of `orgSlug`, and returns one page. Facets count the
 * whole open set, so the filter lists do not jump around while someone types.
 */
async function search({ orgSlug, q, dept, loc, sort, page = 1, limit = 20 } = {}) {
  const all = await loadOpen(orgSlug);
  const query = lower(q);
  const tokens = query ? query.split(' ') : [];
  const qKey = codeKey(query);
  const depts = csv(dept);
  const locs = csv(loc);
  let hits = all
    .filter((r) => (!depts.length || depts.includes(r.s_dept)) && (!locs.length || r.places.some((p) => locs.includes(p.toLowerCase()))))
    .map((r) => ({ r, s: query ? score(r, query, tokens, qKey) : 1 }))
    .filter((x) => x.s > 0);
  const order = SORTS.includes(sort) ? sort : query ? 'relevance' : 'newest';
  const byNew = (a, b) => b.r.created - a.r.created;
  if (order === 'relevance') hits.sort((a, b) => b.s - a.s || byNew(a, b));
  else if (order === 'oldest') hits.sort((a, b) => -byNew(a, b));
  else if (order === 'title') hits.sort((a, b) => a.r.s_title.localeCompare(b.r.s_title) || byNew(a, b));
  else hits.sort(byNew);
  const size = Math.min(100, Math.max(1, Number(limit) || 20));
  const total = hits.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const at = Math.min(Math.max(1, Number(page) || 1), totalPages);
  hits = hits.slice((at - 1) * size, at * size);

  const departments = new Map();
  const places = new Map();
  for (const r of all) {
    if (r.posting.department) departments.set(r.posting.department, (departments.get(r.posting.department) || 0) + 1);
    for (const p of r.places) places.set(p, (places.get(p) || 0) + 1);
  }
  const facet = (m) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count }));
  return {
    rows: hits.map((x) => x.r),
    pagination: { page: at, limit: size, total, totalPages, open_total: all.length },
    facets: { departments: facet(departments), locations: facet(places) },
    sort: order,
  };
}

/** One open job by its slug, or by its Job ID ("DLP-0001"). */
async function findOpen({ orgSlug, slug, code }) {
  const rows = await loadOpen(orgSlug);
  if (slug) return rows.find((r) => r.posting.slug === String(slug).toLowerCase()) || null;
  const key = codeKey(code);
  return key ? rows.find((r) => r.s_code === key) || null : null;
}

module.exports = { OPEN, REQUIREMENT_SELECT, placesOf, modeOf, search, loadOpen, findOpen };
