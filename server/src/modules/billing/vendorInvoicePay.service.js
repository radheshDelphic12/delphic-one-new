const prisma = require('../../config/db');

// Finance > Vendor Invoices > "Record payment". A vendor invoice is paid when the vendor payment of that vendor and month is paid
// (one payment covers all of the vendor's project invoices of the month). Until now that payment could only be made in
// Live Analytics > Vendor payments; this does the same steps from the invoice: the month's vendor payment is found (or created for
// the total of the vendor's invoices of that month), approved if still pending, then paid through the one payment popup.

const round2 = (n) => Math.round(Number(n) * 100) / 100;
// lazy: the invoices and expenses services load the calculation engines
const invoices = () => require('./invoices.service');
const expenses = () => require('../expenses/expenses.service');

/** What paying this invoice would pay: the vendor's invoices of the same month and currency, and their total. */
async function paymentPreview(orgId, invoiceId) {
  const invoice = await prisma.projectVendorInvoice.findFirst({ where: { id: invoiceId, org_id: orgId }, select: { id: true, vendor_account_id: true, period_month: true, period_year: true } });
  if (!invoice) return { error: 'not_found' };
  const month = await invoices().listVendorInvoices(orgId, { period_month: invoice.period_month, period_year: invoice.period_year, vendor_account_id: invoice.vendor_account_id });
  const me = month.find((r) => r.id === invoiceId);
  const same = month.filter((r) => r.currency === me.currency);
  if (same.length !== month.length) return { error: 'mixed_currencies' };
  const payment = await prisma.vendorPayment.findFirst({
    where: { org_id: orgId, vendor_account_id: invoice.vendor_account_id, period_month: invoice.period_month, period_year: invoice.period_year, status: { in: ['pending', 'approved', 'paid'] } },
    orderBy: { created_at: 'desc' },
  });
  return {
    invoice, payment,
    currency: me.currency,
    vendor_name: me.vendor_account?.name || 'Vendor',
    amount: payment ? Number(payment.amount) : round2(same.reduce((s, r) => s + Number(r.net_payable || 0), 0)),
    invoices: same.map((r) => ({ id: r.id, invoice_number: r.invoice_number, net_payable: r.net_payable })),
  };
}

async function recordPayment(orgId, user, invoiceId, input) {
  const p = await paymentPreview(orgId, invoiceId);
  if (p.error) return p;
  if (p.payment?.status === 'paid') return { error: 'already_paid' };
  let payment = p.payment;
  if (!payment) {
    if (!(p.amount > 0)) return { error: 'nothing_to_pay' };
    payment = await prisma.vendorPayment.create({
      data: {
        org_id: orgId, vendor_name: p.vendor_name, vendor_type: 'contractor', vendor_account_id: p.invoice.vendor_account_id,
        amount: p.amount, currency: p.currency, period_month: p.invoice.period_month, period_year: p.invoice.period_year,
        status: 'approved', created_by: user.id, decided_by: user.id, decided_at: new Date(), decision_reason: 'Paid from Finance > Vendor Invoices',
      },
    });
  } else if (payment.status === 'pending') {
    const decided = await expenses().decideVendorPayment(orgId, payment.id, user.id, { status: 'approved', reason: 'Approved while paying from Finance > Vendor Invoices' });
    if (decided.error) return decided;
    payment = decided.payment;
  }
  const paid = await expenses().markVendorPaymentPaid(orgId, payment.id, { user, input });
  if (paid.error) return paid;
  return { payment: { id: paid.payment.id, status: paid.payment.status, amount: Number(paid.payment.amount), currency: paid.payment.currency }, invoices: p.invoices };
}

module.exports = { paymentPreview, recordPayment };
