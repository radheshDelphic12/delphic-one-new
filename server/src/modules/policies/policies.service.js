const sanitizeHtml = require('sanitize-html');
const prisma = require('../../config/db');

// The editor produces simple formatted text; anything else (scripts, styles,
// event handlers, iframes) is stripped before it is stored, so rendering it is safe.
const SANITIZE = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'ul', 'ol', 'li', 'blockquote', 'a', 'span', 'div',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  transformTags: { a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }, true) },
};

const clean = (html) => sanitizeHtml(html || '', SANITIZE);

const LIST_SELECT = { id: true, title: true, category: true, is_published: true, created_at: true, updated_at: true };

async function list(orgId, { includeDrafts }) {
  return prisma.policy.findMany({
    where: { org_id: orgId, ...(includeDrafts ? {} : { is_published: true }) },
    select: { ...LIST_SELECT, content: true },
    orderBy: [{ category: 'asc' }, { title: 'asc' }],
  });
}

async function create(orgId, userId, { title, category, content, is_published }) {
  return prisma.policy.create({
    data: { org_id: orgId, title, category: category ?? null, content: clean(content), is_published: Boolean(is_published), created_by: userId, updated_by: userId },
  });
}

async function update(orgId, userId, id, patch) {
  const existing = await prisma.policy.findFirst({ where: { id, org_id: orgId }, select: { id: true } });
  if (!existing) return { error: 'not_found' };
  const data = { updated_by: userId };
  for (const key of ['title', 'category', 'is_published']) if (patch[key] !== undefined) data[key] = patch[key];
  if (patch.content !== undefined) data.content = clean(patch.content);
  return { policy: await prisma.policy.update({ where: { id }, data }) };
}

async function remove(orgId, id) {
  const res = await prisma.policy.deleteMany({ where: { id, org_id: orgId } });
  return res.count > 0;
}

module.exports = { list, create, update, remove, clean };
