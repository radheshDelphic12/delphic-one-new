// Microsoft Graph mail sender: settings from the environment (never hard-coded), the Graph request it builds, one token reused,
// a 401 retried once with a fresh token, and clear errors. No network: fetch is injected.
const { graphOptionsFromEnv, createGraphTransport, buildMessage, parseAddress } = require('../src/lib/email/graphMail');

const opts = { tenantId: 't-1', clientId: 'c-1', clientSecret: 's-1' };
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const mail = { from: 'Delphic One <noreply.secure@delphic.in>', to: '"Asha Rao" <asha@alpha.test>', cc: 'owner@x.test', subject: 'Requirement: Java', text: 'Hello\nthere', html: '<p>Hello</p>' };

describe('graph mail', () => {
  test('settings: all three app values are needed (MAIL_GRAPH_* accepted as aliases); otherwise graph is off', () => {
    expect(graphOptionsFromEnv({})).toBeNull();
    expect(graphOptionsFromEnv({ MS_GRAPH_TENANT_ID: 'a', MS_GRAPH_CLIENT_ID: 'b' })).toBeNull();
    expect(graphOptionsFromEnv({ MS_GRAPH_TENANT_ID: 'a', MS_GRAPH_CLIENT_ID: 'b', MS_GRAPH_CLIENT_SECRET: 'c' })).toEqual({ tenantId: 'a', clientId: 'b', clientSecret: 'c' });
    expect(graphOptionsFromEnv({ MAIL_GRAPH_TENANT_ID: 'a', MAIL_GRAPH_CLIENT_ID: 'b', MAIL_GRAPH_CLIENT_SECRET: 'c' })).toEqual({ tenantId: 'a', clientId: 'b', clientSecret: 'c' });
  });

  test('addresses and the Graph message body', () => {
    expect(parseAddress('Delphic One <noreply.secure@delphic.in>')).toEqual({ name: 'Delphic One', address: 'noreply.secure@delphic.in' });
    expect(parseAddress('plain@x.com')).toEqual({ name: null, address: 'plain@x.com' });
    const body = buildMessage({ ...mail, icalEvent: { method: 'REQUEST', content: 'BEGIN:VCALENDAR' } });
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: 'asha@alpha.test', name: 'Asha Rao' } }]);
    expect(body.message.ccRecipients).toEqual([{ emailAddress: { address: 'owner@x.test' } }]);
    expect(body.message.body).toEqual({ contentType: 'HTML', content: '<p>Hello</p>' });
    expect(body.message.attachments[0]).toMatchObject({ name: 'invite.ics', contentType: 'text/calendar; method=REQUEST' });
    expect(Buffer.from(body.message.attachments[0].contentBytes, 'base64').toString()).toBe('BEGIN:VCALENDAR');
    expect(buildMessage({ ...mail, html: undefined }).message.body).toEqual({ contentType: 'Text', content: 'Hello\nthere' });
  });

  test('sends as the From mailbox with an app token that is fetched once and reused', async () => {
    const calls = [];
    const fetchFn = async (url, init) => {
      calls.push({ url, init });
      return url.includes('/oauth2/v2.0/token') ? json(200, { access_token: 'tok', expires_in: 3600 }) : json(202, {});
    };
    const t = createGraphTransport(opts, fetchFn);
    await t.sendMail(mail);
    await t.sendMail(mail);
    const tokenCalls = calls.filter((c) => c.url.includes('/oauth2/v2.0/token'));
    const sendCalls = calls.filter((c) => c.url.includes('/sendMail'));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].url).toContain('/t-1/');
    expect(String(tokenCalls[0].init.body)).toContain('grant_type=client_credentials');
    expect(sendCalls).toHaveLength(2);
    expect(sendCalls[0].url).toBe('https://graph.microsoft.com/v1.0/users/noreply.secure%40delphic.in/sendMail');
    expect(sendCalls[0].init.headers.Authorization).toBe('Bearer tok');
  });

  test('a 401 gets one retry with a fresh token; failures carry a clear reason', async () => {
    let sends = 0;
    let tokens = 0;
    const fetchFn = async (url) => {
      if (url.includes('/oauth2/v2.0/token')) { tokens += 1; return json(200, { access_token: `tok${tokens}`, expires_in: 3600 }); }
      sends += 1;
      return sends === 1 ? json(401, { error: { code: 'InvalidAuthenticationToken' } }) : json(202, {});
    };
    await createGraphTransport(opts, fetchFn).sendMail(mail);
    expect(tokens).toBe(2);

    const denied = async (url) => (url.includes('/oauth2/v2.0/token') ? json(200, { access_token: 'x', expires_in: 3600 }) : json(403, { error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } }));
    await expect(createGraphTransport(opts, denied).sendMail(mail)).rejects.toThrow(/graph_send_failed 403: ErrorAccessDenied/);
    const badSecret = async () => json(401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' });
    await expect(createGraphTransport(opts, badSecret).sendMail(mail)).rejects.toThrow(/graph_token_failed: AADSTS7000215/);
    await expect(createGraphTransport(opts, denied).sendMail({ ...mail, from: '' })).rejects.toThrow(/graph_no_sender/);
  });
});
