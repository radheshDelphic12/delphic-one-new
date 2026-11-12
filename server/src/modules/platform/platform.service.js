const prisma = require('../../config/db');
const audit = require('./audit.service');

// SaaS platform administration (docs/features/SAAS-LAUNCH-BUILD-PLAN.md, phase 1): who may run the platform, the module catalogue, the dated
// price books and the platform settings. Nothing here is read by an existing feature; it is configuration for the SaaS product.

const CODE = /^[A-Z]{3,8}$/;

// ---- platform admins ---------------------------------------------------------------------------------------------------
// Two sources: the named table, and env PLATFORM_ADMIN_EMAILS (comma separated) so the very first admin can be named before any row exists.
const envEmails = () => (process.env.PLATFORM_ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

async function isPlatformAdmin(user) {
  if (!user?.id) return false;
  const row = await prisma.platformAdmin.findUnique({ where: { user_id: user.id }, select: { id: true } });
  if (row) return true;
  const emails = envEmails();
  if (!emails.length) return false;
  const email = user.email || (await prisma.user.findUnique({ where: { id: user.id }, select: { email: true } }))?.email;
  return Boolean(email && emails.includes(String(email).toLowerCase()));
}

async function listAdmins() {
  const rows = await prisma.platformAdmin.findMany({ orderBy: { created_at: 'asc' }, include: { user: { select: { id: true, name: true, email: true } } } });
  return { admins: rows.map((r) => ({ id: r.id, user_id: r.user_id, name: r.user.name, email: r.user.email, added_at: r.created_at })), env_emails: envEmails() };
}

async function addAdmin(email, addedBy) {
  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
  if (!user) return { error: 'user_not_found' };
  const existing = await prisma.platformAdmin.findUnique({ where: { user_id: user.id } });
  if (existing) return { error: 'already_admin' };
  const admin = await prisma.platformAdmin.create({ data: { user_id: user.id, added_by: addedBy } });
  await audit.record(addedBy, 'admin_added', 'platform_admin', admin.id, null, { email });
  return { admin };
}

async function removeAdmin(id, actorId = null) {
  const row = await prisma.platformAdmin.findUnique({ where: { id }, include: { user: { select: { email: true } } } });
  if (!row) return { error: 'not_found' };
  await prisma.platformAdmin.delete({ where: { id } });
  await audit.record(actorId, 'admin_removed', 'platform_admin', id, { email: row.user.email }, null);
  return { ok: true };
}

// ---- price books -------------------------------------------------------------------------------------------------------
const today = () => new Date(new Date().toISOString().slice(0, 10));

// The book that applies to a subscription starting on `date`: the one with the latest effective_from not after that date.
async function bookFor(date = today()) {
  return prisma.saasPriceBook.findFirst({ where: { effective_from: { lte: date } }, orderBy: { effective_from: 'desc' }, include: { prices: true } });
}

async function listBooks() {
  const books = await prisma.saasPriceBook.findMany({ orderBy: { effective_from: 'desc' }, include: { prices: true } });
  return books.map((b) => ({
    id: b.id, name: b.name, effective_from: b.effective_from, admin_price: Number(b.admin_price), notes: b.notes,
    prices: Object.fromEntries(b.prices.map((p) => [p.module_code, Number(p.price_30d)])),
  }));
}

// A new book starts as a copy of the latest one (so a price change is "copy, edit the few prices, set the date").
async function createBook({ name, effective_from, admin_price, notes, copy_from }, userId) {
  const source = copy_from ? await prisma.saasPriceBook.findUnique({ where: { id: copy_from }, include: { prices: true } }) : await prisma.saasPriceBook.findFirst({ orderBy: { effective_from: 'desc' }, include: { prices: true } });
  const book = await prisma.saasPriceBook.create({
    data: {
      name, effective_from: new Date(effective_from), admin_price: admin_price ?? source?.admin_price ?? 0, notes: notes || null, created_by: userId,
      prices: { create: (source?.prices || []).map((p) => ({ module_code: p.module_code, price_30d: p.price_30d })) },
    },
  });
  await audit.record(userId, 'price_book_created', 'price_book', book.id, null, { name, effective_from, admin_price: Number(book.admin_price), copied_from: source?.id || null });
  return book;
}

async function updateBook(id, patch, actorId = null) {
  const book = await prisma.saasPriceBook.findUnique({ where: { id }, include: { prices: true } });
  if (!book) return { error: 'not_found' };
  const was = { name: book.name, effective_from: String(book.effective_from).slice(0, 10), admin_price: Number(book.admin_price), prices: Object.fromEntries(book.prices.map((x) => [x.module_code, Number(x.price_30d)])) };
  const data = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.effective_from !== undefined) data.effective_from = new Date(patch.effective_from);
  if (patch.admin_price !== undefined) data.admin_price = patch.admin_price;
  if (patch.notes !== undefined) data.notes = patch.notes;
  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length) await tx.saasPriceBook.update({ where: { id }, data });
    for (const [code, price] of Object.entries(patch.prices || {})) {
      await tx.saasModulePrice.upsert({ where: { price_book_id_module_code: { price_book_id: id, module_code: code } }, update: { price_30d: price }, create: { price_book_id: id, module_code: code, price_30d: price } });
    }
  });
  const changedPrices = Object.fromEntries(Object.entries(patch.prices || {}).filter(([c, v]) => was.prices[c] !== v));
  await audit.record(actorId, 'price_book_edited', 'price_book', id, { ...(patch.name !== undefined ? { name: was.name } : {}), ...(patch.effective_from !== undefined ? { effective_from: was.effective_from } : {}), ...(patch.admin_price !== undefined ? { admin_price: was.admin_price } : {}), prices: Object.fromEntries(Object.keys(changedPrices).map((c) => [c, was.prices[c] ?? null])) }, { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.effective_from !== undefined ? { effective_from: patch.effective_from } : {}), ...(patch.admin_price !== undefined ? { admin_price: patch.admin_price } : {}), prices: changedPrices });
  return { ok: true };
}

// ---- module catalogue --------------------------------------------------------------------------------------------------
async function listModules() {
  const [modules, book] = await Promise.all([
    prisma.saasModule.findMany({ orderBy: { sort_order: 'asc' }, include: { needs: true } }),
    bookFor(),
  ]);
  const price = new Map((book?.prices || []).map((p) => [p.module_code, Number(p.price_30d)]));
  return {
    price_book: book ? { id: book.id, name: book.name, effective_from: book.effective_from, admin_price: Number(book.admin_price) } : null,
    modules: modules.map((m) => ({
      code: m.code, name: m.name, description: m.description, is_basic: m.is_basic, coming_soon: m.coming_soon, active: m.active, sort_order: m.sort_order,
      price_30d: price.get(m.code) ?? null,
      needs: m.needs.map((n) => ({ code: n.needs_code, group: n.requirement_group })),
    })),
  };
}

async function createModule({ code, name, description, price_30d, is_basic, coming_soon }, actorId = null) {
  if (!CODE.test(code)) return { error: 'bad_code' };
  if (await prisma.saasModule.findUnique({ where: { code } })) return { error: 'code_taken' };
  const last = await prisma.saasModule.findFirst({ orderBy: { sort_order: 'desc' }, select: { sort_order: true } });
  const book = await bookFor();
  await prisma.$transaction(async (tx) => {
    await tx.saasModule.create({ data: { code, name, description: description || null, is_basic: Boolean(is_basic), coming_soon: Boolean(coming_soon), sort_order: (last?.sort_order || 0) + 10 } });
    if (book && price_30d !== undefined) await tx.saasModulePrice.create({ data: { price_book_id: book.id, module_code: code, price_30d } });
  });
  await audit.record(actorId, 'module_created', 'module', code, null, { name, price_30d: price_30d ?? null, coming_soon: Boolean(coming_soon) });
  return { ok: true };
}

// The code never changes; a module is retired with active=false, never deleted (credits and invoices will point at it).
async function updateModule(code, patch, actorId = null) {
  const m = await prisma.saasModule.findUnique({ where: { code } });
  if (!m) return { error: 'not_found' };
  const data = {};
  for (const k of ['name', 'description', 'coming_soon', 'active', 'sort_order', 'is_basic']) if (patch[k] !== undefined) data[k] = patch[k];
  await prisma.saasModule.update({ where: { code }, data });
  await audit.record(actorId, 'module_edited', 'module', code, Object.fromEntries(Object.keys(data).map((k) => [k, m[k]])), data);
  return { ok: true };
}

// A module that needs itself, directly or through others, could never be bought: refuse a loop.
function hasCycle(code, needs, edges) {
  const graph = new Map();
  for (const e of edges) { if (!graph.has(e.module_code)) graph.set(e.module_code, []); graph.get(e.module_code).push(e.needs_code); }
  graph.set(code, needs);
  const seen = new Set();
  const stack = [...needs];
  while (stack.length) {
    const c = stack.pop();
    if (c === code) return true;
    if (seen.has(c)) continue;
    seen.add(c);
    stack.push(...(graph.get(c) || []));
  }
  return false;
}

async function setDependencies(code, needs, actorId = null) {
  const m = await prisma.saasModule.findUnique({ where: { code } });
  if (!m) return { error: 'not_found' };
  const codes = needs.map((n) => n.code);
  const was = await prisma.saasModuleDependency.findMany({ where: { module_code: code }, select: { needs_code: true, requirement_group: true } });
  if (codes.includes(code)) return { error: 'cycle' };
  if (new Set(codes).size !== codes.length) return { error: 'duplicate' };
  const known = await prisma.saasModule.findMany({ where: { code: { in: codes } }, select: { code: true } });
  if (known.length !== codes.length) return { error: 'unknown_module' };
  const others = await prisma.saasModuleDependency.findMany({ where: { module_code: { not: code } }, select: { module_code: true, needs_code: true } });
  if (hasCycle(code, codes, others)) return { error: 'cycle' };
  await prisma.$transaction([
    prisma.saasModuleDependency.deleteMany({ where: { module_code: code } }),
    prisma.saasModuleDependency.createMany({ data: needs.map((n) => ({ module_code: code, needs_code: n.code, requirement_group: n.group || 1 })) }),
  ]);
  await audit.record(actorId, 'dependencies_edited', 'module', code, was.map((w) => ({ code: w.needs_code, group: w.requirement_group })), needs.map((n) => ({ code: n.code, group: n.group || 1 })));
  return { ok: true };
}

// Checkout helper: the modules a customer must also take. Each requirement group needs one of its modules; when none is chosen the first
// alternative (catalogue order) is added. Added prerequisites are themselves checked. Returns { all, added } (codes).
async function withPrerequisites(selected) {
  const [modules, deps] = await Promise.all([
    prisma.saasModule.findMany({ select: { code: true, sort_order: true } }),
    prisma.saasModuleDependency.findMany(),
  ]);
  const order = new Map(modules.map((m) => [m.code, m.sort_order]));
  const byModule = new Map();
  for (const d of deps) {
    if (!byModule.has(d.module_code)) byModule.set(d.module_code, new Map());
    const groups = byModule.get(d.module_code);
    if (!groups.has(d.requirement_group)) groups.set(d.requirement_group, []);
    groups.get(d.requirement_group).push(d.needs_code);
  }
  const all = new Set(selected);
  const queue = [...selected];
  while (queue.length) {
    const c = queue.shift();
    for (const alternatives of (byModule.get(c) || new Map()).values()) {
      if (alternatives.some((a) => all.has(a))) continue;
      const pick = [...alternatives].sort((a, b) => (order.get(a) || 0) - (order.get(b) || 0))[0];
      all.add(pick);
      queue.push(pick);
    }
  }
  return { all: [...all], added: [...all].filter((c) => !selected.includes(c)) };
}

// ---- settings ----------------------------------------------------------------------------------------------------------
async function listSettings() {
  const rows = await prisma.saasSetting.findMany({ where: { NOT: { key: { startsWith: 'switch.' } } }, orderBy: { key: 'asc' } });
  return rows.map((r) => ({ key: r.key, value: r.value, note: r.note, updated_at: r.updated_at }));
}

async function updateSetting(key, value, userId) {
  const row = key.startsWith('switch.') ? null : await prisma.saasSetting.findUnique({ where: { key } });
  if (!row) return { error: 'not_found' };
  await prisma.saasSetting.update({ where: { key }, data: { value, updated_by: userId } });
  await audit.record(userId, 'setting_edited', 'setting', key, { value: row.value }, { value });
  return { ok: true };
}

// Used by trial and credit code: one setting as a number, with a fallback when the row is missing.
async function settingNumber(key, fallback) {
  const row = await prisma.saasSetting.findUnique({ where: { key } });
  const n = Number(row?.value);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  isPlatformAdmin, listAdmins, addAdmin, removeAdmin,
  bookFor, listBooks, createBook, updateBook,
  listModules, createModule, updateModule, setDependencies, withPrerequisites, hasCycle,
  listSettings, updateSetting, settingNumber,
};
