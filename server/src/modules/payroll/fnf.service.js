const prisma = require('../../config/db');
const { todayIst } = require('../../lib/istDate');

const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const money = (v) => (v === null || v === undefined ? null : Number(v));

/** Everyone who has exited, newest exit first, with their FnF record (null until one is started). */
async function list(orgId, { status } = {}) {
  const members = await prisma.orgMembership.findMany({
    where: { org_id: orgId, employment_status: 'terminated' },
    select: {
      id: true, employee_code: true, left_at: true, notice_end_date: true, joined_at: true, worker_type: true,
      person: { select: { name: true, email: true } }, department: { select: { name: true } }, designation: { select: { name: true } },
    },
  });
  const records = await prisma.fnfRecord.findMany({ where: { org_id: orgId, org_membership_id: { in: members.map((m) => m.id) } } });
  const byMember = new Map(records.map((r) => [r.org_membership_id, r]));
  const rows = members
    .filter((m) => m.worker_type !== 'contractor')
    .map((m) => {
      const r = byMember.get(m.id) || null;
      return {
        org_membership_id: m.id,
        name: m.person?.name || null,
        email: m.person?.email || null,
        employee_code: m.employee_code,
        department: m.department?.name || null,
        designation: m.designation?.name || null,
        joined_at: ymd(m.joined_at),
        last_working_day: ymd(m.left_at || m.notice_end_date),
        fnf: r && { id: r.id, amount: money(r.amount), start_date: ymd(r.start_date), fnf_date: ymd(r.fnf_date), status: r.status, notes: r.notes, updated_at: r.updated_at },
        status: r ? r.status : 'not_started',
      };
    })
    .filter((row) => !status || row.status === status)
    .sort((a, b) => String(b.last_working_day || '').localeCompare(String(a.last_working_day || '')));
  return rows;
}

/** Fills in / updates one exited employee's FnF (starts it if there is none). Settling stamps today as the FnF date if empty. */
async function upsert(orgId, adminUserId, orgMembershipId, patch) {
  const member = await prisma.orgMembership.findFirst({ where: { id: orgMembershipId, org_id: orgId }, select: { id: true, employment_status: true, left_at: true, notice_end_date: true } });
  if (!member) return { error: 'not_found' };
  if (member.employment_status !== 'terminated') return { error: 'not_exited' };
  const data = { updated_by: adminUserId };
  for (const key of ['amount', 'notes', 'status']) if (patch[key] !== undefined) data[key] = patch[key];
  for (const key of ['start_date', 'fnf_date']) if (patch[key] !== undefined) data[key] = patch[key];
  const existing = await prisma.fnfRecord.findUnique({ where: { org_membership_id: orgMembershipId } });
  const status = data.status || existing?.status || 'pending';
  if (status === 'settled' && !(data.fnf_date ?? existing?.fnf_date)) data.fnf_date = todayIst();
  const record = existing
    ? await prisma.fnfRecord.update({ where: { id: existing.id }, data })
    : await prisma.fnfRecord.create({ data: { org_id: orgId, org_membership_id: orgMembershipId, start_date: member.left_at || member.notice_end_date || null, ...data } });
  return { record };
}

module.exports = { list, upsert };
