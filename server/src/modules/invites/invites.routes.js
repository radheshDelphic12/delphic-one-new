const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const prisma = require('../../config/db');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const { buildInvite } = require('../../lib/email/ics');
const outbox = require('../../lib/email/outbox');

const router = express.Router();
router.use(authenticate, requireOrgMembership);

const sendSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(4000).optional(),
    location: z.string().max(300).optional(),
    meeting_url: z.string().url().max(1000).optional(),
    start: z.coerce.date(),
    end: z.coerce.date(),
    attendee_user_ids: z.array(z.string().uuid()).max(200).default([]),
    attendee_emails: z.array(z.string().email()).max(200).default([]),
  })
  .refine((v) => v.end > v.start, { message: 'end must be after start', path: ['end'] })
  .refine((v) => v.attendee_user_ids.length + v.attendee_emails.length > 0, {
    message: 'Add at least one attendee',
    path: ['attendee_user_ids'],
  });

const outboxQuerySchema = z.object({
  status: z.enum(['queued', 'sent', 'failed', 'skipped']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// Calendar invite ("Teams invite"): an .ics REQUEST email to internal people
// (org members only — never an arbitrary user id) and/or external emails. The
// organizer pastes the Teams/Meet join link into meeting_url; it is embedded in
// the invite so every calendar client shows it.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = sendSchema.parse(req.body);
    const members = body.attendee_user_ids.length
      ? await prisma.orgMembership.findMany({
          where: { org_id: req.user.org_id, person_id: { in: body.attendee_user_ids }, employment_status: 'active' },
          select: { person: { select: { id: true, name: true, email: true } } },
        })
      : [];
    if (members.length !== new Set(body.attendee_user_ids).size) {
      return fail(res, 422, 'Every internal attendee must be an active member of this organization');
    }

    const seen = new Set();
    const attendees = [];
    for (const m of members.map((row) => row.person)) {
      if (!seen.has(m.email.toLowerCase())) {
        seen.add(m.email.toLowerCase());
        attendees.push({ name: m.name, email: m.email });
      }
    }
    for (const email of body.attendee_emails) {
      if (!seen.has(email.toLowerCase())) {
        seen.add(email.toLowerCase());
        attendees.push({ email });
      }
    }

    const uid = `invite-${crypto.randomUUID()}@delphic-one`;
    const ics = buildInvite({
      uid,
      title: body.title,
      description: body.description || '',
      location: body.location || (body.meeting_url ? 'Online' : ''),
      url: body.meeting_url || '',
      start: body.start,
      end: body.end,
      organizer: { name: req.user.name, email: req.user.email },
      attendees,
    });

    const text = [
      `${req.user.name} invited you to: ${body.title}`,
      `When: ${body.start.toISOString()} to ${body.end.toISOString()} (UTC)`,
      body.location ? `Where: ${body.location}` : null,
      body.meeting_url ? `Join: ${body.meeting_url}` : null,
      body.description ? `\n${body.description}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    let queued = 0;
    for (const attendee of attendees) {
      const row = await outbox.enqueue(prisma, {
        orgId: req.user.org_id,
        kind: 'calendar_invite',
        to: attendee,
        subject: `Invitation: ${body.title}`,
        text,
        ics,
      });
      if (row) queued += 1;
    }
    return created(res, { uid, queued, attendees: attendees.length });
  })
);

// Delivery log (admin): what was queued, sent, failed, or skipped (no SMTP).
router.get(
  '/outbox',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const query = outboxQuerySchema.parse(req.query);
    const rows = await prisma.emailOutbox.findMany({
      where: { org_id: req.user.org_id, ...(query.status ? { status: query.status } : {}) },
      orderBy: { created_at: 'desc' },
      take: query.limit,
      select: {
        id: true,
        kind: true,
        to_email: true,
        subject: true,
        status: true,
        attempts: true,
        last_error: true,
        sent_at: true,
        created_at: true,
      },
    });
    return ok(res, rows);
  })
);

module.exports = router;
