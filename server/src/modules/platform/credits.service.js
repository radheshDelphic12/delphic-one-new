const prisma = require('../../config/db');
const platform = require('./platform.service');

// SaaS slots and credit days (docs/features/SAAS-LAUNCH-BUILD-PLAN.md, phase 2). The rules:
//  - A slot carries credit days per module. Days only go down by the daily counter, and never below 0.
//  - The admin slot always burns; any other slot burns only while someone is assigned (an email) and the slot is active.
//  - Only customers with status 'active' (paid) burn credits. A trial runs on its dates and has every module (see entitlements.service).
//  - A slot can be moved to another email, at most once per `slot_move_days` (platform setting, 7 by default).
//  - Everything that changes a balance writes a ledger row.
// None of this runs unless SAAS_COUNTER_ENABLED (the counter) or SAAS_ENFORCE_ENTITLEMENTS (the checks) is switched on.

const IST = 'Asia/Kolkata';
const dayStr = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const toDate = (s) => new Date(`${s}T00:00:00Z`);

async function createSlot(customerId, { email, is_admin = false, label } = {}) {
  const customer = await prisma.saasCustomer.findUnique({ where: { id: customerId } });
  if (!customer) return { error: 'customer_not_found' };
  const count = await prisma.saasSlot.count({ where: { customer_id: customerId } });
  if (customer.status === 'trial' && count >= customer.max_users) return { error: 'over_trial_users' };
  const slot = await prisma.saasSlot.create({ data: { customer_id: customerId, email: email ? email.toLowerCase() : null, is_admin, label: label || null } });
  return { slot };
}

// Add (or remove, with a negative number) credit days. A balance can never go below 0 here either.
async function addCredit({ slotId, code, days, reason = 'top-up', actorId = null }) {
  if (!Number.isInteger(days) || days === 0) return { error: 'bad_days' };
  const slot = await prisma.saasSlot.findUnique({ where: { id: slotId } });
  if (!slot) return { error: 'slot_not_found' };
  const mod = await prisma.saasModule.findUnique({ where: { code } });
  if (!mod) return { error: 'module_not_found' };
  const alertAt = await platform.settingNumber('low_credit_alert_days', 5);
  return prisma.$transaction(async (tx) => {
    const row = await tx.saasSlotCredit.upsert({ where: { slot_id_module_code: { slot_id: slotId, module_code: code } }, update: {}, create: { slot_id: slotId, module_code: code, days_left: 0 } });
    const next = row.days_left + days;
    if (next < 0) return { error: 'below_zero' };
    await tx.saasSlotCredit.update({ where: { id: row.id }, data: { days_left: next, ...(next > alertAt ? { alerted_at: null } : {}) } });
    await tx.saasCreditLedger.create({ data: { slot_id: slotId, module_code: code, change_days: days, balance_after: next, reason, actor_id: actorId } });
    return { balance: next };
  });
}

// Move a slot to another person: the credits stay on the slot. One move per slot_move_days; the old person loses access at once.
async function moveSlot(slotId, newEmail, actorId = null, now = new Date()) {
  const slot = await prisma.saasSlot.findUnique({ where: { id: slotId } });
  if (!slot) return { error: 'slot_not_found' };
  if (slot.is_admin) return { error: 'admin_slot' };
  const gap = await platform.settingNumber('slot_move_days', 7);
  if (slot.last_moved_at && now - slot.last_moved_at < gap * 86400000) return { error: 'too_soon', wait_days: Math.ceil((gap * 86400000 - (now - slot.last_moved_at)) / 86400000) };
  await prisma.saasSlot.update({ where: { id: slotId }, data: { email: newEmail.toLowerCase(), user_id: null, last_moved_at: now } });
  await prisma.saasCreditLedger.create({ data: { slot_id: slotId, module_code: 'BASC', change_days: 0, balance_after: 0, reason: `slot moved from ${slot.email || 'unassigned'} to ${newEmail.toLowerCase()}`, actor_id: actorId } }).catch(() => {});
  return { ok: true };
}

async function setSlotStatus(slotId, status) {
  const slot = await prisma.saasSlot.findUnique({ where: { id: slotId } });
  if (!slot) return { error: 'slot_not_found' };
  await prisma.saasSlot.update({ where: { id: slotId }, data: { status } });
  return { ok: true };
}

// The daily counter. One row in saas_counter_runs per calendar day makes it safe to run twice (the second run changes nothing) and a day that was
// missed (server down) is caught up on the next run, one day at a time, up to 31 days. Returns what happened for the log and the alerts.
async function runDailyCounter(now = new Date()) {
  const today = dayStr(now);
  const last = await prisma.saasCounterRun.findFirst({ orderBy: { run_date: 'desc' } });
  let from = last ? addDays(last.run_date.toISOString().slice(0, 10), 1) : today;
  if (from > today) return { ran_days: 0, touched: 0, alerts: [] };
  if (addDays(from, 30) < today) from = addDays(today, -30);
  const alertAt = await platform.settingNumber('low_credit_alert_days', 5);
  let ranDays = 0; let touched = 0; const alerts = [];
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const res = await prisma.$transaction(async (tx) => {
      const claimed = await tx.$executeRawUnsafe('INSERT INTO saas_counter_runs (run_date) VALUES ($1::date) ON CONFLICT (run_date) DO NOTHING', d);
      if (!claimed) return null; // another run already did this day
      const burned = await tx.$queryRawUnsafe(`
        UPDATE saas_slot_credits c SET days_left = c.days_left - 1, updated_at = now()
        FROM saas_slots s JOIN saas_customers cu ON cu.id = s.customer_id
        WHERE c.slot_id = s.id AND c.days_left > 0 AND s.status = 'active' AND (s.is_admin OR s.email IS NOT NULL) AND cu.status = 'active'
        RETURNING c.id, c.slot_id, c.module_code, c.days_left`);
      if (burned.length) {
        await tx.saasCreditLedger.createMany({ data: burned.map((b) => ({ slot_id: b.slot_id, module_code: b.module_code, change_days: -1, balance_after: b.days_left, reason: `daily ${d}` })) });
      }
      await tx.$executeRawUnsafe('UPDATE saas_counter_runs SET credits_touched = $2 WHERE run_date = $1::date', d, burned.length);
      return burned;
    });
    if (res === null) continue;
    ranDays += 1; touched += res.length;
  }
  // low-credit alerts: once per credit until it is topped up again
  const low = await prisma.saasSlotCredit.findMany({ where: { days_left: { lte: alertAt }, alerted_at: null, slot: { status: 'active', customer: { status: 'active' } } }, include: { slot: { select: { id: true, email: true, is_admin: true, customer_id: true } } } });
  for (const c of low) {
    if (!(c.slot.is_admin || c.slot.email)) continue;
    await prisma.saasSlotCredit.update({ where: { id: c.id }, data: { alerted_at: now } });
    alerts.push({ customer_id: c.slot.customer_id, slot_id: c.slot.id, module_code: c.module_code, days_left: c.days_left });
  }
  return { ran_days: ranDays, touched, alerts };
}

module.exports = { createSlot, addCredit, moveSlot, setSlotStatus, runDailyCounter, dayStr, addDays, toDate };
