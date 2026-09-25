const nodemailer = require('nodemailer');
const env = require('../../config/env');
const logger = require('../../config/logger');
const prisma = require('../../config/db');
const { methodOf } = require('./ics');

const MAX_ATTEMPTS = 5;

let cachedTransport;
function getTransport() {
  const url = env.notifications.email.smtpUrl;
  if (!url) return null;
  if (!cachedTransport) cachedTransport = nodemailer.createTransport(url);
  return cachedTransport;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

function defaultHtml(text) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
}

/**
 * Queue one email. Never throws (like notify()) — a mail problem must not roll
 * back the business transaction that triggered it. `client` may be a `tx`.
 */
async function enqueue(client, { orgId = null, kind, to, subject, text, html, ics }) {
  try {
    if (!to?.email) return null;
    return await client.emailOutbox.create({
      data: {
        org_id: orgId,
        kind,
        to_email: to.email,
        to_name: to.name || null,
        subject,
        body_text: text,
        body_html: html || defaultHtml(text),
        ics: ics || null,
      },
    });
  } catch (err) {
    logger.error('email_enqueue_failed', { kind, err });
    return null;
  }
}

/**
 * Drain queued (and previously failed, under the attempt cap) rows.
 * With no SMTP configured the rows are marked `skipped`, so a fresh
 * environment does not pile up mail forever and it is obvious in the table
 * that nothing left the building.
 */
async function processQueue({ limit = 25, transport = getTransport() } = {}) {
  const rows = await prisma.emailOutbox.findMany({
    where: { status: { in: ['queued', 'failed'] }, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { created_at: 'asc' },
    take: limit,
  });
  const result = { sent: 0, failed: 0, skipped: 0 };

  for (const row of rows) {
    if (!transport) {
      await prisma.emailOutbox.update({
        where: { id: row.id },
        data: { status: 'skipped', last_error: 'smtp_not_configured' },
      });
      result.skipped += 1;
      continue;
    }
    try {
      await transport.sendMail({
        from: env.notifications.email.from || 'Delphic One <no-reply@delphic.local>',
        to: row.to_name ? `"${row.to_name.replace(/"/g, '')}" <${row.to_email}>` : row.to_email,
        subject: row.subject,
        text: row.body_text,
        html: row.body_html || undefined,
        icalEvent: row.ics ? { method: methodOf(row.ics), content: row.ics } : undefined,
      });
      await prisma.emailOutbox.update({
        where: { id: row.id },
        data: { status: 'sent', sent_at: new Date(), attempts: { increment: 1 }, last_error: null },
      });
      result.sent += 1;
    } catch (err) {
      await prisma.emailOutbox.update({
        where: { id: row.id },
        data: { status: 'failed', attempts: { increment: 1 }, last_error: String(err.message || err).slice(0, 500) },
      });
      result.failed += 1;
    }
  }
  return result;
}

module.exports = { enqueue, processQueue, MAX_ATTEMPTS };
