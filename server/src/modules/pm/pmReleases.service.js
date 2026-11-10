const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const prisma = require('../../config/db');
const pm = require('./pm.service');

// Project Management > Releases and Commits: version control for a project (for Delphic One itself, the "Delphic One" project).
//  - a release is a version (1.4.0) with a status, the tickets that ship in it and the commits that went into it, and generated release notes
//  - a commit is recorded from git (the server's own checkout) or pushed by a CI step; "PRJ-001#12" in its message links it to ticket 12
// Managers (admin, project owner, project lead) create and release; every project member reads.

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const RELEASE_STATUSES = ['planned', 'in_progress', 'released', 'cancelled'];
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const toDate = (v) => (v ? new Date(`${v}T00:00:00.000Z`) : null);
const uuid = z.string().uuid();
const sha = z.string().trim().regex(/^[0-9a-f]{7,40}$/i, 'A commit id looks like 3f9c2ab');

const versionField = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/, 'Use letters, numbers and . - _ only, for example 1.4.0');
const releaseCreateSchema = z.object({
  version: versionField,
  name: z.string().trim().max(120).nullish(),
  planned_date: day.nullish(),
  notes: z.string().trim().max(10000).nullish(),
});
const releaseUpdateSchema = z.object({
  version: versionField.optional(),
  name: z.string().trim().max(120).nullish(),
  status: z.enum(RELEASE_STATUSES).optional(),
  planned_date: day.nullish(),
  notes: z.string().trim().max(10000).nullish(),
  git_tag: z.string().trim().max(100).nullish(),
  commit_sha: sha.nullish(),
  // marking a release "released": also take in the commits that no release has yet (up to the release commit, or now)
  include_unreleased_commits: z.boolean().optional(),
});
const commitInSchema = z.object({
  sha,
  message: z.string().trim().min(1).max(10000),
  author_name: z.string().trim().max(200).nullish(),
  author_email: z.string().trim().max(200).nullish(),
  committed_at: z.string().datetime({ offset: true }),
  branch: z.string().trim().max(200).nullish(),
  url: z.string().trim().url().max(500).nullish(),
});
const importSchema = z.object({ commits: z.array(commitInSchema).min(1).max(500) });
const syncSchema = z.object({ branch: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/, 'Not a valid branch name').optional(), days: z.number().int().min(1).max(365).optional() });
const idsSchema = z.object({ add: z.array(uuid).max(500).optional(), remove: z.array(uuid).max(500).optional() });

const iso = (d) => (d ? new Date(d).toISOString() : null);
const dayOf = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const firstLine = (m) => String(m || '').split('\n')[0].trim();

async function project(orgId, projectId, actor) {
  const p = await pm.loadProject(orgId, projectId, actor);
  if (!p) return { error: 'not_found' };
  return { project: p, canManage: await pm.canManageProject(actor, p) };
}
async function managed(orgId, projectId, actor) {
  const r = await project(orgId, projectId, actor);
  if (r.error) return r;
  if (!r.canManage) return { error: 'forbidden' };
  return r;
}
async function loadRelease(orgId, releaseId, actor, { manage = false } = {}) {
  const release = await prisma.pmRelease.findFirst({ where: { id: releaseId, org_id: orgId } });
  if (!release) return { error: 'not_found' };
  const r = manage ? await managed(orgId, release.project_id, actor) : await project(orgId, release.project_id, actor);
  if (r.error) return r;
  return { release, project: r.project, canManage: r.canManage };
}

const shapeRelease = (r, counts = {}) => ({
  id: r.id, project_id: r.project_id, version: r.version, name: r.name, status: r.status, planned_date: dayOf(r.planned_date), released_at: iso(r.released_at),
  git_tag: r.git_tag, commit_sha: r.commit_sha, notes: r.notes, created_at: r.created_at, ...counts,
});

/** Releases of a project, newest first, plus what is waiting to ship (commits and finished tickets that no release holds). */
async function listReleases(orgId, projectId, actor) {
  const r = await project(orgId, projectId, actor);
  if (r.error) return r;
  const [releases, commitCounts, tickets, unreleasedCommits] = await Promise.all([
    prisma.pmRelease.findMany({ where: { project_id: projectId }, orderBy: { created_at: 'desc' } }),
    prisma.pmCommit.groupBy({ by: ['release_id'], where: { project_id: projectId, release_id: { not: null } }, _count: { _all: true } }),
    prisma.pmTicket.findMany({ where: { project_id: projectId }, select: { release_id: true, status_key: true } }),
    prisma.pmCommit.count({ where: { project_id: projectId, release_id: null } }),
  ]);
  const cat = await pm.categoryResolver(orgId);
  const byCommits = new Map(commitCounts.map((c) => [c.release_id, c._count._all]));
  const stat = new Map();
  let waiting = 0;
  for (const t of tickets) {
    const done = cat(t.status_key) === 'done';
    if (!t.release_id) { if (done) waiting += 1; continue; }
    const s = stat.get(t.release_id) || { tickets: 0, tickets_done: 0 };
    s.tickets += 1;
    if (done) s.tickets_done += 1;
    stat.set(t.release_id, s);
  }
  return {
    can_manage: r.canManage,
    releases: releases.map((x) => shapeRelease(x, { commits: byCommits.get(x.id) || 0, tickets: stat.get(x.id)?.tickets || 0, tickets_done: stat.get(x.id)?.tickets_done || 0 })),
    waiting: { commits: unreleasedCommits, finished_tickets: waiting },
  };
}

async function createRelease(orgId, projectId, actor, input) {
  const r = await managed(orgId, projectId, actor);
  if (r.error) return r;
  if (await prisma.pmRelease.findUnique({ where: { project_id_version: { project_id: projectId, version: input.version } }, select: { id: true } })) return { error: 'duplicate_version' };
  const row = await prisma.pmRelease.create({ data: { org_id: orgId, project_id: projectId, version: input.version, name: input.name || null, planned_date: toDate(input.planned_date), notes: input.notes || null, created_by: actor.userId } });
  await pm.logActivity(prisma, orgId, projectId, null, actor.userId, 'release_created', null, row.version, null);
  return { release: shapeRelease(row) };
}

const shapeCommit = (c) => ({
  id: c.id, release_id: c.release_id, sha: c.sha, short: c.sha.slice(0, 7), subject: firstLine(c.message), message: c.message, author_name: c.author_name, author_email: c.author_email,
  committed_at: iso(c.committed_at), branch: c.branch, url: c.url, tickets: (c.tickets || []).map((x) => ({ id: x.ticket.id, number: x.ticket.number })),
});

async function shapeDetail(orgId, release, canManage) {
  const [tickets, commits, cat] = await Promise.all([
    prisma.pmTicket.findMany({ where: { release_id: release.id }, orderBy: { number: 'asc' }, select: { id: true, number: true, title: true, type: true, status_key: true, resolution: true } }),
    prisma.pmCommit.findMany({ where: { release_id: release.id }, orderBy: { committed_at: 'desc' }, include: { tickets: { select: { ticket: { select: { id: true, number: true } } } } } }),
    pm.categoryResolver(orgId),
  ]);
  return {
    ...shapeRelease(release),
    can_manage: canManage,
    tickets: tickets.map((t) => ({ ...t, done: cat(t.status_key) === 'done' })),
    commits: commits.map(shapeCommit),
  };
}

async function getRelease(orgId, releaseId, actor) {
  const r = await loadRelease(orgId, releaseId, actor);
  if (r.error) return r;
  return { release: await shapeDetail(orgId, r.release, r.canManage) };
}

async function updateRelease(orgId, releaseId, actor, input) {
  const r = await loadRelease(orgId, releaseId, actor, { manage: true });
  if (r.error) return r;
  const { release } = r;
  const data = {};
  if (input.version !== undefined && input.version !== release.version) {
    if (await prisma.pmRelease.findUnique({ where: { project_id_version: { project_id: release.project_id, version: input.version } }, select: { id: true } })) return { error: 'duplicate_version' };
    data.version = input.version;
  }
  for (const k of ['name', 'notes', 'git_tag']) if (input[k] !== undefined) data[k] = input[k] || null;
  if (input.planned_date !== undefined) data.planned_date = toDate(input.planned_date);
  if (input.commit_sha !== undefined) data.commit_sha = input.commit_sha ? input.commit_sha.toLowerCase() : null;
  if (release.status === 'released' && input.status && input.status !== 'released') return { error: 'already_released' };
  const releasing = input.status === 'released' && release.status !== 'released';
  if (input.status) data.status = input.status;
  let taken = 0;
  await prisma.$transaction(async (tx) => {
    if (releasing) {
      data.released_at = new Date();
      data.released_by = actor.userId;
      if (input.include_unreleased_commits !== false) {
        // Everything committed so far that no release holds ships in this one (up to the release commit when one is named).
        let until = new Date();
        const named = data.commit_sha ?? release.commit_sha;
        if (named) {
          const point = await tx.pmCommit.findFirst({ where: { project_id: release.project_id, sha: { startsWith: named } }, select: { committed_at: true } });
          if (point) until = point.committed_at;
        }
        taken = (await tx.pmCommit.updateMany({ where: { project_id: release.project_id, release_id: null, committed_at: { lte: until } }, data: { release_id: release.id } })).count;
      }
    }
    await tx.pmRelease.update({ where: { id: releaseId }, data });
    if (input.status && input.status !== release.status) await pm.logActivity(tx, orgId, release.project_id, null, actor.userId, 'release_status', `${release.version}: ${release.status}`, input.status, taken ? `${taken} commit(s) taken in` : null);
  });
  return { release: await shapeDetail(orgId, await prisma.pmRelease.findUnique({ where: { id: releaseId } }), true), commits_taken: taken };
}

async function deleteRelease(orgId, releaseId, actor) {
  const r = await loadRelease(orgId, releaseId, actor, { manage: true });
  if (r.error) return r;
  if (r.release.status === 'released') return { error: 'already_released' };
  await prisma.pmRelease.delete({ where: { id: releaseId } });
  await pm.logActivity(prisma, orgId, r.release.project_id, null, actor.userId, 'release_deleted', r.release.version, null, null);
  return { deleted: true };
}

/** Put tickets into / take them out of a release. A released version is closed for changes. */
async function setReleaseTickets(orgId, releaseId, actor, { add = [], remove = [] }) {
  const r = await loadRelease(orgId, releaseId, actor, { manage: true });
  if (r.error) return r;
  if (r.release.status === 'released' || r.release.status === 'cancelled') return { error: 'release_closed' };
  const pid = r.release.project_id;
  if (add.length) await prisma.pmTicket.updateMany({ where: { id: { in: add }, project_id: pid }, data: { release_id: releaseId } });
  if (remove.length) await prisma.pmTicket.updateMany({ where: { id: { in: remove }, project_id: pid, release_id: releaseId }, data: { release_id: null } });
  return { release: await shapeDetail(orgId, r.release, true) };
}

/** Put commits into / take them out of a release. */
async function setReleaseCommits(orgId, releaseId, actor, { add = [], remove = [] }) {
  const r = await loadRelease(orgId, releaseId, actor, { manage: true });
  if (r.error) return r;
  if (r.release.status === 'released' || r.release.status === 'cancelled') return { error: 'release_closed' };
  const pid = r.release.project_id;
  if (add.length) await prisma.pmCommit.updateMany({ where: { id: { in: add }, project_id: pid }, data: { release_id: releaseId } });
  if (remove.length) await prisma.pmCommit.updateMany({ where: { id: { in: remove }, project_id: pid, release_id: releaseId }, data: { release_id: null } });
  return { release: await shapeDetail(orgId, r.release, true) };
}

/** Release notes as Markdown: shipped tickets grouped by type, then the commits. */
async function releaseNotes(orgId, releaseId, actor) {
  const r = await loadRelease(orgId, releaseId, actor);
  if (r.error) return r;
  const d = await shapeDetail(orgId, r.release, false);
  const label = { bug: 'Bug fixes', task: 'Improvements & tasks', change: 'Changes', support: 'Support' };
  const out = [`# ${r.project.name} ${d.version}${d.name ? ` - ${d.name}` : ''}`, '', `Status: ${d.status}${d.released_at ? ` (released ${d.released_at.slice(0, 10)})` : d.planned_date ? ` (planned ${d.planned_date})` : ''}${d.git_tag ? ` | tag ${d.git_tag}` : ''}`, ''];
  if (d.notes) out.push(d.notes, '');
  for (const type of Object.keys(label)) {
    const list = d.tickets.filter((t) => t.type === type);
    if (!list.length) continue;
    out.push(`## ${label[type]}`);
    for (const t of list) out.push(`- ${r.project.code}#${t.number} ${t.title}${t.resolution ? ` - ${firstLine(t.resolution)}` : ''}${t.done ? '' : ' (not finished)'}`);
    out.push('');
  }
  if (d.commits.length) {
    out.push(`## Commits (${d.commits.length})`);
    for (const c of d.commits) out.push(`- ${c.short} ${c.subject}${c.author_name ? ` (${c.author_name})` : ''}`);
  }
  return { markdown: `${out.join('\n').trim()}\n` };
}

// ---------- commits ----------

/** Ticket numbers of this project named in a commit message: "PRJ-001#12", "PRJ-001-12" or "PRJ-001/12". */
function ticketNumbersIn(message, code) {
  const esc = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new Set();
  for (const m of String(message).matchAll(new RegExp(`(?<![A-Za-z0-9])${esc}(?:#|-|/)(\\d{1,7})(?!\\d)`, 'gi'))) found.add(Number(m[1]));
  return [...found];
}

async function linkTickets(db, projectRow, commitId, message) {
  const numbers = ticketNumbersIn(message, projectRow.code);
  if (!numbers.length) return 0;
  const tickets = await db.pmTicket.findMany({ where: { project_id: projectRow.id, number: { in: numbers } }, select: { id: true } });
  if (tickets.length) await db.pmCommitTicket.createMany({ data: tickets.map((t) => ({ commit_id: commitId, ticket_id: t.id })), skipDuplicates: true });
  return tickets.length;
}

/** Records commits (new ones only; a commit already known is left alone). Used by the git sync and by a CI step that pushes them. */
async function importCommits(orgId, projectId, actor, input) {
  const r = await managed(orgId, projectId, actor);
  if (r.error) return r;
  const wanted = input.commits.map((c) => ({ ...c, sha: c.sha.toLowerCase() }));
  const known = new Set((await prisma.pmCommit.findMany({ where: { project_id: projectId, sha: { in: wanted.map((c) => c.sha) } }, select: { sha: true } })).map((c) => c.sha));
  let added = 0;
  let linked = 0;
  for (const c of wanted) {
    if (known.has(c.sha)) continue;
    await prisma.$transaction(async (tx) => {
      const row = await tx.pmCommit.create({ data: { org_id: orgId, project_id: projectId, sha: c.sha, message: c.message, author_name: c.author_name || null, author_email: c.author_email || null, committed_at: new Date(c.committed_at), branch: c.branch || null, url: c.url || null } });
      linked += await linkTickets(tx, r.project, row.id, c.message);
    });
    added += 1;
  }
  if (added) await pm.logActivity(prisma, orgId, projectId, null, actor.userId, 'commits_recorded', null, String(added), `${linked} ticket link(s)`);
  return { added, already_known: wanted.length - added, ticket_links: linked };
}

const git = (args) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024, timeout: 20000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
});

/** GitHub web address of the repository, without any credentials that may sit in the remote URL. */
async function repoWebBase() {
  try {
    const remote = (await git(['config', '--get', 'remote.origin.url'])).trim();
    const m = remote.match(/github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i);
    return m ? `https://github.com/${m[1]}/${m[2]}` : null;
  } catch { return null; }
}

/** Reads the latest commits of the server's own git checkout and records them. Fails clearly where the server has no git history (a built image). */
async function syncFromGit(orgId, projectId, actor, input = {}) {
  const r = await managed(orgId, projectId, actor);
  if (r.error) return r;
  if (!fs.existsSync(path.join(REPO_ROOT, '.git'))) return { error: 'git_unavailable' };
  const branch = input.branch || 'HEAD';
  let out;
  try {
    out = await git(['log', `--since=${input.days || 60}.days`, '--max-count=500', '--pretty=format:%H%x1f%an%x1f%ae%x1f%aI%x1f%B%x1e', branch, '--']);
  } catch { return { error: 'git_failed' }; }
  const web = await repoWebBase();
  const commits = out.split('\x1e').map((s) => s.replace(/^\n/, '')).filter(Boolean).map((rec) => {
    const [h, an, ae, at, ...msg] = rec.split('\x1f');
    return { sha: h.trim(), message: msg.join('\x1f').trim() || '(no message)', author_name: an, author_email: ae, committed_at: at, branch: input.branch || null, url: web ? `${web}/commit/${h.trim()}` : null };
  }).filter((c) => /^[0-9a-f]{40}$/.test(c.sha));
  if (!commits.length) return { added: 0, already_known: 0, ticket_links: 0, read: 0 };
  const res = await importCommits(orgId, projectId, actor, { commits });
  return { ...res, read: commits.length };
}

async function listCommits(orgId, projectId, actor, { release, q, limit = 100 } = {}) {
  const r = await project(orgId, projectId, actor);
  if (r.error) return r;
  const where = { project_id: projectId, ...(release === 'none' ? { release_id: null } : release ? { release_id: release } : {}), ...(q ? { OR: [{ message: { contains: q, mode: 'insensitive' } }, { author_name: { contains: q, mode: 'insensitive' } }, { sha: { startsWith: q.toLowerCase() } }] } : {}) };
  const rows = await prisma.pmCommit.findMany({ where, orderBy: { committed_at: 'desc' }, take: Math.min(Number(limit) || 100, 500), include: { tickets: { select: { ticket: { select: { id: true, number: true } } } } } });
  return { commits: rows.map(shapeCommit), can_manage: r.canManage };
}

/** Link / unlink tickets to one commit by hand (for a commit whose message names no ticket). */
async function setCommitTickets(orgId, commitId, actor, { add = [], remove = [] }) {
  const commit = await prisma.pmCommit.findFirst({ where: { id: commitId, org_id: orgId } });
  if (!commit) return { error: 'not_found' };
  const r = await managed(orgId, commit.project_id, actor);
  if (r.error) return r;
  if (add.length) {
    const ok = await prisma.pmTicket.findMany({ where: { id: { in: add }, project_id: commit.project_id }, select: { id: true } });
    if (ok.length) await prisma.pmCommitTicket.createMany({ data: ok.map((t) => ({ commit_id: commitId, ticket_id: t.id })), skipDuplicates: true });
  }
  if (remove.length) await prisma.pmCommitTicket.deleteMany({ where: { commit_id: commitId, ticket_id: { in: remove } } });
  const fresh = await prisma.pmCommit.findUnique({ where: { id: commitId }, include: { tickets: { select: { ticket: { select: { id: true, number: true } } } } } });
  return { commit: shapeCommit(fresh) };
}

/** The release and commits of one ticket, for the ticket panel. */
async function ticketTracking(ticketId) {
  const [ticket, links] = await Promise.all([
    prisma.pmTicket.findUnique({ where: { id: ticketId }, select: { release: { select: { id: true, version: true, status: true } } } }),
    prisma.pmCommitTicket.findMany({ where: { ticket_id: ticketId }, include: { commit: true }, orderBy: { commit: { committed_at: 'desc' } } }),
  ]);
  return { release: ticket?.release || null, commits: links.map((l) => ({ id: l.commit.id, short: l.commit.sha.slice(0, 7), subject: firstLine(l.commit.message), author_name: l.commit.author_name, committed_at: iso(l.commit.committed_at), url: l.commit.url })) };
}

module.exports = {
  RELEASE_STATUSES, releaseCreateSchema, releaseUpdateSchema, importSchema, syncSchema, idsSchema, ticketNumbersIn,
  listReleases, createRelease, getRelease, updateRelease, deleteRelease, setReleaseTickets, setReleaseCommits, releaseNotes,
  importCommits, syncFromGit, listCommits, setCommitTickets, ticketTracking,
};
