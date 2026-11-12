const env = require('../../config/env');

// The website's four Apps Script web apps (D:/Delphic/delphic/scripts/*.gs).
// Platform calls are a POST of {action, secret, ...params}; the secret rides in
// the body because Apps Script can't read request headers. Apps Script answers
// a POST with a 302 to googleusercontent.com, which fetch follows as a GET —
// exactly what Apps Script expects.

const FORMS = ['contact', 'career', 'secure'];
const SCRIPTS = ['jobs', ...FORMS];
const TIMEOUT_MS = 15000;

function isConfigured() {
  const { scriptSecret, scripts } = env.website;
  return Boolean(scriptSecret && SCRIPTS.every((s) => scripts[s]));
}

function configStatus() {
  const { scriptSecret, scripts } = env.website;
  return {
    configured: isConfigured(),
    secret: Boolean(scriptSecret),
    scripts: Object.fromEntries(SCRIPTS.map((s) => [s, Boolean(scripts[s])])),
  };
}

/** Returns { data } on success, { error: 'apps_script_failed', message } otherwise. Never throws. */
async function call(script, action, params = {}) {
  const url = env.website.scripts[script];
  if (!url || !env.website.scriptSecret) return { error: 'website_not_configured' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...params, action, secret: env.website.scriptSecret }),
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      // A login page instead of JSON means the deployment isn't "Who has access: Anyone".
      return { error: 'apps_script_failed', message: `${script} script returned non-JSON (HTTP ${res.status}); check its deployment access` };
    }
    if (!body.success) {
      return { error: 'apps_script_failed', message: `${script} script: ${body.error || body.message || 'request rejected'}` };
    }
    return { data: body };
  } catch (err) {
    const message = err.name === 'AbortError' ? 'timed out' : err.message;
    return { error: 'apps_script_failed', message: `${script} script: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { call, isConfigured, configStatus, FORMS, SCRIPTS };
