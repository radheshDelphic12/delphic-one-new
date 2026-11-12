// SMTP settings from the environment. Two ways to configure the same mailbox (never hard-code credentials):
//   1. NOTIFICATIONS_SMTP_URL  e.g. smtps://user:pass@smtp.example.com:465   (a password with special characters must be URL-encoded)
//   2. NOTIFICATIONS_SMTP_HOST / _PORT / _SECURE / _USER / _PASS               (separate values, nothing to URL-encode)
// The URL wins when both are set. NOTIFICATIONS_EMAIL_FROM is the From address of every mail. Neither set -> no SMTP:
// the outbox marks queued mail `skipped` (see outbox.js).

/** Returns the nodemailer transport options (a URL string or an options object), or null when SMTP is not configured. */
function smtpOptionsFromEnv(e = process.env) {
  if (e.NOTIFICATIONS_SMTP_URL) return e.NOTIFICATIONS_SMTP_URL;
  const host = (e.NOTIFICATIONS_SMTP_HOST || '').trim();
  if (!host) return null;
  const port = Number(e.NOTIFICATIONS_SMTP_PORT) || 587;
  // TLS: port 465 is implicit TLS (secure=true); 587 / 25 start plain and upgrade with STARTTLS. NOTIFICATIONS_SMTP_SECURE overrides.
  const secure = e.NOTIFICATIONS_SMTP_SECURE === undefined || e.NOTIFICATIONS_SMTP_SECURE === '' ? port === 465 : /^(1|true|yes)$/i.test(e.NOTIFICATIONS_SMTP_SECURE);
  return {
    host,
    port,
    secure,
    ...(e.NOTIFICATIONS_SMTP_USER ? { auth: { user: e.NOTIFICATIONS_SMTP_USER, pass: e.NOTIFICATIONS_SMTP_PASS || '' } } : {}),
  };
}

module.exports = { smtpOptionsFromEnv };
