/**
 * Import requirements from docs/jira/Jira_all.csv into the local database.
 *
 * Run after base seed + LeadMinds accounts:
 *   npm run seed
 *   npm run seed:accounts
 *   npm run seed:jira
 *
 * Re-running removes prior Jira-imported requirements. Client accounts from
 * LeadMinds are reused by canonical name (Girnarsoft_Pragya → Girnarsoft,
 * Devlabs → Devlabsalliance, etc.). Only missing clients (e.g. Delphic Bench)
 * are created with source = 'jira_csv'.
 *
 * Jira_all.csv is a full Jira export (142 columns, standard column order), so
 * every field is read by header name — never by position. Repeated headers
 * (Custom field (Client), Custom field (Multi-Assignee), Comment) are collected
 * in order.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const {
  JIRA_AUTHOR_ID_TO_EMAIL,
  JIRA_NAME_TO_EMAIL,
  emailsMentionedInComments,
} = require('./team-roster');
const { normalizeClientName } = require('./client-aliases');

const prisma = new PrismaClient();

const CSV_PATH = path.resolve(__dirname, '../../docs/jira/Jira_all.csv');
const JIRA_TAG = '[Jira:';
const LAKH = 100000;

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseCsvRecords(text) {
  const records = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(field);
      records.push(row);
      row = [];
      field = '';
      i += 1;
    } else if (ch === '\n') {
      row.push(field);
      records.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  return records;
}

function parseJiraDate(raw) {
  if (!raw || !String(raw).trim()) return new Date();
  const match = String(raw).trim().match(
    /^(\d{1,2})\/(\w{3})\/(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i,
  );
  if (!match) return new Date();

  const day = Number(match[1]);
  const month = MONTHS[match[2].toLowerCase()];
  const year = 2000 + Number(match[3]);
  let hour = Number(match[4]) % 12;
  if (match[6].toUpperCase() === 'PM') hour += 12;

  return new Date(year, month, day, hour, Number(match[5]), 0);
}

function parseExperience(raw) {
  if (!raw || !String(raw).trim()) return { min: null, max: null };
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');

  let match = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (match) return { min: Number(match[1]), max: Number(match[2]) };

  match = s.match(/^(\d+(?:\.\d+)?)\s*\+/);
  if (match) return { min: Number(match[1]), max: null };

  match = s.match(/^(\d+(?:\.\d+)?)/);
  if (match) return { min: Number(match[1]), max: null };

  return { min: null, max: null };
}

/**
 * "1.8 LPM" / "1.30 - 2.00 LPM" / "1L" / "1.5" -> monthly INR (lakhs/month).
 * "1000/hr" -> hourly INR. "0" / "" -> no budget.
 */
function parseBudget(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s || s === '0') return { min: null, max: null, type: null };

  if (s.includes('/hr') || s.includes('/hour') || /\bhr\b/.test(s)) {
    const nums = s.match(/\d+(?:\.\d+)?/g);
    if (!nums) return { min: null, max: null, type: null };
    return {
      min: Number(nums[0]),
      max: nums[1] ? Number(nums[1]) : Number(nums[0]),
      type: 'hourly',
    };
  }

  const nums = s.match(/\d+(?:\.\d+)?/g);
  if (!nums) return { min: null, max: null, type: null };
  const values = nums.map((n) => Number(n) * LAKH);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    type: 'monthly',
  };
}

function parseSeats(raw) {
  const n = Math.round(Number(String(raw || '').trim()));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function mapEngagement(reqType) {
  const t = String(reqType || '').trim().toLowerCase();
  if (t === 'c2c' || t === 'c2h') return 'contract';
  if (t === 'perm' || t === 'permanent') return 'full_time';
  return null;
}

function mapPriority(raw) {
  const p = String(raw || '').trim().toLowerCase();
  if (p === 'highest' || p === 'urgent' || p === 'critical') return 'urgent';
  if (p === 'high') return 'high';
  if (p === 'low' || p === 'lowest') return 'low';
  return 'medium';
}

function parseLocation(raw) {
  if (!raw || !String(raw).trim()) return { work_mode: null, work_location: null };
  const original = String(raw).trim();
  const lower = original.toLowerCase();

  if (lower === 'remote') return { work_mode: 'remote', work_location: null };
  if (lower.includes('hybrid') || lower.includes('1-2days') || lower.includes('remote_1-2')) {
    return { work_mode: 'hybrid', work_location: original };
  }
  if (lower.includes('hyderabad')) return { work_mode: 'hybrid', work_location: 'Hyderabad' };
  if (lower.includes('indore')) return { work_mode: 'onsite', work_location: 'Indore' };
  if (lower.includes('pan-india')) return { work_mode: 'hybrid', work_location: 'Pan India' };

  return { work_mode: 'remote', work_location: original };
}

function mapStatus(raw) {
  const status = String(raw || '').toLowerCase();
  if (status === 'open') return 'open';
  if (status.includes('shared')) return 'in_progress';
  if (status.includes('closed')) return 'closed';
  if (status.includes('hold')) return 'on_hold';
  return 'open';
}

function inferTechStack(title) {
  const known = [
    'Python', 'Java', 'NET', '.NET', 'React', 'Angular', 'Node', 'AWS', 'Azure',
    'ServiceNow', 'Workday', 'Salesforce', 'DevOps', 'QA', 'AI', 'ML', 'Data',
    'Terraform', 'Ruby', 'Rails', 'AEM', 'Adobe', 'Dynamics', 'FHIR', 'HL7',
  ];
  const hits = [];
  const hay = String(title || '').toLowerCase();
  for (const skill of known) {
    if (hay.includes(skill.toLowerCase().replace('.', ''))) hits.push(skill.replace('.', ''));
  }
  if (hits.length === 0) {
    const token = String(title || '').split(/[\s,/+&–\-|]+/)[0];
    if (token && token.length > 1) return [token.replace(/[^a-zA-Z0-9.#+]/g, '')];
  }
  return [...new Set(hits)].slice(0, 5);
}

/** Strip light Jira wiki markup so job_description is readable in the UI. */
function jiraWikiToPlain(raw) {
  if (!raw || !String(raw).trim()) return null;
  let text = String(raw).replace(/\r\n/g, '\n');
  text = text.replace(/^h[1-6]\.\s*/gm, '');
  text = text.replace(/\{\{[a-z]+\}\}/gi, '');
  text = text.replace(/\{noformat\}/gi, '');
  text = text.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$1 ($2)');
  text = text.replace(/\[([^\]]+)\]/g, '$1');
  text = text.replace(/[*_]/g, '');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text || null;
}

function parseCommentCell(raw) {
  if (!raw || !String(raw).trim()) return null;
  const text = String(raw).trim();
  const parts = text.split(';');
  if (parts.length < 3) return { created_at: new Date(), body: text };

  return {
    created_at: parseJiraDate(parts[0]),
    author_ref: parts[1].trim(),
    body: parts.slice(2).join(';').trim(),
  };
}

function resolveEmailFromJiraName(jiraName) {
  if (!jiraName) return null;
  const email = JIRA_NAME_TO_EMAIL[jiraName.trim()];
  return email ? email.toLowerCase() : null;
}

async function wipePriorJiraImport() {
  const jiraReqs = await prisma.requirement.findMany({
    where: { description: { startsWith: JIRA_TAG } },
    select: { id: true },
  });

  if (jiraReqs.length > 0) {
    const reqIds = jiraReqs.map((r) => r.id);
    await prisma.comment.deleteMany({ where: { entity_type: 'requirement', entity_id: { in: reqIds } } });
    await prisma.requirementAssignment.deleteMany({ where: { requirement_id: { in: reqIds } } });
    await prisma.requirementSeat.deleteMany({ where: { requirement_id: { in: reqIds } } });
    await prisma.requirement.deleteMany({ where: { id: { in: reqIds } } });
  }

  // Only remove Jira-created clients that have no remaining requirements.
  // LeadMinds accounts (source leadminds_csv) are kept and reused by name.
  const orphanJiraAccounts = await prisma.account.findMany({
    where: {
      source: 'jira_csv',
      requirements: { none: {} },
    },
    select: { id: true },
  });
  if (orphanJiraAccounts.length > 0) {
    await prisma.account.deleteMany({
      where: { id: { in: orphanJiraAccounts.map((a) => a.id) } },
    });
  }
}

async function loadTeamContext() {
  const users = await prisma.user.findMany();
  const byEmail = Object.fromEntries(users.map((u) => [u.email.toLowerCase(), u]));

  const fallbackSales = byEmail['tanvi.saxena@delphic.in'] || users.find((u) => u.role === 'sales');
  const fallbackAdmin = byEmail['admin@delphic.in'] || users.find((u) => u.role === 'admin');
  const defaultBda = byEmail['chahak.pandya@delphic.in'] || users.find((u) => u.role === 'bda');

  if (!fallbackSales || !fallbackAdmin || !defaultBda) {
    throw new Error('Team roster missing. Run `npm run seed` first.');
  }

  const byJiraName = {};
  for (const [jiraName, email] of Object.entries(JIRA_NAME_TO_EMAIL)) {
    byJiraName[jiraName] = byEmail[email.toLowerCase()];
  }

  const byJiraAuthorId = {};
  for (const [authorId, email] of Object.entries(JIRA_AUTHOR_ID_TO_EMAIL)) {
    byJiraAuthorId[authorId] = byEmail[email.toLowerCase()];
  }

  return { byEmail, byJiraName, byJiraAuthorId, fallbackSales, fallbackAdmin, defaultBda };
}

async function ensureClientAccounts(rows, ownerId) {
  const existing = await prisma.account.findMany({ where: { type: 'client' } });
  const accountsByName = {};

  for (const account of existing) {
    accountsByName[normalizeClientName(account.name)] = account;
  }

  for (const row of rows) {
    const clientName = normalizeClientName(row.client);
    if (accountsByName[clientName]) continue;

    const account = await prisma.account.create({
      data: {
        type: 'client',
        name: clientName,
        stage: 'active',
        source: 'jira_csv',
        owner_id: ownerId,
        industry: 'Technology',
        company_size: 'mid',
        location_country: 'IN',
      },
    });

    accountsByName[clientName] = account;
  }

  return accountsByName;
}

/** Column-index map: header name -> array of column indices, in file order. */
function buildHeaderIndex(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const key = String(h).trim();
    (map[key] = map[key] || []).push(i);
  });
  return map;
}

function loadJiraRows() {
  const text = fs.readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, '');
  const records = parseCsvRecords(text);
  const headers = records[0];
  const H = buildHeaderIndex(headers);

  const first = (name) => (H[name] ? H[name][0] : -1);
  const all = (name) => H[name] || [];

  const clientCols = all('Custom field (Client)');
  const assigneeCols = all('Custom field (Multi-Assignee)');
  const commentCols = all('Comment').length ? all('Comment') : all('Comments');

  const get = (values, name) => {
    const i = first(name);
    return i >= 0 ? String(values[i] ?? '').trim() : '';
  };

  return records.slice(1)
    .filter((r) => get(r, 'Issue key'))
    .map((values) => {
      const assignees = assigneeCols
        .map((i) => String(values[i] ?? '').trim())
        .filter(Boolean);

      const comments = commentCols
        .map((i) => parseCommentCell(values[i]))
        .filter(Boolean);

      return {
        issue_key: get(values, 'Issue key'),
        summary: get(values, 'Summary'),
        description_raw: get(values, 'Description'),
        client: clientCols[0] != null ? String(values[clientCols[0]] ?? '').trim() : '',
        client_contact: clientCols[1] != null ? String(values[clientCols[1]] ?? '').trim() : '',
        experience_raw: get(values, 'Custom field (Experience)'),
        location_raw: get(values, 'Custom field (Location)'),
        status_raw: get(values, 'Status'),
        created_raw: get(values, 'Created'),
        positions_raw: get(values, 'Custom field (Number of Positions)'),
        req_type_raw: get(values, 'Custom field (Requirement Type)'),
        budget_raw: get(values, 'Custom field (Budget)'),
        priority_raw: get(values, 'Custom field (Priority)'),
        reporter: get(values, 'Reporter'),
        assignees,
        comments,
      };
    });
}

/** Prefer a sales-role owner so Sales can assign recruiters in the UI. */
function resolveSalesOwner(reporter, assignees, ctx) {
  const reporterUser = ctx.byJiraName[reporter];
  if (reporterUser?.role === 'sales') return reporterUser;

  for (const name of assignees || []) {
    const user = ctx.byJiraName[name];
    if (user?.role === 'sales') return user;
  }

  return ctx.fallbackSales;
}

function recruiterAssigneesFromRow(row, ctx) {
  const emails = new Set();

  for (const assigneeName of row.assignees) {
    const email = resolveEmailFromJiraName(assigneeName);
    const user = email ? ctx.byEmail[email] : null;
    if (user?.role === 'recruiter') emails.add(email);
  }

  // Comment mentions (Krupali / Nikhil / Dheeraj). Seed uses role_on_req=recruiter
  // even when the user is BDA so they appear on the requirement.
  for (const email of emailsMentionedInComments(row.comments)) {
    if (ctx.byEmail[email]) emails.add(email);
  }

  return [...emails].map((email) => ctx.byEmail[email]).filter(Boolean);
}

async function importJiraRows(rows, ctx) {
  let imported = 0;
  let seatCount = 0;
  let commentCount = 0;
  let assignmentCount = 0;
  let commentMentionAssignments = 0;

  for (const row of rows) {
    const clientName = normalizeClientName(row.client);
    const account = ctx.accountsByName[clientName];
    const experience = parseExperience(row.experience_raw);
    const location = parseLocation(row.location_raw);
    const budget = parseBudget(row.budget_raw);
    const seats = parseSeats(row.positions_raw);
    const createdAt = parseJiraDate(row.created_raw);
    const salesOwner = resolveSalesOwner(row.reporter, row.assignees, ctx);
    const jobDescription = jiraWikiToPlain(row.description_raw);

    const descriptionParts = [`${JIRA_TAG} ${row.issue_key}] Imported from Jira export.`];
    if (row.client_contact) descriptionParts.push(`Jira client contact: ${row.client_contact}`);
    if (row.req_type_raw) descriptionParts.push(`Jira requirement type: ${row.req_type_raw}`);
    if (row.reporter) descriptionParts.push(`Jira reporter: ${row.reporter}`);

    const requirement = await prisma.requirement.create({
      data: {
        account_id: account.id,
        title: row.summary || row.issue_key,
        req_type: 'recruitment',
        status: mapStatus(row.status_raw),
        description: descriptionParts.join('\n'),
        job_description: jobDescription,
        designation: row.summary || undefined,
        primary_tech_stack: inferTechStack(row.summary),
        experience_min: experience.min,
        experience_max: experience.max,
        seats_total: seats,
        work_mode: location.work_mode,
        work_location: location.work_location,
        engagement_type: mapEngagement(row.req_type_raw),
        budget_min: budget.min,
        budget_max: budget.max,
        budget_currency: 'INR',
        budget_type: budget.type,
        priority: mapPriority(row.priority_raw),
        sales_owner_id: salesOwner.id,
        created_at: createdAt,
        updated_at: createdAt,
      },
    });

    for (let s = 1; s <= seats; s += 1) {
      await prisma.requirementSeat.create({
        data: { requirement_id: requirement.id, seat_label: `Seat ${s}`, seat_status: 'open' },
      });
      seatCount += 1;
    }

    const assigneeEmailsFromColumn = new Set(
      row.assignees
        .map((name) => resolveEmailFromJiraName(name))
        .filter((email) => email && ctx.byEmail[email]?.role === 'recruiter'),
    );
    const mentionEmails = emailsMentionedInComments(row.comments);
    const recruiters = recruiterAssigneesFromRow(row, ctx);
    const assignedUserIds = new Set();

    for (const recruiter of recruiters) {
      if (!recruiter || assignedUserIds.has(recruiter.id)) continue;
      assignedUserIds.add(recruiter.id);

      await prisma.requirementAssignment.create({
        data: {
          requirement_id: requirement.id,
          user_id: recruiter.id,
          role_on_req: 'recruiter',
          assigned_by: ctx.fallbackAdmin.id,
          assigned_at: createdAt,
        },
      });
      assignmentCount += 1;

      const email = recruiter.email.toLowerCase();
      if (mentionEmails.has(email) && !assigneeEmailsFromColumn.has(email)) {
        commentMentionAssignments += 1;
      }
    }

    for (const comment of row.comments) {
      const author = ctx.byJiraAuthorId[comment.author_ref]
        || ctx.byJiraName[row.reporter]
        || ctx.fallbackSales;

      await prisma.comment.create({
        data: {
          entity_type: 'requirement',
          entity_id: requirement.id,
          user_id: author.id,
          body: comment.body,
          created_at: comment.created_at,
        },
      });
      commentCount += 1;
    }

    imported += 1;
  }

  return { imported, seatCount, commentCount, assignmentCount, commentMentionAssignments };
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Jira CSV not found at ${CSV_PATH}`);
  }

  console.log('Loading Jira CSV…');
  const rows = loadJiraRows();
  console.log(`Parsed ${rows.length} requirement rows.`);

  console.log('Removing prior Jira import…');
  await wipePriorJiraImport();

  const ctx = await loadTeamContext();
  ctx.accountsByName = await ensureClientAccounts(rows, ctx.defaultBda.id);

  console.log('Importing requirements (account-wise, reporter = requirement owner, recruiters from assignees + comment mentions)…');
  const result = await importJiraRows(rows, ctx);

  const summary = {
    jira_requirements: result.imported,
    jira_accounts: Object.keys(ctx.accountsByName).length,
    jira_seats: result.seatCount,
    jira_comments: result.commentCount,
    jira_recruiter_assignments: result.assignmentCount,
    assignments_from_comment_mentions: result.commentMentionAssignments,
    total_requirements: await prisma.requirement.count(),
    total_accounts: await prisma.account.count(),
    total_users: await prisma.user.count(),
  };

  console.log('Jira import complete.');
  console.log(JSON.stringify(summary, null, 2));
}

require('./_guard').assertNonProdDestructive('prisma/seed-jira.js');

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
