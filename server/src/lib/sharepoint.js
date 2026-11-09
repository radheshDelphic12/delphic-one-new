// SharePoint / OneDrive storage through Microsoft Graph (app-only), used for AI interview recordings so they do not fill the server disk.
//
// Needs the same Azure app as the Graph mail sender, with the `Sites.Selected` APPLICATION permission (admin consent) and a `write`
// grant on ONE site. Settings (never hard-coded):
//   MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET   (same as the mail sender)
//   RECORDINGS_SP_SITE_URL   e.g. https://delphic.sharepoint.com/sites/HR     (or RECORDINGS_SP_SITE_ID, the Graph site id)
//   RECORDINGS_SP_LIBRARY    optional: a document library of its own, by name (e.g. InterviewRecordings); files go straight into it
//   RECORDINGS_SP_DRIVE_ID   optional: a document library id; default is the site's default library ("Documents")
//   RECORDINGS_SP_FOLDER     folder inside the library, default Interview-Recordings
// With any of the app values or the site missing, SharePoint storage is off and recordings stay on the server as before.
//
// Database backups (scripts/offsite-backup.sh) use the SAME app but their OWN place, with the BACKUP_SP_ prefix instead
// (BACKUP_SP_SITE_URL, BACKUP_SP_LIBRARY, BACKUP_SP_FOLDER, BACKUP_SP_DRIVE_ID): a dump holds every company's data, so it must go to a
// site or library that only admins can open, never the HR one.

const fs = require('fs');
const { graphOptionsFromEnv } = require('./email/graphMail');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const TOKEN_SAFETY_MS = 120000;
// Graph wants upload chunks in multiples of 320 KiB; 32 x 320 KiB = 10 MiB.
const CHUNK_BYTES = 32 * 320 * 1024;
const MAX_TRIES = 3;

const PLACES = {
  recordings: { prefix: 'RECORDINGS_SP', folder: 'Interview-Recordings' },
  backups: { prefix: 'BACKUP_SP', folder: 'DB-Backups' },
};

/** Settings for one place ('recordings' or 'backups'), or null when the three app values or the site are missing. */
function sharepointOptionsFromEnv(e = process.env, place = 'recordings') {
  const { prefix, folder: defaultFolder } = PLACES[place];
  const graph = graphOptionsFromEnv(e);
  const pick = (k) => (e[`${prefix}_${k}`] || '').trim();
  const siteUrl = pick('SITE_URL');
  const siteId = pick('SITE_ID');
  if (!graph || !(siteUrl || siteId)) return null;
  const clean = (p) => p.replace(/^\/+|\/+$/g, '');
  const library = pick('LIBRARY');
  return {
    ...graph, siteUrl, siteId, driveId: pick('DRIVE_ID'), library,
    // inside a library of its own the files go straight into it; in the site's default "Documents" they go into a folder
    folder: clean(pick('FOLDER') || (library ? '' : defaultFolder)),
  };
}

const encodePath = (p) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** `fetchFn` and `sleep` are injectable for tests. */
function createSharePointClient(options, fetchFn = fetch, sleep = wait) {
  let token = null;
  let driveId = options.driveId || null;

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

  // A Graph call with the app token: a 401 gets one fresh token, 429 / 5xx are retried with a short wait.
  async function graph(method, url, { json, headers } = {}) {
    let refreshed = false;
    for (let attempt = 1; ; attempt += 1) {
      const res = await fetchFn(url.startsWith('http') ? url : `${GRAPH}${url}`, {
        method,
        headers: { Authorization: `Bearer ${await accessToken()}`, ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(json ? { body: JSON.stringify(json) } : {}),
      });
      if (res.status === 401 && !refreshed) { token = null; refreshed = true; continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_TRIES) { await sleep(500 * attempt); continue; }
      return res;
    }
  }

  const fail = async (what, res) => {
    const body = await res.json().catch(() => ({}));
    return new Error(`sharepoint_${what}_failed ${res.status}: ${body.error?.code || ''} ${body.error?.message || ''}`.trim().slice(0, 400));
  };

  async function resolveDrive() {
    if (driveId) return driveId;
    let siteId = options.siteId;
    if (!siteId) {
      const u = new URL(options.siteUrl);
      const sitePath = encodePath(u.pathname);
      const res = await graph('GET', `/sites/${u.hostname}${sitePath ? `:/${sitePath}` : ''}?$select=id`);
      if (!res.ok) throw await fail('site', res);
      siteId = (await res.json()).id;
    }
    if (options.library) {
      // a library of its own, found by its name or by the last part of its address (e.g. https://host/InterviewRecordings)
      const list = await graph('GET', `/sites/${siteId}/drives?$select=id,name,webUrl`);
      if (!list.ok) throw await fail('libraries', list);
      const want = options.library.toLowerCase();
      const hit = ((await list.json()).value || []).find((d) => String(d.name).toLowerCase() === want || decodeURIComponent(String(d.webUrl || '')).toLowerCase().endsWith(`/${want}`));
      if (!hit) throw new Error(`sharepoint_library_not_found: no library named "${options.library}" on the site`);
      driveId = hit.id;
      return driveId;
    }
    const res = await graph('GET', `/sites/${siteId}/drive?$select=id`);
    if (!res.ok) throw await fail('drive', res);
    driveId = (await res.json()).id;
    return driveId;
  }

  /** Uploads a local file into the recordings folder, or `folder` (a resumable upload session, any size). Returns { drive_id, item_id, web_url, bytes }. */
  async function uploadFile(localPath, remoteName, folder = options.folder) {
    const drive = await resolveDrive();
    const size = (await fs.promises.stat(localPath)).size;
    if (!size) throw new Error('sharepoint_upload_failed: empty file');
    const create = await graph('POST', `/drives/${drive}/root:/${encodePath(`${folder || ''}/${remoteName}`)}:/createUploadSession`, { json: { item: { '@microsoft.graph.conflictBehavior': 'replace' } } });
    if (!create.ok) throw await fail('upload_session', create);
    const { uploadUrl } = await create.json();
    const handle = await fs.promises.open(localPath, 'r');
    try {
      let offset = 0;
      for (;;) {
        const length = Math.min(CHUNK_BYTES, size - offset);
        const buf = Buffer.alloc(length);
        await handle.read(buf, 0, length, offset);
        let res;
        for (let attempt = 1; ; attempt += 1) {
          // the upload url is pre-authorised: no Authorization header on it
          res = await fetchFn(uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(length), 'Content-Range': `bytes ${offset}-${offset + length - 1}/${size}` }, body: buf });
          if ((res.status === 429 || res.status >= 500) && attempt < MAX_TRIES) { await sleep(500 * attempt); continue; }
          break;
        }
        offset += length;
        if (res.status === 200 || res.status === 201) {
          const item = await res.json();
          return { drive_id: drive, item_id: item.id, web_url: item.webUrl, bytes: size };
        }
        if (res.status !== 202) throw await fail('upload', res);
        if (offset >= size) throw new Error('sharepoint_upload_failed: upload did not complete');
      }
    } finally {
      await handle.close();
    }
  }

  /** A short-lived, pre-authorised link to the file (for play / download in the browser). */
  async function downloadUrl(itemId, drive = null) {
    const res = await graph('GET', `/drives/${drive || await resolveDrive()}/items/${encodeURIComponent(itemId)}?$select=id,@microsoft.graph.downloadUrl`);
    if (res.status === 404) return null;
    if (!res.ok) throw await fail('link', res);
    return (await res.json())['@microsoft.graph.downloadUrl'] || null;
  }

  /** Deletes one file; a file that is already gone counts as deleted. */
  async function deleteItem(itemId, drive = null) {
    const res = await graph('DELETE', `/drives/${drive || await resolveDrive()}/items/${encodeURIComponent(itemId)}`);
    if (res.status === 404) return true;
    if (!res.ok) throw await fail('delete', res);
    return true;
  }

  /** The files in the recordings folder: [{ id, name, modified_at }] (for the clean-up of anything older than the retention cap). */
  async function listFolder(folder = options.folder) {
    const drive = await resolveDrive();
    const out = [];
    const where = encodePath(folder || '') ? `root:/${encodePath(folder)}:` : 'root';
    let url = `/drives/${drive}/${where}/children?$select=id,name,lastModifiedDateTime,file&$top=200`;
    while (url) {
      const res = await graph('GET', url);
      if (res.status === 404) return out;
      if (!res.ok) throw await fail('list', res);
      const body = await res.json();
      for (const i of body.value || []) if (i.file) out.push({ id: i.id, name: i.name, modified_at: new Date(i.lastModifiedDateTime), drive_id: drive });
      url = body['@odata.nextLink'] || null;
    }
    return out;
  }

  return { kind: 'sharepoint', folder: options.folder, uploadFile, downloadUrl, deleteItem, listFolder };
}

const cached = {};
/** The shared client for 'recordings' (default) or 'backups', built from the environment, or null when that place is not set up. */
function getSharePoint(place = 'recordings') {
  if (cached[place] === undefined) {
    const opts = sharepointOptionsFromEnv(process.env, place);
    cached[place] = opts ? createSharePointClient(opts) : null;
  }
  return cached[place];
}
const resetSharePointForTests = () => { Object.keys(cached).forEach((k) => delete cached[k]); };

module.exports = { sharepointOptionsFromEnv, createSharePointClient, getSharePoint, resetSharePointForTests, CHUNK_BYTES };
