const prisma = require('../../config/db');
const calc = require('../cashPosition/cash.calc');
const payments = require('../payments/payments.service');
const financialLock = require('../calculations/financialLock');

const { D, money } = calc;
const KIND = 'client_invoice';

// Part payments on a client invoice (Live Analytics > Billing & Sales, Finance > Invoicing). The invoice stays "sent" until what was paid
// reaches what the client has to pay (the payable total: approved amount + GST - TDS and the other charges), then it is "paid"; undoing a
// payment (group admin) can bring it back to "sent". An invoice already marked paid stays paid.

const findInvoice = (orgId, id) => prisma.clientInvoice.findFirst({ where: { id, org_id: orgId, deleted_at: null }, include: { client_account: { select: { name: true, project_name: true } } } });

async function paidOf(orgId, id) {
  return (await payments.totals(prisma, orgId, KIND, [id])).get(id).paid;
}

/** What the client has to pay for an invoice: the payable total (amount + GST - TDS ...); the plain amount when it has no charges. */
function dueOf(row) {
  const items = row.line_items && !Array.isArray(row.line_items) ? row.line_items : null;
  const total = items && items.details && items.details.total_amount !== undefined && items.details.total_amount !== null ? Number(items.details.total_amount) : null;
  return total !== null && Number.isFinite(total) ? total : Number(row.amount);
}

/** What the invoice list / page shows about payments: paid, pending and paid / partly paid / unpaid. */
function withPayments(invoice, total) {
  // An invoice marked paid before payments were recorded has no payment rows: it counts as fully paid, not as pending.
  const due = invoice.total_amount !== undefined && invoice.total_amount !== null ? invoice.total_amount : invoice.amount;
  const paid = invoice.status === 'paid' && total.count === 0 ? D(due) : total.paid;
  const summary = payments.summarize(due, paid);
  // A paid invoice is closed: what it was settled with is not chased again (older invoices were settled on the amount before GST / TDS).
  if (invoice.status === 'paid') return { ...invoice, ...summary, pending_amount: money(calc.ZERO), payment_status: 'paid', payments_count: total.count };
  return { ...invoice, ...summary, payments_count: total.count };
}

async function list(orgId, invoiceId) {
  const invoice = await findInvoice(orgId, invoiceId);
  if (!invoice) return { error: 'not_found' };
  return { payments: await payments.list(orgId, KIND, invoiceId, { includeUndone: true }) };
}

/**
 * Records one payment. `input` is the validated payment body; with no amount the whole pending amount is paid. A foreign-currency invoice
 * with no typed rate uses the company's saved rate for that currency (the screens always send the typed one).
 */
async function record(orgId, user, invoiceId, input) {
  const invoice = await findInvoice(orgId, invoiceId);
  if (!invoice) return { error: 'not_found' };
  if (invoice.status !== 'sent') return { error: 'invalid_transition' };
  const frozen = await financialLock.assertOpen(orgId, invoice.period_month, invoice.period_year);
  if (frozen) return frozen;

  const due = dueOf(invoice);
  const paid = await paidOf(orgId, invoiceId);
  const pending = D(due).minus(paid);
  const body = await payments.withSavedRate(orgId, invoice.currency, { ...input, amount: input.amount || money(pending) });
  const prepared = await payments.prepare({
    orgId, user, input: body,
    record: { kind: KIND, id: invoice.id, currency: invoice.currency, pending, party: invoice.client_account?.project_name || invoice.client_account?.name || null, category: `Invoice ${invoice.invoice_number || `${invoice.period_month}/${invoice.period_year}`}` },
  });
  if (prepared.error) return { error: prepared.error };

  const result = await prisma.$transaction(async (tx) => {
    const payment = await prepared.commit(tx);
    const total = D(paid).plus(payment.amount);
    const row = total.gte(due)
      ? await tx.clientInvoice.update({ where: { id: invoice.id }, data: { status: 'paid', paid_at: new Date() } })
      : invoice;
    return { payment, row, total };
  });
  const count = (await payments.totals(prisma, orgId, KIND, [invoiceId])).get(invoiceId).count;
  return { payment: payments.serialize(result.payment, null), invoice: withPayments({ id: result.row.id, status: result.row.status, amount: Number(invoice.amount), total_amount: due, currency: invoice.currency }, { paid: result.total, count }) };
}

/** Undo one payment (the route only lets the group admin in): it stops counting and its wallet entry goes; a paid invoice can drop back to sent. */
async function undo(orgId, user, invoiceId, paymentId, reason) {
  const invoice = await findInvoice(orgId, invoiceId);
  if (!invoice) return { error: 'not_found' };
  const frozen = await financialLock.assertOpen(orgId, invoice.period_month, invoice.period_year);
  if (frozen) return frozen;
  const out = await prisma.$transaction(async (tx) => {
    const done = await payments.undoWithin(tx, { orgId, user, kind: KIND, referenceId: invoiceId, paymentId, reason });
    if (done.error) return done;
    const total = (await payments.totals(tx, orgId, KIND, [invoiceId])).get(invoiceId);
    if (invoice.status === 'paid' && D(total.paid).lt(dueOf(invoice))) {
      await tx.clientInvoice.update({ where: { id: invoiceId }, data: { status: 'sent', paid_at: null } });
    }
    return { total };
  });
  if (out.error) return out;
  const status = invoice.status === 'paid' && D(out.total.paid).lt(dueOf(invoice)) ? 'sent' : invoice.status;
  return { invoice: withPayments({ id: invoiceId, status, amount: Number(invoice.amount), total_amount: dueOf(invoice), currency: invoice.currency }, out.total) };
}

/** Edit one payment of an invoice (group admin): same fields as recording one; the invoice goes paid / back to sent by the new total. */
async function edit(orgId, user, invoiceId, paymentId, input) {
  const invoice = await findInvoice(orgId, invoiceId);
  if (!invoice) return { error: 'not_found' };
  const frozen = await financialLock.assertOpen(orgId, invoice.period_month, invoice.period_year);
  if (frozen) return frozen;
  const old = await prisma.paymentRecord.findFirst({ where: { id: paymentId, org_id: orgId, kind: KIND, reference_id: invoiceId } });
  if (!old) return { error: 'payment_not_found' };
  if (old.deleted_at) return { error: 'already_undone' };

  const paidWithout = D(await paidOf(orgId, invoiceId)).minus(old.amount);
  const pending = D(dueOf(invoice)).minus(paidWithout);
  const body = await payments.withSavedRate(orgId, invoice.currency, { ...input, amount: input.amount || money(old.amount) });
  const done = await payments.replace({
    orgId, user, kind: KIND, referenceId: invoiceId, paymentId, input: body, reason: input.reason,
    record: { kind: KIND, id: invoice.id, currency: invoice.currency, pending, party: invoice.client_account?.project_name || invoice.client_account?.name || null, category: `Invoice ${invoice.invoice_number || `${invoice.period_month}/${invoice.period_year}`}` },
  });
  if (done.error) return { error: done.error };
  const total = (await payments.totals(prisma, orgId, KIND, [invoiceId])).get(invoiceId);
  let status = invoice.status;
  if (D(total.paid).gte(dueOf(invoice)) && status === 'sent') {
    await prisma.clientInvoice.update({ where: { id: invoiceId }, data: { status: 'paid', paid_at: new Date() } });
    status = 'paid';
  } else if (D(total.paid).lt(dueOf(invoice)) && status === 'paid') {
    await prisma.clientInvoice.update({ where: { id: invoiceId }, data: { status: 'sent', paid_at: null } });
    status = 'sent';
  }
  return { payment: payments.serialize(done.payment, null), invoice: withPayments({ id: invoiceId, status, amount: Number(invoice.amount), total_amount: dueOf(invoice), currency: invoice.currency }, total) };
}

module.exports = { KIND, dueOf, withPayments, list, record, undo, edit };
