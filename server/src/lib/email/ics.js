// Minimal RFC 5545 calendar-invite builder (no external dependency).

function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function utcStamp(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// Content lines longer than 75 octets are folded with CRLF + one space.
function fold(line) {
  const chunks = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut -= 1;
    chunks.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  chunks.push(rest);
  return chunks.join('\r\n');
}

/**
 * buildInvite({ uid, title, description, location, url, start, end,
 *   organizer: { name, email }, attendees: [{ name, email }],
 *   method = 'REQUEST' | 'CANCEL', sequence = 0 })
 * `url` is the join link (a Teams/Meet URL pasted by the organizer) — it goes in
 * both URL and the description so every calendar client surfaces it.
 */
function buildInvite({
  uid,
  title,
  description = '',
  location = '',
  url = '',
  start,
  end,
  organizer,
  attendees = [],
  method = 'REQUEST',
  sequence = 0,
}) {
  const body = url ? `${description}${description ? '\n\n' : ''}Join: ${url}` : description;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Delphic One//Calendar//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    `SEQUENCE:${sequence}`,
    `SUMMARY:${escapeText(title)}`,
    `DESCRIPTION:${escapeText(body)}`,
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
  ];
  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  if (url) lines.push(`URL:${url}`);
  if (organizer?.email) {
    lines.push(`ORGANIZER;CN=${escapeText(organizer.name || organizer.email)}:mailto:${organizer.email}`);
  }
  for (const attendee of attendees) {
    lines.push(
      `ATTENDEE;CN=${escapeText(attendee.name || attendee.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${attendee.email}`
    );
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

function methodOf(ics) {
  const match = /METHOD:([A-Z]+)/.exec(ics || '');
  return match ? match[1] : 'REQUEST';
}

module.exports = { buildInvite, methodOf, escapeText };
