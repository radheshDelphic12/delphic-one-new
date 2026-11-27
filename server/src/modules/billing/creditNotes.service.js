const { z } = require('zod');
const PDFDocument = require('pdfkit');
const prisma = require('../../config/db');

// Finance > Credit notes. A credit note is a numbered credit of an amount:
//   to a client  - reduces what the client owes (on one invoice when chosen: its pending amount drops, and it is paid once paid + credited
//                  covers it);
//   from a vendor - reduces what we owe the vendor (on one vendor invoice when chosen: its net payable drops).
// Numbers run per company and financial year: CN/2026-27/0001. A credit note is never deleted; it is cancelled with a reason.

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const fyOf = (date) => { const d = new Date(date); const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; };

const createSchema = z.object({
  party_type: z.enum(['client', 'vendor']),
  account_id: z.string().uuid(),
  invoice_id: z.string().uuid().optional(),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31').optional(),
  amount: z.coerce.number().positive('Enter the amount').max(1e12),
  currency: z.enum(['INR', 'USD', 'AED', 'EUR', 'GBP', 'SAR']).optional(),
  reason: z.string().trim().min(3, 'Give the reason').max(1000),
});
const cancelSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) });
const listSchema = z.object({ party_type: z.enum(['client', 'vendor']).optional(), status: z.enum(['issued', 'cancelled']).optional(), account_id: z.string().uuid().optional() });

/** Issued credit per invoice id (for invoice lists). */
async function creditedByInvoice(orgId, kind, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows = await prisma.creditNote.groupBy({ by: ['invoice_id'], where: { org_id: orgId, invoice_kind: kind, invoice_id: { in: ids }, status: 'issued' }, _sum: { amount: true } });
  for (const r of rows) out.set(r.invoice_id, round2(r._sum.amount || 0));
  return out;
}
const creditedOf = async (orgId, kind, id) => (await creditedByInvoice(orgId, kind, [id])).get(id) || 0;

async function nextNumber(tx, orgId, issueDate) {
  const fy = fyOf(issueDate);
  const prefix = `CN/${fy}/`;
  const last = await tx.creditNote.findFirst({ where: { org_id: orgId, number: { startsWith: prefix } }, orderBy: { number: 'desc' }, select: { number: true } });
  const seq = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/** The invoice a credit note is written against, with what is still open on it. */
async function invoiceFor(orgId, partyType, accountId, invoiceId) {
  if (!invoiceId) return { invoice: null };
  if (partyType === 'client') {
    const inv = await prisma.clientInvoice.findFirst({ where: { id: invoiceId, org_id: orgId, deleted_at: null } });
    if (!inv) return { error: 'invoice_not_found' };
    const ownsIt = inv.client_account_id === accountId || (inv.line_items?.consolidated && (inv.line_items.items || []).some((i) => i.account_id === accountId));
    if (!ownsIt) return { error: 'invoice_not_found' };
    if (inv.cancelled_at || inv.status === 'cancelled') return { error: 'invoice_cancelled' };
    const payments = require('../payments/payments.service');
    const due = require('./invoicePayments.service').dueOf(inv);
    const paid = Number((await payments.totals(prisma, orgId, 'client_invoice', [inv.id])).get(inv.id).paid);
    const credited = await creditedOf(orgId, 'client_invoice', inv.id);
    return { invoice: inv, kind: 'client_invoice', currency: inv.currency, open: round2(due - paid - credited), due, paid };
  }
  const inv = await prisma.projectVendorInvoice.findFirst({ where: { id: invoiceId, org_id: orgId } });
  if (!inv || inv.vendor_account_id !== accountId) return { error: 'invoice_not_found' };
  const net = Number(inv.amount) + Number(inv.gst_amount || 0) + Number(inv.other_amount || 0) - Number(inv.tds_amount || 0) + Number(inv.adjustment_amount || 0);
  const credited = await creditedOf(orgId, 'vendor_invoice', inv.id);
  return { invoice: inv, kind: 'vendor_invoice', currency: inv.currency, open: round2(net - credited) };
}

/** A client invoice is paid when payments + credit notes cover it; back to sent when a cancelled credit note re-opens it. */
async function settleClientInvoice(orgId, invoiceId) {
  const inv = await prisma.clientInvoice.findFirst({ where: { id: invoiceId, org_id: orgId } });
  if (!inv || !['sent', 'paid'].includes(inv.status)) return;
  const payments = require('../payments/payments.service');
  const due = require('./invoicePayments.service').dueOf(inv);
  const paid = Number((await payments.totals(prisma, orgId, 'client_invoice', [inv.id])).get(inv.id).paid);
  const credited = await creditedOf(orgId, 'client_invoice', inv.id);
  if (inv.status === 'sent' && paid + credited >= due - 0.005) await prisma.clientInvoice.update({ where: { id: inv.id }, data: { status: 'paid', paid_at: new Date() } });
  else if (inv.status === 'paid' && paid + credited < due - 0.005 && credited + paid > 0) await prisma.clientInvoice.update({ where: { id: inv.id }, data: { status: 'sent', paid_at: null } });
}

async function create(orgId, user, input) {
  const account = await prisma.account.findFirst({ where: { id: input.account_id, org_id: orgId, type: input.party_type === 'client' ? 'client' : 'vendor' }, select: { id: true, name: true, project_name: true } });
  if (!account) return { error: 'account_not_found' };
  const found = await invoiceFor(orgId, input.party_type, input.account_id, input.invoice_id);
  if (found.error) return found;
  if (found.invoice && input.amount > found.open + 0.005) return { error: 'more_than_open', open: found.open, currency: found.currency };
  const issueDate = new Date(`${input.issue_date || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const note = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, orgId, issueDate);
    return tx.creditNote.create({
      data: {
        org_id: orgId, number, party_type: input.party_type, account_id: account.id, invoice_kind: found.kind || null, invoice_id: found.invoice?.id || null,
        issue_date: issueDate, amount: input.amount, currency: found.currency || input.currency || 'INR', reason: input.reason, created_by: user.id,
      },
    });
  });
  if (found.kind === 'client_invoice') await settleClientInvoice(orgId, found.invoice.id);
  await prisma.auditLog.create({ data: { org_id: orgId, actor_id: user.id, action: 'credit_note_issue', entity_type: 'credit_note', entity_id: note.id, reason: `${note.number} ${input.party_type} ${account.name}: ${note.currency} ${input.amount} - ${input.reason}` } }).catch(() => null);
  return { note: (await shape(orgId, [note]))[0] };
}

async function cancel(orgId, user, id, reason) {
  const note = await prisma.creditNote.findFirst({ where: { id, org_id: orgId } });
  if (!note) return { error: 'not_found' };
  if (note.status === 'cancelled') return { error: 'already_cancelled' };
  const row = await prisma.creditNote.update({ where: { id }, data: { status: 'cancelled', cancel_reason: reason, cancelled_at: new Date() } });
  if (note.invoice_kind === 'client_invoice') await settleClientInvoice(orgId, note.invoice_id);
  await prisma.auditLog.create({ data: { org_id: orgId, actor_id: user.id, action: 'credit_note_cancel', entity_type: 'credit_note', entity_id: id, reason: `${note.number}: ${reason}` } }).catch(() => null);
  return { note: (await shape(orgId, [row]))[0] };
}

async function shape(orgId, rows) {
  const accounts = await prisma.account.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.account_id))] } }, select: { id: true, name: true, project_name: true } });
  const accName = new Map(accounts.map((a) => [a.id, a.project_name || a.name]));
  const clientInv = rows.filter((r) => r.invoice_kind === 'client_invoice').map((r) => r.invoice_id);
  const vendorInv = rows.filter((r) => r.invoice_kind === 'vendor_invoice').map((r) => r.invoice_id);
  const [ci, vi] = await Promise.all([
    clientInv.length ? prisma.clientInvoice.findMany({ where: { id: { in: clientInv } }, select: { id: true, invoice_number: true } }) : [],
    vendorInv.length ? prisma.projectVendorInvoice.findMany({ where: { id: { in: vendorInv } }, select: { id: true, invoice_number: true } }) : [],
  ]);
  const invNo = new Map([...ci, ...vi].map((i) => [i.id, i.invoice_number]));
  return rows.map((r) => ({
    id: r.id, number: r.number, party_type: r.party_type, account: { id: r.account_id, name: accName.get(r.account_id) || 'Account' },
    invoice: r.invoice_id ? { id: r.invoice_id, kind: r.invoice_kind, number: invNo.get(r.invoice_id) || null } : null,
    issue_date: ymd(r.issue_date), amount: Number(r.amount), currency: r.currency, reason: r.reason, status: r.status, cancel_reason: r.cancel_reason, cancelled_at: r.cancelled_at, created_at: r.created_at,
  }));
}

async function list(orgId, q) {
  const rows = await prisma.creditNote.findMany({ where: { org_id: orgId, ...(q.party_type ? { party_type: q.party_type } : {}), ...(q.status ? { status: q.status } : {}), ...(q.account_id ? { account_id: q.account_id } : {}) }, orderBy: [{ issue_date: 'desc' }, { number: 'desc' }], take: 500 });
  return shape(orgId, rows);
}

/** The credit note as a one-page PDF. */
async function pdf(orgId, id) {
  const note = await prisma.creditNote.findFirst({ where: { id, org_id: orgId } });
  if (!note) return { error: 'not_found' };
  const [v] = await shape(orgId, [note]);
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { name: true } });
  const buf = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `Credit note ${v.number}` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.fillColor('#105aa9').font('Helvetica-Bold').fontSize(18).text(org?.name || '', { align: 'left' });
    doc.moveDown(0.4).fillColor('#0f172a').fontSize(15).text(v.party_type === 'client' ? 'CREDIT NOTE' : 'CREDIT NOTE (from vendor)');
    doc.moveDown(0.8).font('Helvetica').fontSize(10.5);
    const line = (k, val) => { doc.fillColor('#64748b').text(`${k}: `, { continued: true }).fillColor('#0f172a').font('Helvetica-Bold').text(String(val)).font('Helvetica'); };
    line('Credit note no.', v.number);
    line('Date', v.issue_date);
    line(v.party_type === 'client' ? 'Client' : 'Vendor', v.account.name);
    if (v.invoice) line('Against invoice', v.invoice.number || v.invoice.id);
    line('Amount', `${v.currency} ${v.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    doc.moveDown(0.6).fillColor('#64748b').text('Reason').fillColor('#0f172a').text(v.reason, { width: 480 });
    if (v.status === 'cancelled') doc.moveDown(1).fillColor('#b91c1c').font('Helvetica-Bold').text(`CANCELLED: ${v.cancel_reason || ''}`);
    doc.end();
  });
  return { buffer: buf, filename: `credit-note-${v.number.replace(/\//g, '-')}.pdf` };
}

module.exports = { createSchema, cancelSchema, listSchema, create, cancel, list, pdf, creditedByInvoice, creditedOf };
