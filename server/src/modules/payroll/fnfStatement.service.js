const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const prisma = require('../../config/db');
const env = require('../../config/env');
const { enqueue } = require('../../lib/email/outbox');
const { payslipPdf, fnfStatementPdf } = require('./payslipPdf');

// FnF statement of an exited employee: what is still payable to them (salary not yet paid, the last month, lines added by hand such as leave
// encashment) and what is recovered, plus the documents package (the statement and every salary slip since joining) to download or to email.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const MAX_EMAIL_BYTES = 3 * 1024 * 1024; // the mail provider's simple attachment limit

function serviceText(from, to) {
  if (!from || !to) return null;
  const a = new Date(from);
  const b = new Date(to);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  let days = b.getUTCDate() - a.getUTCDate() + 1;
  if (days < 0) { months -= 1; days += 30; }
  if (months < 0) return null;
  const years = Math.floor(months / 12);
  return [years ? `${years} year${years === 1 ? '' : 's'}` : null, months % 12 ? `${months % 12} month${months % 12 === 1 ? '' : 's'}` : null, days > 0 && !years ? `${Math.min(days, 30)} day${days === 1 ? '' : 's'}` : null].filter(Boolean).join(' ') || 'Less than a month';
}

const cleanItems = (items) => (Array.isArray(items) ? items : []).filter((i) => i && i.label && Number(i.amount) > 0 && ['earning', 'deduction'].includes(i.kind)).map((i) => ({ label: String(i.label).slice(0, 120), kind: i.kind, amount: round2(i.amount), ...(i.note ? { note: String(i.note).slice(0, 200) } : {}) }));

/** The statement for one exited employee, or { error }. */
async function build(orgId, membershipId) {
  const member = await prisma.orgMembership.findFirst({
    where: { id: membershipId, org_id: orgId },
    select: {
      id: true, employee_code: true, joined_at: true, left_at: true, notice_end_date: true, employment_status: true,
      person: { select: { name: true, email: true } }, department: { select: { name: true } }, designation: { select: { name: true } },
    },
  });
  if (!member) return { error: 'not_found' };
  if (member.employment_status !== 'terminated') return { error: 'not_exited' };
  const last = member.left_at || member.notice_end_date;

  const [record, payslips, payments, structures] = await Promise.all([
    prisma.fnfRecord.findUnique({ where: { org_membership_id: membershipId } }),
    prisma.payslip.findMany({ where: { org_id: orgId, org_membership_id: membershipId }, include: { payroll_run: { select: { period_month: true, period_year: true, status: true } } } }),
    prisma.salaryPayment.findMany({ where: { org_id: orgId, org_membership_id: membershipId } }),
    prisma.salaryStructure.findMany({ where: { org_id: orgId, org_membership_id: membershipId }, orderBy: { effective_from: 'asc' } }),
  ]);
  const paidBy = new Map(payments.map((p) => [`${p.period_year}-${p.period_month}`, Number(p.amount_paid)]));
  const slips = payslips
    .filter((p) => p.payroll_run.status === 'processed')
    .map((p) => ({ id: p.id, month: p.payroll_run.period_month, year: p.payroll_run.period_year, net: Number(p.net), paid: paidBy.has(`${p.payroll_run.period_year}-${p.payroll_run.period_month}`) ? paidBy.get(`${p.payroll_run.period_year}-${p.payroll_run.period_month}`) : null }))
    .sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month));

  const earnings = [];
  const deductions = [];
  // salary on a payslip that has not been paid (or only part of it)
  for (const s of slips) {
    if (s.paid === null) continue; // payment never recorded: nothing to claim from here, the register shows it
    const due = round2(s.net - s.paid);
    if (due > 1) earnings.push({ label: `Salary due: ${MONTHS[s.month - 1]} ${s.year}`, amount: due, note: `net ${s.net}, paid ${s.paid}`, auto: true });
  }
  // the last month, when it has no payslip yet: worked out now, up to the last working day
  if (last) {
    const lm = new Date(last).getUTCMonth() + 1;
    const ly = new Date(last).getUTCFullYear();
    if (!slips.some((s) => s.month === lm && s.year === ly)) {
      try {
        const salaryEngine = require('../calculations/engines/salary.engine');
        const month = await salaryEngine.computeSalary(orgId, { period_month: lm, period_year: ly, filters: { org_membership_id: membershipId } });
        const line = month.lines[0];
        if (line && line.net > 0) earnings.push({ label: `Salary for ${MONTHS[lm - 1]} ${ly} (till the last working day)`, amount: round2(line.net), note: 'worked out from attendance; not processed in payroll yet', auto: true });
      } catch { /* the figure is optional: add it by hand */ }
    }
  }
  const manual = cleanItems(record?.items);
  for (const i of manual) (i.kind === 'earning' ? earnings : deductions).push({ label: i.label, amount: i.amount, note: i.note, auto: false });

  let balances = [];
  try {
    const leaveService = require('../leave/leave.service');
    balances = (await leaveService.listMyBalances(orgId, membershipId, last ? new Date(last).getUTCFullYear() : new Date().getUTCFullYear())).filter((b) => b.remaining !== undefined).map((b) => ({ name: b.name || b.code, code: b.code, remaining: b.remaining }));
  } catch { balances = []; }

  const totalEarnings = round2(earnings.reduce((s, l) => s + l.amount, 0));
  const totalDeductions = round2(deductions.reduce((s, l) => s + l.amount, 0));
  return {
    org_membership_id: membershipId,
    employee: {
      name: member.person?.name || null, email: member.person?.email || null, employee_code: member.employee_code, department: member.department?.name || null, designation: member.designation?.name || null,
      joined_at: ymd(member.joined_at), last_working_day: ymd(last), service_text: serviceText(member.joined_at, last),
    },
    status: record?.status || 'not_started',
    notes: record?.notes || null,
    earnings,
    deductions,
    items: manual,
    totals: { earnings: totalEarnings, deductions: totalDeductions, net_payable: round2(totalEarnings - totalDeductions), recorded_amount: record?.amount != null ? Number(record.amount) : null },
    leave_balances: balances,
    salary_history: structures.map((s) => ({ effective_from: ymd(s.effective_from), ctc: Number(s.ctc) })),
    payslips: slips.map((s) => ({ id: s.id, period: `${MONTHS[s.month - 1]} ${s.year}`, month: s.month, year: s.year, net: s.net, paid: s.paid })),
  };
}

/** Replaces the lines added by hand (leave encashment, notice recovery, advances ...). */
async function setItems(orgId, userId, membershipId, items) {
  const member = await prisma.orgMembership.findFirst({ where: { id: membershipId, org_id: orgId }, select: { id: true, employment_status: true, left_at: true, notice_end_date: true } });
  if (!member) return { error: 'not_found' };
  if (member.employment_status !== 'terminated') return { error: 'not_exited' };
  const clean = cleanItems(items);
  const existing = await prisma.fnfRecord.findUnique({ where: { org_membership_id: membershipId } });
  if (existing) await prisma.fnfRecord.update({ where: { id: existing.id }, data: { items: clean, updated_by: userId } });
  else await prisma.fnfRecord.create({ data: { org_id: orgId, org_membership_id: membershipId, start_date: member.left_at || member.notice_end_date || null, items: clean, updated_by: userId } });
  await prisma.auditLog.create({ data: { org_id: orgId, actor_id: userId, action: 'fnf_items_saved', entity_type: 'fnf_record', entity_id: membershipId, reason: `${clean.length} line(s) on the FnF statement`, snapshot: { items: clean } } });
  return { items: clean };
}

async function orgName(orgId) {
  return (await prisma.org.findUnique({ where: { id: orgId }, select: { name: true } }))?.name || 'Delphic';
}

async function statementPdf(orgId, membershipId) {
  const s = await build(orgId, membershipId);
  if (s.error) return s;
  return { buffer: await fnfStatementPdf(s, await orgName(orgId)), name: `FnF-Statement-${(s.employee.name || 'employee').replace(/[^\w-]+/g, '-')}.pdf` };
}

/** The documents package: the FnF statement and every processed salary slip since joining, in one zip. */
async function packageZip(orgId, membershipId) {
  const s = await build(orgId, membershipId);
  if (s.error) return s;
  const payroll = require('./payroll.service');
  const name = await orgName(orgId);
  const zip = new JSZip();
  zip.file('FnF-Statement.pdf', await fnfStatementPdf(s, name));
  const folder = zip.folder('Salary-Slips');
  for (const p of s.payslips) {
    const got = await payroll.getPayslip(orgId, p.id, { isAdmin: true });
    if (got.error) continue;
    folder.file(`${p.year}-${String(p.month).padStart(2, '0')}-Salary-Slip.pdf`, await payslipPdf(got.payslip, name));
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { buffer, name: `FnF-Documents-${(s.employee.name || 'employee').replace(/[^\w-]+/g, '-')}.zip`, payslips: s.payslips.length, employee: s.employee };
}

/** Emails the package to the person (to their personal address: the work mailbox is usually closed on exit). */
async function emailPackage(orgId, user, membershipId, { to_email, note }) {
  const pack = await packageZip(orgId, membershipId);
  if (pack.error) return pack;
  if (pack.buffer.length > MAX_EMAIL_BYTES) return { error: 'too_large', bytes: pack.buffer.length };
  fs.mkdirSync(env.uploadDir, { recursive: true });
  const file = path.join(env.uploadDir, `fnf-${membershipId}-${Date.now()}.zip`);
  fs.writeFileSync(file, pack.buffer);
  const org = await orgName(orgId);
  const text = `Dear ${pack.employee.name || 'colleague'},\n\nPlease find attached the documents of your employment with ${org}: your Full & Final Settlement statement and your salary slips${pack.employee.joined_at ? ` since you joined on ${pack.employee.joined_at}` : ''} (${pack.payslips} salary slip${pack.payslips === 1 ? '' : 's'}).${note ? `\n\n${note}` : ''}\n\nWe wish you all the best.\n\nRegards,\n${user.name || 'HR team'}\n${org}`;
  const row = await enqueue(prisma, { orgId, kind: 'fnf_documents', to: { email: to_email, name: pack.employee.name }, subject: `Your Full & Final settlement documents - ${org}`, text, attachment: { path: file, name: pack.name } });
  if (!row) { fs.promises.unlink(file).catch(() => {}); return { error: 'not_queued' }; }
  await prisma.auditLog.create({ data: { org_id: orgId, actor_id: user.id, action: 'fnf_documents_emailed', entity_type: 'fnf_record', entity_id: membershipId, reason: `Documents package emailed to ${to_email}`, snapshot: { to: to_email, payslips: pack.payslips, bytes: pack.buffer.length } } });
  return { queued: true, to: to_email, payslips: pack.payslips, bytes: pack.buffer.length };
}

module.exports = { build, setItems, statementPdf, packageZip, emailPackage };
