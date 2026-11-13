const prisma = require('../../config/db');
const audit = require('./audit.service');

// The three SaaS switches, turned on and off by a platform admin from the /platform screen.
// Stored in saas_settings as 'switch.<name>' = true/false. When no row exists the environment variable decides (initial fallback), and with neither
// the switch is OFF. Once a platform admin has set a switch, the stored value wins over the environment.
const SWITCHES = {
  provisioning: { env: 'SAAS_CUSTOMER_PROVISIONING', label: 'Customer workspaces', help: 'Lets Delphic One create a customer\'s own trial workspace.' },
  counter: { env: 'SAAS_COUNTER_ENABLED', label: 'Daily credit counter', help: 'Takes one credit day a day off every active customer slot, and moves ended trials to read-only and then suspended.' },
  enforce: { env: 'SAAS_ENFORCE_ENTITLEMENTS', label: 'Module access checks', help: 'Customer users can open only the modules they have credit days for. Companies that are not customers are never affected.' },
};
const keyOf = (name) => `switch.${name}`;

// Stored values are read through a short cache so a request does not hit the database for it; a change clears it at once.
let cache = null;
let cachedAt = 0;
const TTL_MS = 10000;
const clearCache = () => { cache = null; cachedAt = 0; };

async function stored() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const rows = await prisma.saasSetting.findMany({ where: { key: { startsWith: 'switch.' } } });
  cache = new Map(rows.map((r) => [r.key, r.value === true]));
  cachedAt = Date.now();
  return cache;
}

async function isOn(name) {
  const def = SWITCHES[name];
  if (!def) return false;
  const rows = await stored();
  if (rows.has(keyOf(name))) return rows.get(keyOf(name));
  return process.env[def.env] === 'true';
}

async function state() {
  const rows = await stored();
  return Object.entries(SWITCHES).map(([name, def]) => ({
    name, label: def.label, help: def.help, on: rows.has(keyOf(name)) ? rows.get(keyOf(name)) : process.env[def.env] === 'true',
    source: rows.has(keyOf(name)) ? 'platform screen' : (process.env[def.env] === 'true' ? 'server setting (initial)' : 'default (off)'),
  }));
}

async function setSwitch(name, on, actorId) {
  if (!SWITCHES[name]) return { error: 'not_found' };
  const before = (await state()).find((s) => s.name === name);
  await prisma.saasSetting.upsert({ where: { key: keyOf(name) }, update: { value: Boolean(on), updated_by: actorId }, create: { key: keyOf(name), value: Boolean(on), note: SWITCHES[name].label, updated_by: actorId } });
  clearCache();
  await audit.record(actorId, on ? 'switch_on' : 'switch_off', 'switch', name, { on: before.on, source: before.source }, { on: Boolean(on) });
  return { ok: true };
}

module.exports = { SWITCHES, isOn, state, setSwitch, clearCache };
