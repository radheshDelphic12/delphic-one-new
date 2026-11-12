// Off-server database backups: which dumps go up (about one an hour, pre-deploy always), which SharePoint copies are trimmed
// (24 newest, then one a day for 30 days; pre-deploy 30 days; other files never), and that backups use their OWN SharePoint place.
const { shouldUpload, planRemoteRetention } = require('../src/lib/offsiteBackup');
const { sharepointOptionsFromEnv } = require('../src/lib/sharepoint');

const NOW = new Date('2026-11-09T12:00:00Z');
const ago = (hours) => new Date(NOW.getTime() - hours * 3600000);
const file = (name, hours) => ({ id: name, name, modified_at: ago(hours), drive_id: 'd' });
const autoName = (i) => `auto-2026-10-${String(10 + (i % 18)).padStart(2, '0')}-${String(i % 24).padStart(2, '0')}0000.dump`;

describe('off-server backups', () => {
  test('a dump goes up when the newest copy is about an hour old; pre-deploy dumps always; other file names never', () => {
    const existing = [file('auto-2026-11-09-110000.dump', 0.5)];
    expect(shouldUpload('auto-2026-11-09-111500.dump', existing, NOW)).toBe(false); // 30 min after the last copy
    expect(shouldUpload('auto-2026-11-09-120000.dump', [file('auto-2026-11-09-110000.dump', 1)], NOW)).toBe(true);
    expect(shouldUpload('auto-2026-11-09-120000.dump', [], NOW)).toBe(true);
    expect(shouldUpload('predeploy-2026-11-09-115900.dump', existing, NOW)).toBe(true);
    expect(shouldUpload('notes.sql', [], NOW)).toBe(false);
    expect(shouldUpload('pre-restore-safety-2026-11-09.dump', [], NOW)).toBe(false);
  });

  test('the uploaded documents go up once a day as uploads-DATE.tar.gz and the newest 14 archives are kept', () => {
    expect(shouldUpload('uploads-2026-11-09.tar.gz', [], NOW)).toBe(true);
    expect(shouldUpload('uploads-2026-11-09.tar.gz', [file('uploads-2026-11-09.tar.gz', 2)], NOW)).toBe(false);
    expect(shouldUpload('uploads-2026-11-09.zip', [], NOW)).toBe(false);
    const files = [];
    for (let d = 0; d < 20; d += 1) files.push(file(`uploads-2026-10-${String(10 + d).padStart(2, '0')}.tar.gz`, 24 * (20 - d)));
    files.push(file('auto-2026-11-08-100000.dump', 30));
    const dropped = planRemoteRetention(files, NOW).map((f) => f.name);
    expect(dropped).toHaveLength(6);
    expect(dropped.every((n) => n.startsWith('uploads-'))).toBe(true);
    expect(dropped).toContain('uploads-2026-10-10.tar.gz');
    expect(dropped).not.toContain('uploads-2026-10-29.tar.gz');
  });

  test('retention keeps the newest 24 copies and one per day up to 30 days, drops the rest; other files are never touched', () => {
    const files = [];
    for (let i = 0; i < 24; i += 1) files.push(file(`auto-2026-11-08-${String(i).padStart(2, '0')}0000.dump`, i + 1)); // the last day: all kept
    files.push(file('auto-2026-11-05-100000.dump', 24 * 4)); // day A, newest of its day: kept
    files.push(file('auto-2026-11-05-090000.dump', 24 * 4 + 1)); // same day, older: dropped
    files.push(file('auto-2026-10-01-100000.dump', 24 * 39)); // older than 30 days: dropped
    files.push(file('predeploy-2026-11-01-100000.dump', 24 * 8)); // 8 days: kept
    files.push(file('predeploy-2026-09-01-100000.dump', 24 * 70)); // over 30 days: dropped
    files.push(file('readme.txt', 24 * 400)); // not a backup name: untouched
    const del = planRemoteRetention(files, NOW).map((f) => f.name).sort();
    expect(del).toEqual(['auto-2026-10-01-100000.dump', 'auto-2026-11-05-090000.dump', 'predeploy-2026-09-01-100000.dump']);
    expect(planRemoteRetention([], NOW)).toEqual([]);
    expect(autoName(1)).toMatch(/^auto-/); // helper sanity
  });

  test('backups have their own place (BACKUP_SP_*), separate from the recordings one; off unless set', () => {
    const base = { MS_GRAPH_TENANT_ID: 't', MS_GRAPH_CLIENT_ID: 'c', MS_GRAPH_CLIENT_SECRET: 's' };
    const env = { ...base, RECORDINGS_SP_SITE_URL: 'https://x.sharepoint.com/sites/HR' };
    expect(sharepointOptionsFromEnv(env, 'backups')).toBeNull(); // the HR place is never used for backups
    expect(sharepointOptionsFromEnv({ ...env, BACKUP_SP_SITE_URL: 'https://x.sharepoint.com/sites/IT' }, 'backups')).toMatchObject({ siteUrl: 'https://x.sharepoint.com/sites/IT', folder: 'DB-Backups' });
    expect(sharepointOptionsFromEnv({ ...base, BACKUP_SP_SITE_URL: 'https://x.sharepoint.com', BACKUP_SP_LIBRARY: 'DbBackups' }, 'backups')).toMatchObject({ library: 'DbBackups', folder: '' });
    expect(sharepointOptionsFromEnv(env, 'recordings')).toMatchObject({ siteUrl: 'https://x.sharepoint.com/sites/HR', folder: 'Interview-Recordings' });
  });
});
