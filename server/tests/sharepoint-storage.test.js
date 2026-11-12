// SharePoint storage client: settings from the environment, site -> library lookup, a resumable chunked upload, the download link,
// delete (a missing file counts as deleted), folder listing, token reuse, and retries. No network: fetch is injected.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sharepointOptionsFromEnv, createSharePointClient, CHUNK_BYTES } = require('../src/lib/sharepoint');

const base = { MS_GRAPH_TENANT_ID: 't', MS_GRAPH_CLIENT_ID: 'c', MS_GRAPH_CLIENT_SECRET: 's' };
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const opts = { tenantId: 't', clientId: 'c', clientSecret: 's', siteUrl: 'https://delphic.sharepoint.com/sites/HR', siteId: '', driveId: '', folder: 'Interview-Recordings' };

function fakeGraph(extra = () => null) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, init });
    const custom = extra(url, init);
    if (custom) return custom;
    if (url.includes('/oauth2/v2.0/token')) return json(200, { access_token: 'tok', expires_in: 3600 });
    if (url.includes('/sites/delphic.sharepoint.com:/sites/HR')) return json(200, { id: 'site-1' });
    if (url.endsWith('/sites/site-1/drive?$select=id')) return json(200, { id: 'drive-1' });
    throw new Error(`unexpected ${init.method || 'GET'} ${url}`);
  };
  return { calls, fetchFn };
}

describe('sharepoint storage', () => {
  let tmp;
  beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-')); });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test('settings: needs the three app values and a site; the folder defaults to Interview-Recordings', () => {
    expect(sharepointOptionsFromEnv({})).toBeNull();
    expect(sharepointOptionsFromEnv(base)).toBeNull();
    expect(sharepointOptionsFromEnv({ RECORDINGS_SP_SITE_URL: 'https://x.sharepoint.com/sites/HR' })).toBeNull();
    expect(sharepointOptionsFromEnv({ ...base, RECORDINGS_SP_SITE_URL: 'https://x.sharepoint.com/sites/HR' })).toMatchObject({ siteUrl: 'https://x.sharepoint.com/sites/HR', folder: 'Interview-Recordings' });
    expect(sharepointOptionsFromEnv({ ...base, RECORDINGS_SP_SITE_ID: 'id-1', RECORDINGS_SP_FOLDER: '/Rec/2026/' })).toMatchObject({ siteId: 'id-1', folder: 'Rec/2026' });
  });

  test('uploads a small file in one chunk, finds the site and library once, and returns the item id and link', async () => {
    const file = path.join(tmp, 'a.webm');
    fs.writeFileSync(file, 'AAAABBBB');
    const { calls, fetchFn } = fakeGraph((url) => {
      if (url.includes('createUploadSession')) return json(200, { uploadUrl: 'https://upload.example/u1' });
      if (url === 'https://upload.example/u1') return json(201, { id: 'item-1', webUrl: 'https://delphic.sharepoint.com/sites/HR/x.webm' });
      return null;
    });
    const sp = createSharePointClient(opts, fetchFn);
    const out = await sp.uploadFile(file, 'a.webm');
    expect(out).toEqual({ drive_id: 'drive-1', item_id: 'item-1', web_url: 'https://delphic.sharepoint.com/sites/HR/x.webm', bytes: 8 });
    const session = calls.find((c) => c.url.includes('createUploadSession'));
    expect(session.url).toContain('/drives/drive-1/root:/Interview-Recordings/a.webm:/createUploadSession');
    expect(session.init.headers.Authorization).toBe('Bearer tok');
    const put = calls.find((c) => c.url === 'https://upload.example/u1');
    expect(put.init.headers['Content-Range']).toBe('bytes 0-7/8');
    expect(put.init.headers.Authorization).toBeUndefined(); // the upload url is pre-authorised
    await sp.uploadFile(file, 'a.webm');
    expect(calls.filter((c) => c.url.includes('/oauth2/v2.0/token'))).toHaveLength(1); // one token reused
    expect(calls.filter((c) => c.url.includes('/sites/delphic.sharepoint.com:'))).toHaveLength(1); // library found once
  });

  test('a library of its own on the root site: found by name, files go straight into it, listing starts at its root', async () => {
    expect(sharepointOptionsFromEnv({ ...base, RECORDINGS_SP_SITE_URL: 'https://cozzera.sharepoint.com', RECORDINGS_SP_LIBRARY: 'InterviewRecordings' })).toMatchObject({ library: 'InterviewRecordings', folder: '' });
    const file = path.join(tmp, 'lib.webm');
    fs.writeFileSync(file, 'AAAA');
    const { calls, fetchFn } = fakeGraph((url) => {
      if (url.endsWith('/sites/cozzera.sharepoint.com?$select=id')) return json(200, { id: 'root-site' });
      if (url.includes('/sites/root-site/drives')) return json(200, { value: [{ id: 'docs', name: 'Documents', webUrl: 'https://cozzera.sharepoint.com/Shared%20Documents' }, { id: 'lib-1', name: 'Interview Recordings', webUrl: 'https://cozzera.sharepoint.com/InterviewRecordings' }] });
      if (url.includes('createUploadSession')) return json(200, { uploadUrl: 'https://upload.example/u9' });
      if (url === 'https://upload.example/u9') return json(201, { id: 'item-9', webUrl: 'w' });
      if (url.includes('/drives/lib-1/root/children')) return json(200, { value: [] });
      return null;
    });
    const sp = createSharePointClient({ ...opts, siteUrl: 'https://cozzera.sharepoint.com', library: 'InterviewRecordings', folder: '' }, fetchFn);
    expect((await sp.uploadFile(file, 'x.webm')).drive_id).toBe('lib-1'); // matched by the last part of its address
    expect(calls.find((c) => c.url.includes('createUploadSession')).url).toContain('/drives/lib-1/root:/x.webm:/createUploadSession');
    expect(await sp.listFolder()).toEqual([]);
    await expect(createSharePointClient({ ...opts, siteUrl: 'https://cozzera.sharepoint.com', library: 'Nope', folder: '' }, fetchFn).uploadFile(file, 'x.webm')).rejects.toThrow(/sharepoint_library_not_found/);
  });

  test('a file bigger than one chunk goes up in order with the right ranges', async () => {
    const file = path.join(tmp, 'big.webm');
    const size = CHUNK_BYTES + 1000;
    fs.writeFileSync(file, Buffer.alloc(size, 7));
    const ranges = [];
    const { fetchFn } = fakeGraph((url, init) => {
      if (url.includes('createUploadSession')) return json(200, { uploadUrl: 'https://upload.example/u2' });
      if (url === 'https://upload.example/u2') {
        ranges.push(init.headers['Content-Range']);
        return ranges.length === 1 ? json(202, {}) : json(200, { id: 'item-2', webUrl: 'w' });
      }
      return null;
    });
    const out = await createSharePointClient({ ...opts, driveId: 'drive-1' }, fetchFn).uploadFile(file, 'big.webm');
    expect(ranges).toEqual([`bytes 0-${CHUNK_BYTES - 1}/${size}`, `bytes ${CHUNK_BYTES}-${size - 1}/${size}`]);
    expect(out.item_id).toBe('item-2');
  });

  test('a failed upload throws (so the caller keeps the local file); a 5xx on a chunk is retried', async () => {
    const file = path.join(tmp, 'c.webm');
    fs.writeFileSync(file, 'xyz');
    const failing = fakeGraph((url) => (url.includes('createUploadSession') ? json(403, { error: { code: 'accessDenied', message: 'Access denied' } }) : null));
    await expect(createSharePointClient({ ...opts, driveId: 'drive-1' }, failing.fetchFn).uploadFile(file, 'c.webm')).rejects.toThrow(/sharepoint_upload_session_failed 403: accessDenied/);

    let puts = 0;
    const flaky = fakeGraph((url) => {
      if (url.includes('createUploadSession')) return json(200, { uploadUrl: 'https://upload.example/u3' });
      if (url === 'https://upload.example/u3') { puts += 1; return puts === 1 ? json(503, {}) : json(201, { id: 'item-3', webUrl: 'w' }); }
      return null;
    });
    const out = await createSharePointClient({ ...opts, driveId: 'drive-1' }, flaky.fetchFn, async () => {}).uploadFile(file, 'c.webm');
    expect(out.item_id).toBe('item-3');
    expect(puts).toBe(2);
    await expect(createSharePointClient({ ...opts, driveId: 'drive-1' }, fakeGraph().fetchFn).uploadFile(path.join(tmp, 'none.webm'), 'n.webm')).rejects.toThrow();
  });

  test('download link, delete (already gone = fine) and folder listing with paging', async () => {
    const { calls, fetchFn } = fakeGraph((url, init) => {
      // the plain item (no $select, which makes SharePoint leave the link out) carries the download link
      if (init.method === 'GET' && url.endsWith('/items/item-1')) return json(200, { id: 'item-1', '@microsoft.graph.downloadUrl': 'https://dl.example/abc' });
      if (url.includes('/items/item-1?$select')) return json(200, { id: 'item-1' }); // what SharePoint really answers to $select: no link
      if (init.method === 'GET' && url.endsWith('/items/missing')) return json(404, {});
      if (init.method === 'DELETE' && url.endsWith('/items/item-1')) return json(204, {});
      if (init.method === 'DELETE' && url.endsWith('/items/gone')) return json(404, {});
      if (url.includes('/root:/Interview-Recordings:/children') && !url.includes('page2')) return json(200, { value: [{ id: 'f1', name: 'a.webm', lastModifiedDateTime: '2026-11-01T00:00:00Z', file: {} }, { id: 'd1', name: 'sub', lastModifiedDateTime: '2026-11-01T00:00:00Z' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/page2' });
      if (url.includes('page2')) return json(200, { value: [{ id: 'f2', name: 'b.webm', lastModifiedDateTime: '2026-11-02T00:00:00Z', file: {} }] });
      return null;
    });
    const sp = createSharePointClient({ ...opts, driveId: 'drive-1' }, fetchFn);
    expect(await sp.downloadUrl('item-1')).toBe('https://dl.example/abc');
    expect(await sp.downloadUrl('missing')).toBeNull();
    expect(await sp.deleteItem('item-1')).toBe(true);
    expect(await sp.deleteItem('gone')).toBe(true);
    const list = await sp.listFolder();
    expect(list.map((f) => f.id)).toEqual(['f1', 'f2']); // folders are skipped
    expect(calls.some((c) => c.init.method === 'DELETE')).toBe(true);
  });

  test('an expired token (401) is replaced once; a refusal that stays is an error', async () => {
    let tokens = 0;
    let first = true;
    const fetchFn = async (url) => {
      if (url.includes('/oauth2/v2.0/token')) { tokens += 1; return json(200, { access_token: `tok${tokens}`, expires_in: 3600 }); }
      if (first) { first = false; return json(401, {}); }
      return json(204, {});
    };
    expect(await createSharePointClient({ ...opts, driveId: 'drive-1' }, fetchFn).deleteItem('x')).toBe(true);
    expect(tokens).toBe(2);
    const denied = async (url) => (url.includes('/oauth2/v2.0/token') ? json(200, { access_token: 't', expires_in: 3600 }) : json(403, { error: { code: 'accessDenied', message: 'no' } }));
    await expect(createSharePointClient({ ...opts, driveId: 'drive-1' }, denied).deleteItem('x')).rejects.toThrow(/sharepoint_delete_failed 403/);
  });
});
