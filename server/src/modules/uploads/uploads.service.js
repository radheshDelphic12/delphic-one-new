const path = require('path');
const fs = require('fs');
const prisma = require('../../config/db');
const env = require('../../config/env');
const { assertCanAccessEntity } = require('../../lib/entityAccess');

// multer writes `${Date.now()}-${random}${ext}` (documents + projects
// routes). Anything else — path separators, `..`, dotfiles — is never a
// file we issued, so it is rejected before touching the DB or disk.
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// A stored file is served only through the record that owns it, and only to
// someone allowed to read that record. Files with no owning row (orphans,
// anything dropped into the directory by hand) are never served.
async function resolveFile(filename, user) {
  if (!SAFE_FILENAME.test(filename) || filename.includes('..')) return { error: 'not_found' };
  const fileUrl = `/uploads/${filename}`;

  const doc = await prisma.document.findFirst({
    where: { file_url: fileUrl },
    select: { entity_type: true, entity_id: true, org_id: true, label: true },
  });
  if (doc) {
    const access = await assertCanAccessEntity(user, doc.entity_type, doc.entity_id);
    // Same read rule as GET /documents: attachments are readable across roles
    // once the caller can reach the parent entity at all — so a role-level
    // `forbidden` is not a denial here, but a missing membership, another
    // org's record or a vanished parent is.
    if (['membership_required', 'not_found', 'bad_entity'].includes(access.error)) {
      return { error: access.error === 'membership_required' ? 'membership_required' : 'forbidden' };
    }
    if (doc.org_id && doc.org_id !== user.org_id) return { error: 'forbidden' };
    return finish(filename, doc.label);
  }

  const projectDoc = await prisma.projectDocument.findFirst({
    where: { file_url: fileUrl },
    select: { org_id: true, title: true, org: { select: { enabled_modules: true } } },
  });
  if (projectDoc) {
    // Mirrors the /projects router: active membership, same org, admin, and
    // the projects module switched on for that org.
    if (!user.org_id || !user.org_membership_id) return { error: 'membership_required' };
    if (projectDoc.org_id !== user.org_id || user.role !== 'admin') return { error: 'forbidden' };
    if (!projectDoc.org.enabled_modules.includes('projects')) return { error: 'forbidden' };
    return finish(filename, projectDoc.title);
  }

  // Zephyr documents: same org, and a Zephyr role that may touch that owner type.
  const zxDoc = await prisma.zxDocument.findFirst({
    where: { file_url: fileUrl, deleted_at: null },
    select: { org_id: true, owner_type: true, title: true, file_name: true },
  });
  if (zxDoc) {
    if (!user.org_id || !user.org_membership_id) return { error: 'membership_required' };
    if (zxDoc.org_id !== user.org_id) return { error: 'forbidden' };
    const { resolveZxRole, capsFor } = require('../zephyr/access');
    const zx = await resolveZxRole(user);
    const cap = require('../zephyr/documents.service').capFor(zxDoc.owner_type);
    if (!zx.role || !capsFor(zx.role).includes(cap)) return { error: 'forbidden' };
    return finish(filename, zxDoc.file_name || zxDoc.title);
  }

  // Gulati documents: same rule against the Gulati role model.
  const gxDoc = await prisma.gxDocument.findFirst({
    where: { file_url: fileUrl, deleted_at: null },
    select: { org_id: true, owner_type: true, title: true, file_name: true },
  });
  if (gxDoc) {
    if (!user.org_id || !user.org_membership_id) return { error: 'membership_required' };
    if (gxDoc.org_id !== user.org_id) return { error: 'forbidden' };
    const { resolveGxRole, capsFor } = require('../gulati/access');
    const gx = await resolveGxRole(user);
    const cap = require('../gulati/documents.service').capFor(gxDoc.owner_type);
    if (!gx.role || !capsFor(gx.role).includes(cap)) return { error: 'forbidden' };
    return finish(filename, gxDoc.file_name || gxDoc.title);
  }

  // Acconcy documents: same rule against the Acconcy role model.
  const axDoc = await prisma.axDocument.findFirst({
    where: { file_url: fileUrl, deleted_at: null },
    select: { org_id: true, owner_type: true, title: true, file_name: true },
  });
  if (axDoc) {
    if (!user.org_id || !user.org_membership_id) return { error: 'membership_required' };
    if (axDoc.org_id !== user.org_id) return { error: 'forbidden' };
    const { resolveAxRole, capsFor } = require('../acconcy/access');
    const ax = await resolveAxRole(user);
    const cap = require('../acconcy/documents.service').capFor(axDoc.owner_type);
    if (!ax.role || !capsFor(ax.role).includes(cap)) return { error: 'forbidden' };
    return finish(filename, axDoc.file_name || axDoc.title);
  }

  return { error: 'not_found' };
}

function finish(filename, label) {
  const root = path.resolve(env.uploadDir);
  const absolute = path.join(root, filename);
  if (path.dirname(absolute) !== root || !fs.existsSync(absolute)) return { error: 'not_found' };
  return { root, filename, downloadName: downloadName(label, filename) };
}

// Label + the stored extension, stripped to characters safe in a header.
function downloadName(label, filename) {
  const ext = path.extname(filename);
  const base = String(label || 'download').replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, 100) || 'download';
  return base.toLowerCase().endsWith(ext.toLowerCase()) ? base : `${base}${ext}`;
}

module.exports = { resolveFile, SAFE_FILENAME };
