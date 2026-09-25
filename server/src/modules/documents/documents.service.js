const path = require('path');
const fs = require('fs');
const prisma = require('../../config/db');
const env = require('../../config/env');
const { assertCanAccessEntity } = require('../../lib/entityAccess');

function serialize(row) {
  if (!row) return null;
  const { uploaded_by, uploaded_by_user, ...rest } = row;
  return { ...rest, uploaded_by: uploaded_by_user };
}

async function list({ entity_type, entity_id }, user) {
  if (!entity_type || !entity_id) {
    if (user.role !== 'admin') return { error: 'filters_required' };
    const rows = await prisma.document.findMany({
      orderBy: { uploaded_at: 'desc' },
      include: { uploaded_by_user: { select: { id: true, name: true } } },
    });
    return { documents: rows.map(serialize) };
  }

  // Reading attachments (resumes, JDs, agreements, …) is open to any
  // authenticated user once they know the entity — files must be visible and
  // downloadable across roles (a sales rep needs a recruiter's attached CV,
  // etc). Only the parent entity's `not_found` still applies. Uploading and
  // deleting stay gated (see create / remove below).
  const entity = await assertCanAccessEntity(user, entity_type, entity_id);
  if (entity.error === 'not_found' || entity.error === 'bad_entity') return { error: entity.error };

  const rows = await prisma.document.findMany({
    where: { entity_type, entity_id },
    orderBy: { uploaded_at: 'desc' },
    include: { uploaded_by_user: { select: { id: true, name: true } } },
  });
  return { documents: rows.map(serialize) };
}

async function create({ entity_type, entity_id, label, file }, user) {
  if (!file) return { error: 'file_required' };

  const access = await assertCanAccessEntity(user, entity_type, entity_id, { forWrite: true });
  if (access.error) return { error: access.error };

  const row = await prisma.document.create({
    data: {
      entity_type,
      entity_id,
      label,
      file_url: `/uploads/${file.filename}`,
      file_type: file.mimetype,
      file_size_bytes: file.size,
      uploaded_by: user.id,
    },
    include: { uploaded_by_user: { select: { id: true, name: true } } },
  });

  return { document: serialize(row) };
}

async function remove(id, user) {
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) return { error: 'not_found' };
  if (doc.uploaded_by !== user.id && user.role !== 'admin') return { error: 'forbidden' };
  // A decided expense claim's receipts are part of the record.
  if (doc.entity_type === 'expense_claim') {
    const access = await assertCanAccessEntity(user, doc.entity_type, doc.entity_id, { forWrite: true });
    if (access.error) return { error: access.error };
  }

  await prisma.document.delete({ where: { id } });
  const filePath = path.join(env.uploadDir, path.basename(doc.file_url));
  fs.unlink(filePath, () => {});

  return { ok: true };
}

module.exports = { list, create, remove };
