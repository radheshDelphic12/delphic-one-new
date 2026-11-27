/**
 * Document Centre: what is on file for clients / vendors / employees (and what is missing), documents to sign with a person's own signature,
 * the signed copy, and storage clean-up.
 */
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const { app, prisma, request, cleanDatabase, createUser, createOrgMembership, loginAs, authed } = require('./helpers');

const D = '/api/v1/document-centre';
let org;
let admin;
let adminToken;
let signer;
let signerToken;
const get = (path, query, token = adminToken) => authed(request(app).get(`${D}${path}`), token).query(query || {});
const post = (path, body, token = adminToken) => authed(request(app).post(`${D}${path}`), token).send(body || {});

// a 1x1 transparent PNG, the "signature"
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function pdfBytes(pages = 2) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([595, 842]).drawText(`Page ${i + 1}`, { x: 50, y: 780, size: 18 });
  return Buffer.from(await doc.save());
}

beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE signature_requests, user_signatures, document_requirements, company_stamps');
  admin = await createUser({ role: 'admin', name: 'Diksha Admin' });
  ({ access_token: adminToken } = await loginAs(admin));
  org = await prisma.org.findUnique({ where: { id: (await prisma.orgMembership.findFirst({ where: { person_id: admin.id } })).org_id } });
  signer = await createUser({ role: 'admin', name: 'Paras Signer', withOrg: false });
  await createOrgMembership(signer.id, org.id, { role: 'admin' });
  ({ access_token: signerToken } = await loginAs(signer));
});
afterAll(async () => { await prisma.$disconnect(); });

const account = (type, name, extra = {}) => prisma.account.create({ data: { org_id: org.id, type, name, stage: 'active', owner_id: admin.id, origin_owner_id: admin.id, ...extra } });
const doc = (entityType, entityId, label, extra = {}) => prisma.document.create({ data: { entity_type: entityType, entity_id: entityId, label, file_url: '/uploads/x.pdf', uploaded_by: admin.id, org_id: org.id, ...extra } });

describe('what is on file', () => {
  test('clients: an agreement on file shows as uploaded (by tag, by its label, or by the link on the account); the rest are missing and listed first', async () => {
    const tagged = await account('client', 'Alpha Tech');
    const labelled = await account('client', 'Bravo Soft');
    const linked = await account('client', 'Charlie Labs', { client_agreement_url: 'https://drive.example/agreement' });
    const none = await account('client', 'Delta Corp');
    await doc('account', tagged.id, 'Signed copy', { doc_type: 'Agreement' });
    await doc('account', labelled.id, 'Master client agreement 2026');
    await doc('account', none.id, 'Visiting card'); // some other file

    const o = (await get('/overview', { kind: 'client' })).body.data;
    expect(o.requirements).toEqual(['Agreement']);
    const by = Object.fromEntries(o.rows.map((r) => [r.name, r]));
    expect(by['Alpha Tech'].items[0]).toMatchObject({ name: 'Agreement', state: 'uploaded' });
    expect(by['Bravo Soft'].items[0].state).toBe('uploaded');
    expect(by['Charlie Labs'].items[0]).toMatchObject({ state: 'uploaded', document: { label: 'Agreement link on the account' } });
    expect(by['Delta Corp'].items[0]).toMatchObject({ state: 'missing', document: null });
    expect(by['Delta Corp'].other_documents).toBe(1);
    expect(o.rows[0].name).toBe('Delta Corp'); // missing first
    expect(o.summary).toMatchObject({ total: 4, complete: 3, with_missing: 1, missing_items: 1 });
    expect((await get('/overview', { kind: 'client', missing_only: 'true' })).body.data.rows.map((r) => r.name)).toEqual(['Delta Corp']);
    expect((await get('/overview', { kind: 'client', q: 'alp' })).body.data.rows.map((r) => r.name)).toEqual(['Alpha Tech']);
  });

  test('clients: an agreement uploaded on a project of the client (by account link, or by name on an older project) counts as on file, and says which project', async () => {
    const byLink = await account('client', 'Echo Corp');
    await account('client', 'Foxtrot Ltd');
    const bare = await account('client', 'Golf Inc');
    const p1 = await account('client', 'Echo build', { is_project: true, client_account_id: byLink.id, project_name: 'Echo build' });
    const p2 = await account('client', 'Foxtrot old', { is_project: true, client_name: 'Foxtrot Ltd', project_name: 'Foxtrot old' });
    await doc('account', p1.id, 'Client Agreement');
    await account('client', 'Golf site', { is_project: true, client_account_id: bare.id, client_agreement_url: 'https://drive.example/golf' });
    await doc('account', p2.id, 'Client Agreement', { doc_type: 'Agreement' });
    // an older project (not flagged is_project, but it has billing rates, so Finance lists it) pointing at its client
    const hotel = await account('client', 'Hotel Group');
    const legacy = await account('client', 'FindQ', { client_account_id: hotel.id, project_name: 'Dish Network' });
    await prisma.billingRate.create({ data: { org_id: org.id, account_id: legacy.id, rate_type: 'monthly', rate: 1000, effective_from: new Date('2026-01-01'), created_by: admin.id } });
    await doc('account', legacy.id, 'Client Agreement');
    const o = (await get('/overview', { kind: 'client' })).body.data;
    const by = Object.fromEntries(o.rows.map((r) => [r.name, r]));
    expect(by['Echo Corp'].items[0]).toMatchObject({ state: 'uploaded', document: { via_project: 'Echo build' } });
    expect(by['Foxtrot Ltd'].items[0]).toMatchObject({ state: 'uploaded', document: { via_project: 'Foxtrot old' } });
    expect(by['Hotel Group'].items[0]).toMatchObject({ state: 'uploaded', document: { via_project: 'Dish Network' } });
    expect(by['Golf Inc'].items[0]).toMatchObject({ state: 'uploaded', document: { via_project: 'Golf site' } });
    expect(o.rows.map((r) => r.name)).not.toContain('Echo build'); // a project is never listed as a client
    expect(o.summary.missing_items).toBe(0);
  });

  test('projects: each project (flagged, or an older one Finance lists) with its own agreement on file or missing', async () => {
    const client = await account('client', 'Kilo Corp');
    const p1 = await account('client', 'Kilo build', { is_project: true, client_account_id: client.id, project_name: 'Kilo build' });
    const p2 = await account('client', 'Kilo run', { is_project: true, client_account_id: client.id, project_name: 'Kilo run' });
    const legacy = await account('client', 'Lima', { project_name: 'Lima ops' });
    await prisma.billingRate.create({ data: { org_id: org.id, account_id: legacy.id, rate_type: 'monthly', rate: 1, effective_from: new Date('2026-01-01'), created_by: admin.id } });
    await doc('account', p1.id, 'Client Agreement');
    await account('client', 'Mike', { is_project: true, project_name: 'Mike svc', client_agreement_url: 'https://drive.example/mike' });
    const o = (await get('/overview', { kind: 'project' })).body.data;
    expect(o.requirements).toEqual(['Agreement']);
    const by = Object.fromEntries(o.rows.map((r) => [r.name, r]));
    expect(by['Kilo build'].items[0].state).toBe('uploaded');
    expect(by['Kilo run'].items[0].state).toBe('missing');
    expect(by['Kilo run'].sub).toMatch(/Kilo Corp/);
    expect(by['Lima ops'].items[0].state).toBe('missing');
    expect(by['Mike svc'].items[0].state).toBe('uploaded');
    expect(o.rows.map((r) => r.name)).not.toContain('Kilo Corp');
  });

  test('vendors: the agreement and the month invoices (with or without a file); employees: their own list of documents', async () => {
    const vendor = await account('vendor', 'Vendor One');
    const project = await account('client', 'Some Project', { is_project: true });
    const inv = (n) => prisma.projectVendorInvoice.create({ data: { org_id: org.id, account_id: project.id, vendor_account_id: vendor.id, period_month: 10, period_year: 2026, invoice_number: n, amount: 100, created_by: admin.id } });
    const i1 = await inv('V-1');
    await inv('V-2');
    await doc('project_vendor_invoice', i1.id, 'Vendor invoice pdf');
    await doc('account', vendor.id, 'Agreement', { doc_type: 'Agreement' });

    const v = (await get('/overview', { kind: 'vendor', month: 10, year: 2026 })).body.data;
    expect(v.rows).toHaveLength(1);
    expect(v.rows[0].items[0].state).toBe('uploaded');
    expect(v.rows[0].invoices).toMatchObject({ total: 2, with_file: 1, state: 'missing', month: 10, year: 2026 });
    expect(v.rows[0].missing_count).toBe(1); // the second invoice has no file
    expect((await get('/overview', { kind: 'vendor', month: 11, year: 2026 })).body.data.rows[0].invoices.state).toBe('none');

    const membership = await prisma.orgMembership.findFirst({ where: { person_id: admin.id, org_id: org.id } });
    await doc('org_membership', membership.id, 'Aadhaar card', { doc_type: 'ID proof' });
    const e = (await get('/overview', { kind: 'employee' })).body.data;
    expect(e.requirements).toEqual(['Offer / appointment letter', 'ID proof', 'Address proof']);
    const row = e.rows.find((r) => r.name === 'Diksha Admin');
    expect(row.items.map((i) => i.state)).toEqual(['missing', 'uploaded', 'missing']);
    expect(row.missing_count).toBe(2);
  });

  test('what must be on file is editable: add, rename (files follow), remove; a duplicate is refused', async () => {
    const c = await account('client', 'Alpha Tech');
    await doc('account', c.id, 'NDA copy', { doc_type: 'NDA' });
    const added = await post('/requirements', { kind: 'client', name: 'NDA' });
    expect(added.status).toBe(201);
    expect((await post('/requirements', { kind: 'client', name: 'NDA' })).status).toBe(409);
    expect((await get('/overview', { kind: 'client' })).body.data.rows[0].items.map((i) => [i.name, i.state])).toEqual([['Agreement', 'missing'], ['NDA', 'uploaded']]);
    const renamed = await authed(request(app).patch(`${D}/requirements/${added.body.data.id}`), adminToken).send({ name: 'Non-disclosure agreement' });
    expect(renamed.status).toBe(200);
    expect((await prisma.document.findFirst({ where: { entity_id: c.id } })).doc_type).toBe('Non-disclosure agreement');
    expect((await authed(request(app).delete(`${D}/requirements/${added.body.data.id}`), adminToken)).status).toBe(200);
    expect((await get('/overview', { kind: 'client' })).body.data.requirements).toEqual(['Agreement']);
    expect((await prisma.document.count({ where: { entity_id: c.id } }))).toBe(1); // the file stays
  });

  test('a document can be uploaded with its type through the normal upload and then counts as on file', async () => {
    const c = await account('client', 'Echo Ltd');
    const up = await authed(request(app).post('/api/v1/documents'), adminToken).field('entity_type', 'account').field('entity_id', c.id).field('label', 'Signed MSA').field('doc_type', 'Agreement').attach('file', await pdfBytes(1), 'msa.pdf');
    expect(up.status).toBe(201);
    expect((await prisma.document.findUnique({ where: { id: up.body.data.id } })).doc_type).toBe('Agreement');
    expect((await get('/overview', { kind: 'client' })).body.data.rows[0].items[0]).toMatchObject({ state: 'uploaded', document: { label: 'Signed MSA' } });
  });
});

describe('signing', () => {
  const makeRequest = async (extra = {}) => {
    const c = await account('client', 'Alpha Tech');
    const res = await authed(request(app).post(`${D}/sign-requests`), adminToken)
      .field('title', 'Alpha MSA').field('tag_kind', 'client').field('entity_type', 'account').field('entity_id', c.id).field('doc_type', 'Agreement').field('signer_user_id', extra.signer || signer.id)
      .attach('file', extra.file || await pdfBytes(2), 'alpha-msa.pdf');
    return { res, client: c };
  };

  test('a signature is a PNG / JPEG picture, kept per person, never shown to others', async () => {
    expect((await authed(request(app).put(`${D}/signatures/me`), signerToken).send({ image: 'data:image/gif;base64,AAAA' })).status).toBe(422);
    expect((await authed(request(app).put(`${D}/signatures/me`), signerToken).send({ image: 'data:image/png;base64,AAAA' })).status).toBe(422); // not a real PNG
    expect((await get('/signatures/me', {}, signerToken)).body.data.has_signature).toBe(false);
    expect((await authed(request(app).put(`${D}/signatures/me`), signerToken).send({ image: PNG })).status).toBe(200);
    const mine = (await get('/signatures/me', {}, signerToken)).body.data;
    expect(mine.has_signature).toBe(true);
    expect(mine.image.startsWith('data:image/png;base64,')).toBe(true);
    expect((await get('/signatures/me', {}, adminToken)).body.data.has_signature).toBe(false); // another person's is not theirs
    expect((await get('/signers')).body.data.map((s) => s.name)).toEqual(['Paras Signer']);
  });

  test('emails: the signer is told when asked to sign; the sender is told when it is signed or declined', async () => {
    await prisma.emailOutbox.deleteMany({ where: { kind: 'document_signing' } });
    await authed(request(app).put(`${D}/signatures/me`), signerToken).send({ image: PNG });
    const first = (await makeRequest()).res.body.data;
    const mails = () => prisma.emailOutbox.findMany({ where: { kind: 'document_signing' }, orderBy: { created_at: 'asc' } });
    let m = await mails();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ to_email: signer.email });
    expect(m[0].subject).toMatch(/^Please sign: /);
    await post(`/sign-requests/${first.id}/sign`, { placements: [{ page: 1, x: 0.1, y: 0.8, width: 0.2 }] }, signerToken);
    m = await mails();
    expect(m[1]).toMatchObject({ to_email: admin.email });
    expect(m[1].subject).toMatch(/^Signed: /);
    const second = (await makeRequest()).res.body.data;
    await post(`/sign-requests/${second.id}/decline`, { reason: 'Wrong version' }, signerToken);
    m = await mails();
    expect(m[m.length - 1]).toMatchObject({ to_email: admin.email });
    expect(m[m.length - 1].body_text).toMatch(/Wrong version/);
  });

  test('the company stamp: set by a manager, placed with the signature; a stamp alone or a missing stamp is refused', async () => {
    await authed(request(app).put(`${D}/signatures/me`), signerToken).send({ image: PNG });
    expect((await get('/stamp', {}, signerToken)).body.data).toEqual({ has_stamp: false });
    const { res } = await makeRequest();
    const id = res.body.data.id;
    // no stamp set up yet
    expect((await post(`/sign-requests/${id}/sign`, { placements: [{ page: 1, x: 0.1, y: 0.8, width: 0.2 }, { page: 1, x: 0.5, y: 0.8, width: 0.15, kind: 'stamp' }] }, signerToken)).status).toBe(409);
    expect((await authed(request(app).put(`${D}/stamp`), adminToken).send({ image: 'data:text/plain;base64,aGk=' })).status).toBe(422);
    expect((await authed(request(app).put(`${D}/stamp`), adminToken).send({ image: PNG })).status).toBe(200);
    expect((await get('/stamp', {}, signerToken)).body.data).toMatchObject({ has_stamp: true });
    // the stamp alone is not a signature
    expect((await post(`/sign-requests/${id}/sign`, { placements: [{ page: 1, x: 0.5, y: 0.8, width: 0.15, kind: 'stamp' }] }, signerToken)).status).toBe(422);
    const signed = await post(`/sign-requests/${id}/sign`, { placements: [{ page: 1, x: 0.1, y: 0.8, width: 0.2 }, { page: 2, x: 0.5, y: 0.7, width: 0.15, kind: 'stamp' }] }, signerToken);
    expect(signed.status).toBe(200);
    expect(signed.body.data.status).toBe('signed');
    // printed on the company's invoices too, unless switched off
    const service = require('../src/modules/documentCentre/documentCentre.service');
    expect(await service.stampForInvoices(org.id)).toMatch(/^data:image\/png;base64,/);
    expect((await authed(request(app).patch(`${D}/stamp`), adminToken).send({ on_invoices: false })).body.data).toEqual({ on_invoices: false });
    expect(await service.stampForInvoices(org.id)).toBeNull();
    expect((await get('/stamp', {}, signerToken)).body.data.on_invoices).toBe(false);
    expect((await authed(request(app).patch(`${D}/stamp`), signerToken).send({ on_invoices: true })).status).toBe(200); // the signer is an admin here
    expect((await authed(request(app).delete(`${D}/stamp`), adminToken)).status).toBe(200);
    expect((await get('/stamp', {}, signerToken)).body.data.has_stamp).toBe(false);
  });

  test('upload a PDF tagged to a client, the signer drops the signature on it, the signed PDF has it, and it can be attached to the client', async () => {
    await authed(request(app).put(`${D}/signatures/me`), signerToken).send({ image: PNG });
    const { res, client } = await makeRequest();
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'pending', title: 'Alpha MSA', tag_kind: 'client', entity_name: 'Alpha Tech', doc_type: 'Agreement', signer: { name: 'Paras Signer' }, requested_by: { name: 'Diksha Admin' } });
    const id = res.body.data.id;

    // the signer sees it to sign; the requester sees it among theirs
    expect((await get('/sign-requests', { scope: 'to_sign' }, signerToken)).body.data.map((r) => r.id)).toEqual([id]);
    expect((await get('/sign-requests', { scope: 'to_sign' })).body.data).toHaveLength(0);
    expect((await get('/sign-requests')).body.data.map((r) => r.id)).toEqual([id]);
    const original = await authed(request(app).get(`${D}/sign-requests/${id}/original`), signerToken).buffer(true).parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(original.status).toBe(200);
    expect(original.body.slice(0, 5).toString()).toBe('%PDF-');

    // only the signer signs; a placement outside the document is refused; not signed yet = nothing to download
    expect((await post(`/sign-requests/${id}/sign`, { placements: [{ page: 1, x: 0.1, y: 0.8, width: 0.2 }] }, adminToken)).status).toBe(403);
    expect((await post(`/sign-requests/${id}/sign`, { placements: [{ page: 9, x: 0.1, y: 0.8, width: 0.2 }] }, signerToken)).status).toBe(422);
    expect((await post(`/sign-requests/${id}/sign`, { placements: [] }, signerToken)).status).toBe(422);
    expect((await authed(request(app).get(`${D}/sign-requests/${id}/signed`), adminToken)).status).toBe(409);

    const signed = await post(`/sign-requests/${id}/sign`, { placements: [{ page: 2, x: 0.6, y: 0.85, width: 0.25 }, { page: 1, x: 0.1, y: 0.9, width: 0.2 }] }, signerToken);
    expect(signed.status).toBe(200);
    expect(signed.body.data.status).toBe('signed');
    expect((await post(`/sign-requests/${id}/sign`, { placements: [{ page: 1, x: 0.1, y: 0.8, width: 0.2 }] }, signerToken)).status).toBe(409); // already done
    const file = await authed(request(app).get(`${D}/sign-requests/${id}/signed`), adminToken).buffer(true).parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(file.status).toBe(200);
    const out = await PDFDocument.load(file.body);
    expect(out.getPageCount()).toBe(2);
    expect(file.body.length).toBeGreaterThan(original.body.length); // the signature picture and the "signed by" line were added

    // attach: the client now has an agreement on file
    expect((await get('/overview', { kind: 'client' })).body.data.rows[0].items[0].state).toBe('missing');
    const attached = await post(`/sign-requests/${id}/attach`);
    expect(attached.status).toBe(201);
    expect((await post(`/sign-requests/${id}/attach`)).status).toBe(409);
    expect((await get('/overview', { kind: 'client' })).body.data.rows.find((r) => r.id === client.id).items[0]).toMatchObject({ state: 'uploaded', document: { label: 'Alpha MSA (signed)' } });
  });

  test('signing needs a signature first; decline needs a reason; the requester can cancel; only PDFs are accepted', async () => {
    const { res } = await makeRequest();
    const id = res.body.data.id;
    expect((await post(`/sign-requests/${id}/sign`, { placements: [{ page: 1, x: 0.1, y: 0.8, width: 0.2 }] }, signerToken)).status).toBe(409); // no signature yet
    expect((await post(`/sign-requests/${id}/decline`, { reason: '' }, signerToken)).status).toBe(422);
    expect((await post(`/sign-requests/${id}/decline`, { reason: 'Wrong clause 4' }, adminToken)).status).toBe(403); // not the signer
    const declined = await post(`/sign-requests/${id}/decline`, { reason: 'Wrong clause 4' }, signerToken);
    expect(declined.body.data).toMatchObject({ status: 'declined', decline_reason: 'Wrong clause 4' });
    const second = (await makeRequest()).res.body.data.id;
    expect((await post(`/sign-requests/${second}/cancel`)).body.data.status).toBe('cancelled');
    expect((await post(`/sign-requests/${second}/cancel`)).status).toBe(409);

    const c = await account('vendor', 'Vendor Two');
    const notPdf = await authed(request(app).post(`${D}/sign-requests`), adminToken).field('title', 'x').field('signer_user_id', signer.id).field('entity_type', 'account').field('entity_id', c.id).attach('file', Buffer.from('hello'), 'notes.pdf');
    expect(notPdf.status).toBe(422);
    const wrongType = await authed(request(app).post(`${D}/sign-requests`), adminToken).field('title', 'x').field('signer_user_id', signer.id).attach('file', Buffer.from('hello'), 'notes.docx');
    expect(wrongType.status).toBe(422);
    expect((await authed(request(app).post(`${D}/sign-requests`), adminToken).field('title', 'x').field('signer_user_id', signer.id).attach('file', await pdfBytes(1), 'ok.pdf').field('entity_type', 'account').field('entity_id', '00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  test('storage: usage is shown, and clean-up removes only the unsigned originals of finished requests older than the limit (the signed copy stays)', async () => {
    await authed(request(app).put(`${D}/signatures/me`), signerToken).send({ image: PNG });
    const done = (await makeRequest()).res.body.data.id;
    await post(`/sign-requests/${done}/sign`, { placements: [{ page: 1, x: 0.1, y: 0.8, width: 0.2 }] }, signerToken);
    const pending = (await makeRequest()).res.body.data.id;

    let info = (await get('/storage')).body.data;
    expect(info.signing).toMatchObject({ requests: 2, pending: 1 });
    expect(info.signing.bytes).toBeGreaterThan(0);
    expect(info.cleanup.files).toBe(0); // nothing is old yet
    expect(info.rules.max_pdf_mb).toBe(15);
    expect((await post('/cleanup', { days: 30 })).body.data).toMatchObject({ files: 0, bytes: 0 });

    // make the finished one old: its original goes, the signed copy stays; the pending one is never touched
    const before = await prisma.signatureRequest.findUnique({ where: { id: done } });
    await prisma.signatureRequest.update({ where: { id: done }, data: { created_at: new Date(Date.now() - 45 * 86400000) } });
    await prisma.signatureRequest.update({ where: { id: pending }, data: { created_at: new Date(Date.now() - 45 * 86400000) } });
    info = (await get('/storage')).body.data;
    expect(info.cleanup.files).toBe(1);
    const cleaned = (await post('/cleanup', { days: 30 })).body.data;
    expect(cleaned.files).toBe(1);
    expect(cleaned.bytes).toBeGreaterThan(0);
    expect(fs.existsSync(before.original_path)).toBe(false);
    expect(fs.existsSync(before.signed_path)).toBe(true);
    expect((await authed(request(app).get(`${D}/sign-requests/${done}/original`), adminToken)).status).toBe(410);
    expect((await authed(request(app).get(`${D}/sign-requests/${done}/signed`), adminToken)).status).toBe(200);
    expect((await authed(request(app).get(`${D}/sign-requests/${pending}/original`), adminToken)).status).toBe(200);
    expect((await get('/sign-requests', { status: 'pending' })).body.data[0].stale).toBe(true); // waiting for more than two weeks
  });

  test('a person with no documents permission cannot open it', async () => {
    const emp = await createUser({ role: 'employee', name: 'Plain Employee', withOrg: false });
    await createOrgMembership(emp.id, org.id, { role: 'employee' });
    const token = (await loginAs(emp)).access_token;
    expect((await get('/overview', {}, token)).status).toBeGreaterThanOrEqual(403);
    expect((await get('/storage', {}, token)).status).toBeGreaterThanOrEqual(403);
  });
});
