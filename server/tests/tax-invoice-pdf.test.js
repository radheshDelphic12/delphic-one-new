// The shared tax-invoice layout: amount in words, the GST invoice mapping, and the client / vendor invoice models.
// No database: the company and account lookups of the billing mapping are mocked.

jest.mock('../src/config/db', () => ({
  org: { findUnique: jest.fn(async () => ({ name: 'Delphic Global' })) },
  legalEntity: {
    findFirst: jest.fn(async () => ({
      name: 'Delphic', address: 'Rudrapur, Uttarakhand', gstin: '05AGYPG8954H1ZQ', pan: null, state_code: '05',
      bank_accounts: [{ currency: 'INR', payment_instructions: 'Bank Name : ICICI Bank\nA/c No. : 160005001749' }],
    })),
  },
  account: { findUnique: jest.fn(async ({ where }) => ({ id: where.id, name: 'Giglabz Private Limited', gst_or_tax_id: '29AAICG2065Q1ZY', location_city: 'Bangalore', location_country: 'India', location: null })) },
}));

const { amountInWords } = require('../src/lib/amountWords');
const { taxInvoicePdf } = require('../src/lib/taxInvoicePdf');
const { invoiceModel } = require('../src/modules/groupInvoices/invoices.pdf');
const { clientInvoiceModel, vendorInvoiceModels, clientInvoicePdf, vendorInvoicePdf } = require('../src/modules/billing/invoices.pdf');

describe('amount in words', () => {
  test('Indian system for INR, western for other currencies, paise and cents', () => {
    expect(amountInWords('107739.00', 'INR')).toBe('INR One Lakh Seven Thousand Seven Hundred Thirty Nine Only');
    expect(amountInWords('16434.78', 'INR')).toBe('INR Sixteen Thousand Four Hundred Thirty Four and Seventy Eight paise Only');
    expect(amountInWords('12345678', 'INR')).toBe('INR One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only');
    expect(amountInWords('2500.5', 'USD')).toBe('USD Two Thousand Five Hundred and Fifty cents Only');
    expect(amountInWords('1000000', 'USD')).toBe('USD One Million Only');
    expect(amountInWords('0', 'INR')).toBe('INR Zero Only');
  });
});

describe('GST / USD invoice model', () => {
  const base = {
    number: 'DEL/68/24-25', type: 'gst', currency: 'INR', status: 'issued', invoice_date: '2024-08-13', due_date: null,
    seller: { name: 'Delphic', address: 'Rudrapur', gstin: '05AGYPG8954H1ZQ', state_code: '05' },
    buyer_name: 'Giglabz', buyer_address: 'Bangalore', buyer_gstin: '29AAICG2065Q1ZY', buyer_state_code: '29', place_of_supply: '29',
    lines: [
      { description: 'Manpower Services\nApurva Dwivedi', hsn_sac: '998519', gst_rate: 18, qty: '21', unit: 'days', rate: '4347.83', amount: '91304.43' },
      { description: 'Hosting', hsn_sac: '998315', gst_rate: 5, qty: '1', unit: '', rate: '1000.00', amount: '1000.00' },
    ],
    subtotal: '92304.43', cgst: '0', sgst: '0', igst: '16484.80', total: '108789.23', payment_instructions: 'A/c No. : 1', notes: null,
  };

  test('date, place of supply, item details and a tax summary that adds up to the invoice', () => {
    const m = invoiceModel(base);
    expect(m.title).toBe('Tax Invoice');
    expect(m.meta.date).toBe('13-Aug-24');
    expect(m.place_of_supply).toBe('Karnataka');
    expect(m.jurisdiction).toBe('SUBJECT TO UTTARAKHAND JURISDICTION');
    expect(m.lines[0]).toMatchObject({ description: 'Manpower Services', details: ['Apurva Dwivedi'], unit: 'days' });
    expect(m.tax_summary.map((r) => r.rate)).toEqual([18, 5]);
    const igst = m.tax_summary.reduce((a, r) => a + Number(r.parts[0].amount), 0);
    expect(igst.toFixed(2)).toBe('16484.80');
  });

  test('inside the state the summary has CGST and SGST that add up; non-GST has no tax columns', () => {
    const m = invoiceModel({ ...base, buyer_state_code: '05', place_of_supply: '05', cgst: '8242.40', sgst: '8242.40', igst: '0' });
    expect(m.tax_summary[0].parts.map((p) => p.label)).toEqual(['CGST', 'SGST']);
    expect(m.tax_summary.reduce((a, r) => a + Number(r.parts[1].amount), 0).toFixed(2)).toBe('8242.40');
    const plain = invoiceModel({ ...base, type: 'non_gst', cgst: '0', sgst: '0', igst: '0' });
    expect(plain).toMatchObject({ title: 'Invoice', showTax: false, showHsn: false, tax_summary: null });
  });

  test('renders a one-page PDF: the original copy only', async () => {
    const buf = await taxInvoicePdf(invoiceModel(base));
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
    expect((buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBe(1);
  });

  test('a long invoice continues on more pages', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({ description: `Resource ${i + 1}`, hsn_sac: '998519', gst_rate: 18, qty: '1', unit: 'month', rate: '1000.00', amount: '1000.00' }));
    const buf = await taxInvoicePdf(invoiceModel({ ...base, lines, subtotal: '40000', igst: '7200', total: '47200' }));
    expect((buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(1);
  });
});

describe('client and vendor invoices', () => {
  const client = {
    id: 'i1', invoice_number: 'INV-2026-001', invoice_date: '2026-10-01', currency: 'INR', amount: 100000, total_amount: 95000, period_month: 9, period_year: 2026,
    client_account_id: 'a1', client_account: { client_account_id: 'c1' }, project: { name: 'Website', code: 'WEB' },
    details: { billing_type: 'monthly', rate: 100000, contract_working_days: 21, working_days: 22, base_amount: 100000, period_from: '2026-09-01', period_to: '2026-09-30', charges: [{ label: 'TDS', amount: -5000 }] },
    line_items: {}, notes: null,
  };

  test('a client invoice keeps the item, the charges under it and the amount the client pays', async () => {
    const m = await clientInvoiceModel('org1', client);
    expect(m).toMatchObject({ title: 'Invoice', showTax: false, seller: { name: 'Delphic' }, buyer: { name: 'Giglabz Private Limited', state_code: '29' } });
    expect(m.lines[0]).toMatchObject({ description: 'Manpower Services', qty: '21', unit: 'days', amount: '100000.00' });
    expect(m.taxes).toEqual([{ label: 'TDS', amount: '-5000.00' }]);
    const gst = await clientInvoiceModel('org1', { ...client, amount: 100000, total_amount: 118000, details: { ...client.details, charges: [{ label: 'GST', mode: 'percent', value: 18, effect: 'add', amount: 18000 }] } });
    expect(gst.taxes).toEqual([{ label: 'GST @ 18%', amount: '18000.00' }]);
    expect(gst.total).toBe('118000.00');
    const none = await clientInvoiceModel('org1', { ...client, total_amount: 100000, details: { ...client.details, charges: [] } });
    expect(none.taxes).toEqual([]);
    expect(m.total).toBe('95000.00');
    expect((await clientInvoicePdf('org1', client)).slice(0, 4).toString()).toBe('%PDF');
  });

  test('the project face resource is printed with the project details; absent when not set', async () => {
    const withFace = await clientInvoiceModel('org1', { ...client, project: { ...client.project, face_resource: 'Asha Rao' } });
    expect(withFace.lines[0].details).toContain('Resource: Asha Rao');
    expect(withFace.lines[0].details.indexOf('Resource: Asha Rao')).toBe(1);
    // older invoices stored no snapshot of it: the project as it is now supplies it
    const live = await clientInvoiceModel('org1', { ...client, client_account: { client_account_id: 'c1', face_resource: 'Ravi K' } });
    expect(live.lines[0].details).toContain('Resource: Ravi K');
    const none = await clientInvoiceModel('org1', client);
    expect(none.lines[0].details.some((d) => d.startsWith('Resource'))).toBe(false);
  });

  test('a combined invoice prints each contract like its own invoice (days, rate) and totals the tax rows underneath', async () => {
    const item = (name, code, base, tds) => ({
      account_id: name, project: { name, code },
      details: { billing_type: 'monthly', rate: base, contract_working_days: 20, working_days: 22, base_amount: base, amount: base, total_amount: base * 1.18 - tds, period_from: '2026-10-01', period_to: '2026-10-31', calendar: 'Ahmedabad Calendar',
        charges: [{ label: 'GST', mode: 'percent', value: 18, amount: base * 0.18 }, { label: 'TDS', mode: 'percent', value: 10, amount: -tds }] },
      lines: [],
    });
    const items = [item('E branch Pro', 'P0098', 80000, 8000), item('Metaflow', 'P0076', 110000, 11000)];
    const total = items.reduce((a, i) => a + i.details.total_amount, 0);
    const m = await clientInvoiceModel('org1', { ...client, amount: 190000, total_amount: total, details: { billing_type: 'consolidated', charges: [] }, line_items: { consolidated: true, items } });
    expect(m.lines).toHaveLength(2);
    expect(m.lines[0]).toMatchObject({ description: 'Manpower Services', qty: '20', unit: 'days', rate: '4000.00', amount: '80000.00' });
    expect(m.lines[0].details.join(' ')).not.toMatch(/Ahmedabad/);
    expect(m.taxes).toEqual([{ label: 'GST @ 18%', amount: '34200.00' }, { label: 'TDS @ 10%', amount: '-19000.00' }]);
    expect(m.total).toBe(total.toFixed(2));
  });

  test('on approved-hours billing the invoice prints the days that were approved, not the contract days', async () => {
    // 155000 a month, 20 working days: 3 approved days = 23250, so 3 days at 7750 a day (not "8 days" of the contract period)
    const approved = { ...client, amount: 23250, total_amount: 23250, details: { ...client.details, rate: 155000, contract_working_days: 8, working_days: 20, payable_days: 3, billing_basis: 'approved_hours', base_amount: 23250, charges: [] } };
    const m = await clientInvoiceModel('org1', approved);
    expect(m.lines[0]).toMatchObject({ qty: '3', unit: 'days', rate: '7750.00', amount: '23250.00' });
    expect(m.lines[0].details.join(' ')).toContain('x 3 / 20 working days');
    // a contract-basis invoice keeps the contract days
    const contract = await clientInvoiceModel('org1', { ...approved, details: { ...approved.details, billing_basis: 'contract', base_amount: 62000 }, amount: 62000, total_amount: 62000 });
    expect(contract.lines[0]).toMatchObject({ qty: '8', rate: '7750.00' });
  });

  test('a description added under an entry is printed with that entry only', async () => {
    const hourly = { ...client, details: { billing_type: 'hourly', rate: 500 }, line_items: { lines: [{ resource: 'A. Dev', hours: 10, revenue: 5000 }, { resource: 'B. Dev', hours: 4, revenue: 2000 }], line_notes: { 'res:B. Dev': 'Sprint 4 hotfix' } }, total_amount: 7000, amount: 7000 };
    const m = await clientInvoiceModel('org1', hourly);
    expect(m.lines.map((l) => l.note)).toEqual([undefined, 'Sprint 4 hotfix']);
    expect(require('../src/modules/billing/invoices.pdf').invoiceRows(hourly).map((r) => r.key)).toEqual(['res:A. Dev', 'res:B. Dev']);
    expect((await clientInvoicePdf('org1', hourly)).slice(0, 4).toString()).toBe('%PDF');
  });

  test('overtime is its own row and an unexplained difference is shown as an adjustment, so the rows always add up', async () => {
    const m = await clientInvoiceModel('org1', { ...client, status: 'sent', amount: 105000, total_amount: 100000, details: { ...client.details, base_amount: 100000, overtime_billed: true, overtime_hours: 5, overtime_multiplier: 1.5, overtime_amount: 5000, charges: [] } });
    expect(m.lines.map((l) => l.description)).toEqual(['Manpower Services', 'Overtime']);
    expect(m.taxes).toEqual([{ label: 'Adjustment', amount: '-5000.00' }]);
    expect(m.remarks).toBe('Status: sent');
  });

  test('hourly resources become one row each', async () => {
    const m = await clientInvoiceModel('org1', { ...client, details: { billing_type: 'hourly', rate: 500 }, line_items: { lines: [{ resource: 'A. Dev', hours: 10, overtime_hours: 0, revenue: 5000 }] }, total_amount: 5000, amount: 5000, charges: [] });
    expect(m.lines).toHaveLength(1);
    expect(m.lines[0]).toMatchObject({ description: 'A. Dev', qty: '10', unit: 'hrs', rate: '500.00', amount: '5000.00' });
  });

  test('a vendor invoice is one invoice per currency, the vendor as seller and the company as buyer', async () => {
    const row = (currency, amount) => ({
      vendor_account_id: 'v1', period_month: 9, period_year: 2026, invoice_number: 'VINV-2026-001', invoice_date: '2026-10-02', currency, amount, notes: null,
      project: { name: 'Website', code: 'WEB', client_name: 'Giglabz' },
      details: { contractors: [{ contractor: 'R. Kumar', monthly_vendor_rate: 50000, allocation_percent: 100, contract_working_days: 21, working_days: 22, amount }] },
    });
    const models = await vendorInvoiceModels('org1', [row('INR', 47727.27), row('USD', 900)]);
    expect(models.map((m) => m.currency)).toEqual(['INR', 'USD']);
    expect(models[0]).toMatchObject({ seller: { name: 'Giglabz Private Limited' }, buyer: { name: 'Delphic' }, total: '47727.27' });
    expect((await vendorInvoicePdf('org1', [row('INR', 47727.27)])).slice(0, 4).toString()).toBe('%PDF');
    // TDS and the adjustment are optional: absent they print nothing, set they come off the total as the net payable
    expect(models[0].taxes.every((x) => Number(x.amount) === 0)).toBe(true);
    const withTds = await vendorInvoiceModels('org1', [{ ...row('INR', 10000), tds_amount: 1000, adjustment_amount: -200, adjustment_note: 'Late fee' }]);
    expect(withTds[0]).toMatchObject({ subtotal: '10000.00', total: '8800.00', taxes: [{ label: 'TDS', amount: '-1000.00' }, { label: 'Adjustment (Late fee)', amount: '-200.00' }] });
    const face = await vendorInvoiceModels('org1', [{ ...row('INR', 10000), project: { name: 'Website', code: 'WEB', client_name: 'Giglabz', face_resource: 'Asha Rao' } }]);
    expect(face[0].lines[0].details).toContain('Resource: Asha Rao');
    expect(models[0].lines[0].details.some((d) => d.startsWith('Resource'))).toBe(false);
  });
});

describe('default signature and several invoices in one PDF', () => {
  // a 1x1 PNG
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const model = (number, seller = {}) => ({
    title: 'Invoice', currency: 'INR', seller: { name: 'Delphic', ...seller }, buyer: { name: 'Giglabz' }, meta: { number, date: '13-Aug-24' },
    lines: [{ description: 'Services', details: [], qty: '1', unit: '', rate: '100.00', amount: '100.00' }], taxes: [], subtotal: '100.00', total: '100.00',
    bank: { holder: 'Delphic', lines: [] }, showHsn: false, showTax: false, tax_summary: null,
  });
  const pages = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;

  test('a signature image is printed when the entity has one, and an unreadable one is ignored', async () => {
    const plain = await taxInvoicePdf(model('A-1'));
    const signed = await taxInvoicePdf(model('A-1', { signature_image: PNG, signatory_name: 'A. Gulati' }));
    expect(signed.length).toBeGreaterThan(plain.length);
    const broken = await taxInvoicePdf(model('A-1', { signature_image: 'data:image/png;base64,AAAA' }));
    expect(broken.slice(0, 4).toString()).toBe('%PDF');
  });

  test('several invoices make one PDF, each with its own pages', async () => {
    const one = pages(await taxInvoicePdf(model('A-1')));
    const three = pages(await taxInvoicePdf([model('A-1'), model('A-2'), model('A-3')]));
    expect(three).toBe(one * 3);
  });
});

