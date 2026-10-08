// Invoice state of a project month for Live Analytics and the Finance views:
//   Generated / Not generated, Sent / Unsent, Paid / Unpaid.
// A client invoice is draft -> sent -> paid (ClientInvoice.status); `sent_at` also marks it sent.

const prisma = require('../../config/db');

const FILTERS = ['all', 'generated', 'not_generated', 'paid', 'unpaid', 'sent', 'unsent'];

function describe(invoice) {
  if (!invoice) return { id: null, generated: false, status: 'not_generated', sent: false, paid: false, number: null, date: null, amount: null, currency: null };
  const paid = invoice.status === 'paid';
  const sent = paid || invoice.status === 'sent' || Boolean(invoice.sent_at);
  return {
    id: invoice.id,
    generated: true,
    status: invoice.status,
    sent,
    paid,
    number: invoice.invoice_number || null,
    date: invoice.invoice_date ? invoice.invoice_date.toISOString().slice(0, 10) : null,
    amount: invoice.amount === undefined || invoice.amount === null ? null : Number(invoice.amount),
    currency: invoice.currency || null,
  };
}

// Does the invoice state satisfy the chosen filter? "Unpaid" / "Unsent" only apply to a generated invoice.
function matches(info, filter) {
  switch (filter) {
    case 'generated': return info.generated;
    case 'not_generated': return !info.generated;
    case 'paid': return info.paid;
    case 'unpaid': return info.generated && !info.paid;
    case 'sent': return info.sent;
    case 'unsent': return info.generated && !info.sent;
    default: return true;
  }
}

// Map "projectId|year-month" -> invoice state, for the given projects and months.
async function load(orgId, projectIds, months) {
  const out = new Map();
  if (!projectIds.length || !months.length) return out;
  const rows = await prisma.clientInvoice.findMany({
    where: {
      org_id: orgId,
      client_account_id: { in: projectIds },
      OR: months.map((m) => ({ period_month: m.period_month, period_year: m.period_year })),
    },
    select: { id: true, client_account_id: true, period_month: true, period_year: true, status: true, sent_at: true, paid_at: true, invoice_number: true, invoice_date: true, amount: true, currency: true },
  });
  for (const r of rows) out.set(`${r.client_account_id}|${r.period_year}-${r.period_month}`, describe(r));
  return out;
}

const keyOf = (projectId, month, year) => `${projectId}|${year}-${month}`;

// monthly / hourly / mixed (resources billed on different types in the same month) for a project row.
function billingTypeOf(row) {
  const types = new Set([row.billing_type, ...(row.resource_rates || []).map((r) => r.rate_type)].filter(Boolean));
  if (types.size > 1) return 'mixed';
  return [...types][0] || null;
}

// What Finance still has to do, across a set of rows that carry `invoice`.
function summarize(infos) {
  const generated = infos.filter((i) => i.generated);
  return {
    projects: infos.length,
    not_generated: infos.filter((i) => !i.generated).length,
    generated: generated.length,
    unsent: generated.filter((i) => !i.sent).length,
    sent: generated.filter((i) => i.sent).length,
    unpaid: generated.filter((i) => !i.paid).length,
    paid: generated.filter((i) => i.paid).length,
  };
}

module.exports = { FILTERS, describe, matches, load, keyOf, summarize, billingTypeOf };
