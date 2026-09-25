/**
 * Import client accounts from the LeadMinds CSV export.
 *
 * Run after base seed (team roster must exist):
 *   npm run seed
 *   npm run seed:accounts
 *   npm run seed:jira
 *
 * Re-running removes prior LeadMinds import (source = 'leadminds_csv') and recreates it.
 * Does not touch vendor_csv or manually created accounts.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { JIRA_NAME_TO_EMAIL } = require('./team-roster');
const { normalizeClientName } = require('./client-aliases');

const prisma = new PrismaClient();

const SOURCE = 'leadminds_csv';
const CSV_CANDIDATES = [
  path.resolve(__dirname, '../../docs/jira/LeadMinds-Accounts.csv'),
  path.resolve(
    __dirname,
    '../../docs/jira/Accounts (LeadMinds) 25e9c7fb39e880fbbee6d103a9aaa74a_all(in).csv',
  ),
];

const MANAGER_NAME_TO_EMAIL = {
  'paras gulati': 'paras.gulati@delphic.in',
  'biswajit dey': 'biswajit.dey@delphic.in',
  'tanvi saxena': 'tanvi.saxena@delphic.in',
  'chahak pandya': 'chahak.pandya@delphic.in',
  'diksha yadav': 'diksha.yadav@delphic.in',
  chahak: 'chahak.pandya@delphic.in',
  diksha: 'diksha.yadav@delphic.in',
  tanvi: 'tanvi.saxena@delphic.in',
  paras: 'paras.gulati@delphic.in',
  biswajit: 'biswajit.dey@delphic.in',
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

function resolveCsvPath() {
  for (const candidate of CSV_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function mapBillingStage(billingType) {
  // LeadMinds "Hold" is commercial status — keep as active client in the app.
  const value = String(billingType || '').trim().toLowerCase();
  if (value === 'active' || value === 'hold' || !value) return 'active';
  return 'active';
}

function parseLocation(raw) {
  const text = String(raw || '').trim();
  if (!text) return { location: null, location_city: null, location_country: null };

  const parts = text.split(/[-–—]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      location: text,
      location_city: parts[0],
      location_country: parts[parts.length - 1] === 'England' ? 'GB' : 'IN',
    };
  }

  return { location: text, location_city: text, location_country: 'IN' };
}

function parseSpecializations(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function firstPersonName(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  return text.split(',')[0].replace(/mailto:.*/i, '').trim() || null;
}

function cleanEmail(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

function cleanPhone(raw) {
  const text = String(raw || '').trim().replace(/[^\d+]/g, ' ').replace(/\s+/g, ' ').trim();
  return text || null;
}

function resolveOwnerEmail(managerName, salesPoc, fallbackEmail) {
  const managerKey = String(managerName || '').trim().toLowerCase();
  if (MANAGER_NAME_TO_EMAIL[managerKey]) return MANAGER_NAME_TO_EMAIL[managerKey];

  const rosterEmail = JIRA_NAME_TO_EMAIL[String(managerName || '').trim()];
  if (rosterEmail) return rosterEmail.toLowerCase();

  const pocParts = String(salesPoc || '')
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  for (const part of pocParts) {
    if (MANAGER_NAME_TO_EMAIL[part]) return MANAGER_NAME_TO_EMAIL[part];
  }

  return fallbackEmail;
}

function loadRows(csvPath) {
  const text = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
  const records = parseCsvRecords(text);
  const headers = records[0].map((h) => String(h).trim());
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const get = (row, name) => String(row[idx[name]] ?? '').trim();

  return records.slice(1)
    .filter((row) => get(row, 'Account name'))
    .map((row) => ({
      name: normalizeClientName(get(row, 'Account name')),
      account_manager: get(row, 'Account manager'),
      billing_type: get(row, 'Billing Type'),
      brand: get(row, 'Brand'),
      contact_email: cleanEmail(get(row, 'Contact email')),
      office_location: get(row, 'Office Location'),
      person_name: firstPersonName(get(row, 'Person Name')),
      phone: cleanPhone(get(row, 'Phone number')),
      sales_poc: get(row, 'Sales POC'),
      sourcing_team: get(row, 'Sourcing Team'),
      status: get(row, 'Status'),
      technologies: get(row, 'Technologies'),
      type: get(row, 'Type'),
    }));
}

async function loadOwners() {
  const users = await prisma.user.findMany();
  const byEmail = Object.fromEntries(users.map((u) => [u.email.toLowerCase(), u]));
  // BDA owner fallback for rows with an unrecognised Account manager: Paras, then Biswajit.
  const fallback = byEmail['paras.gulati@delphic.in']
    || byEmail['biswajit.dey@delphic.in']
    || byEmail['admin@delphic.in']
    || users.find((u) => u.role === 'bda')
    || users.find((u) => u.role === 'admin');

  if (!fallback) throw new Error('Team roster missing. Run `npm run seed` first.');

  return { byEmail, fallback };
}

function buildAccountPayload(row, owner) {
  const location = parseLocation(row.office_location);
  const notes = [
    row.brand ? `Brand: ${row.brand}` : null,
    row.sales_poc ? `Sales POC: ${row.sales_poc}` : null,
    row.sourcing_team ? `Sourcing: ${row.sourcing_team}` : null,
    row.status ? `LeadMinds status: ${row.status}` : null,
    row.type ? `Engagement: ${row.type}` : null,
    row.billing_type ? `Billing: ${row.billing_type}` : null,
  ].filter(Boolean).join('\n');

  return {
    type: 'client',
    name: row.name,
    stage: mapBillingStage(row.billing_type),
    source: SOURCE,
    owner_id: owner.id,
    industry: 'Technology',
    company_size: 'mid',
    location: location.location,
    location_city: location.location_city,
    location_country: location.location_country,
    poc_name: row.person_name,
    poc_email: row.contact_email,
    poc_phone: row.phone,
    meeting_notes: notes || null,
    client_payment_terms: row.type || null,
  };
}

async function main() {
  const csvPath = resolveCsvPath();
  if (!csvPath) {
    throw new Error(`LeadMinds accounts CSV not found. Tried:\n${CSV_CANDIDATES.join('\n')}`);
  }

  console.log(`Loading LeadMinds accounts from ${path.basename(csvPath)}…`);
  const rows = loadRows(csvPath);
  console.log(`Parsed ${rows.length} account rows.`);

  const { byEmail, fallback } = await loadOwners();
  const existing = await prisma.account.findMany({ where: { type: 'client' } });
  const byCanonical = new Map(
    existing.map((account) => [normalizeClientName(account.name).toLowerCase(), account]),
  );

  let created = 0;
  let updated = 0;
  const seen = new Set();

  for (const row of rows) {
    const key = row.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const ownerEmail = resolveOwnerEmail(row.account_manager, row.sales_poc, fallback.email.toLowerCase());
    const owner = byEmail[ownerEmail] || fallback;
    const payload = buildAccountPayload(row, owner);
    const prior = byCanonical.get(key);

    if (prior) {
      await prisma.account.update({
        where: { id: prior.id },
        data: payload,
      });
      updated += 1;
    } else {
      const account = await prisma.account.create({ data: payload });
      byCanonical.set(key, account);
      created += 1;
    }
  }

  console.log('LeadMinds accounts import complete.');
  console.log(JSON.stringify({
    accounts_created: created,
    accounts_updated: updated,
    total_client_accounts: await prisma.account.count({ where: { type: 'client' } }),
    total_accounts: await prisma.account.count(),
  }, null, 2));
}

require('./_guard').assertNonProdDestructive('prisma/seed-accounts.js');

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
