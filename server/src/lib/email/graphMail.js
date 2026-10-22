// Microsoft Graph mail sender (app-only). Works when SMTP AUTH is disabled on the Microsoft 365 tenant.
//
// Needs an Azure AD app registration with the `Mail.Send` APPLICATION permission (admin consent granted), restricted to the
// sending mailbox by an Exchange Application Access Policy. The mail goes out as the mailbox in NOTIFICATIONS_EMAIL_FROM.
//   MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET   (MAIL_GRAPH_* are accepted as aliases)
// Nothing here is hard-coded; with any of the three missing, graph is off and the outbox falls back to SMTP / `skipped`.

const TOKEN_SAFETY_MS = 120000; // renew a token this long before it expires

/** Graph settings from the environment, or null when the three app values are not all set. */
function graphOptionsFromEnv(e = process.env) {
  const pick = (a, b) => (e[a] || e[b] || '').trim();
  const tenantId = pick('MS_GRAPH_TENANT_ID', 'MAIL_GRAPH_TENANT_ID');
  const clientId = pick('MS_GRAPH_CLIENT_ID', 'MAIL_GRAPH_CLIENT_ID');
  const clientSecret = pick('MS_GRAPH_CLIENT_SECRET', 'MAIL_GRAPH_CLIENT_SECRET');
  return tenantId && clientId && clientSecret ? { tenantId, clientId, clientSecret } : null;
}

/** "Name <a@b.com>" or "a@b.com" -> { name, address } */
function parseAddress(value) {
  const text = String(value || '').trim();
  const m = text.match(/^(?:"?([^"<]*?)"?\s*)?<([^>]+)>$/);
  return m ? { name: (m[1] || '').trim() || null, address: m[2].trim() } : { name: null, address: text };
}

const recipient = (value) => {
  const { name, address } = parseAddress(value);
  return { emailAddress: { address, ...(name ? { name } : {}) } };
};

/** Builds the Graph `sendMail` body from a nodemailer-style message ({ to, cc, subject, text, html, icalEvent }). */
function buildMessage(mail) {
  const html = Boolean(mail.html);
  return {
    message: {
      subject: mail.subject,
      body: { contentType: html ? 'HTML' : 'Text', content: html ? mail.html : mail.text || '' },
      toRecipients: [recipient(mail.to)],
      ...(mail.cc ? { ccRecipients: [recipient(mail.cc)] } : {}),
      ...(mail.icalEvent
        ? { attachments: [{ '@odata.type': '#microsoft.graph.fileAttachment', name: 'invite.ics', contentType: `text/calendar; method=${mail.icalEvent.method || 'REQUEST'}`, contentBytes: Buffer.from(mail.icalEvent.content, 'utf8').toString('base64') }] }
        : {}),
    },
    saveToSentItems: true,
  };
}

/**
 * Transport with the same `sendMail(mail)` shape the outbox uses for nodemailer. `fetchFn` is injectable for tests.
 * The sender mailbox is the address in `mail.from`.
 */
function createGraphTransport(options, fetchFn = fetch) {
  let token = null; // { value, expiresAt }

  async function accessToken() {
    if (token && token.expiresAt - TOKEN_SAFETY_MS > Date.now()) return token.value;
    const res = await fetchFn(`https://login.microsoftonline.com/${encodeURIComponent(options.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: options.clientId, client_secret: options.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) throw new Error(`graph_token_failed: ${body.error_description || body.error || res.status}`.split('\n')[0]);
    token = { value: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
    return token.value;
  }

  return {
    kind: 'graph',
    async sendMail(mail) {
      const sender = parseAddress(mail.from).address;
      if (!sender) throw new Error('graph_no_sender: set NOTIFICATIONS_EMAIL_FROM to the sending mailbox');
      const send = async () => fetchFn(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildMessage(mail)),
      });
      let res = await send();
      if (res.status === 401) { token = null; res = await send(); } // an expired or revoked token: get a new one once
      if (res.status !== 202) {
        const body = await res.json().catch(() => ({}));
        throw new Error(`graph_send_failed ${res.status}: ${body.error?.code || ''} ${body.error?.message || ''}`.trim().slice(0, 400));
      }
      return { accepted: [mail.to] };
    },
  };
}

module.exports = { graphOptionsFromEnv, createGraphTransport, buildMessage, parseAddress };
