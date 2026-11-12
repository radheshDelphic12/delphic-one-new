import { useEffect, useState } from 'react';
import { HardDrive } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Skeleton from '../../components/ui/Skeleton.jsx';
import Pill from '../../components/ui/Pill.jsx';

// Group Dashboard > Settings > Storage: how full the server disk is, what uploaded files take, how big the database is.
const size = (bytes) => {
  const b = Number(bytes) || 0;
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(b / 1024)} KB`;
};
const LEVEL = { ok: ['green', 'Healthy'], warning: ['amber', 'Getting full'], critical: ['red', 'Almost full'] };
const th = 'py-1 text-left text-xs font-medium text-tertiary-500';

export default function StorageCard() {
  const { pushError } = useAlerts();
  const [data, setData] = useState(null);
  const load = (fresh) => {
    setData(null);
    apiClient.get('/storage', { params: fresh ? { fresh: 1 } : {} }).then(({ data: res }) => setData(res.data)).catch((err) => { setData(false); pushError(apiErrorMessage(err, 'Could not read the storage figures'), 'Load failed'); });
  };
  useEffect(() => { load(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card" data-testid="storage-card">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><HardDrive className="h-5 w-5" aria-hidden="true" /></span>
          <div>
            <h3 className="font-heading text-base font-semibold text-tertiary-900">Storage</h3>
            <p className="text-xs text-tertiary-500">The server disk, the files people uploaded and the database. A deploy needs free space to build.</p>
          </div>
        </div>
        <button type="button" className="btn-secondary text-xs" onClick={() => load(true)}>Refresh</button>
      </div>
      {data === null && <Skeleton className="h-32" />}
      {data === false && <p className="text-sm text-tertiary-500">The storage figures could not be read.</p>}
      {data && (
        <div className="space-y-4 text-sm">
          {data.disk.available ? (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span>Disk: <b>{size(data.disk.used_bytes)}</b> used of {size(data.disk.total_bytes)} · <b>{size(data.disk.free_bytes)}</b> free ({data.disk.free_percent}%)</span>
                <Pill tone={LEVEL[data.disk.level][0]}>{LEVEL[data.disk.level][1]}</Pill>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-tertiary-100" role="progressbar" aria-valuenow={Math.round(100 - data.disk.free_percent)} aria-valuemin="0" aria-valuemax="100">
                <div className={`h-full ${data.disk.level === 'ok' ? 'bg-success-500' : data.disk.level === 'warning' ? 'bg-warning-500' : 'bg-danger-500'}`} style={{ width: `${Math.min(100, 100 - data.disk.free_percent)}%` }} />
              </div>
              {data.disk.level !== 'ok' && <p className="mt-1 text-xs text-warning-800">Free space is low. Old docker build cache, images and swap files are the usual cause; see docs/guides/DISK-STORAGE.md.</p>}
            </div>
          ) : <p className="text-xs text-tertiary-500">The disk size could not be read on this server.</p>}

          <div>
            <p className="mb-1 font-medium text-tertiary-900">Uploaded files: {size(data.uploads.total_bytes)} in {data.uploads.total_files} files</p>
            <table className="min-w-full"><thead><tr><th className={th}>Kind</th><th className={`${th} text-right`}>Files</th><th className={`${th} text-right`}>Size</th><th className={th}>Oldest</th></tr></thead>
              <tbody>{data.uploads.by_category.map((r) => <tr key={r.category} className="border-t border-tertiary-100"><td className="py-1">{r.category}</td><td className="py-1 text-right tabular-nums">{r.files}</td><td className="py-1 text-right tabular-nums">{size(r.bytes)}</td><td className="py-1">{r.oldest || '—'}</td></tr>)}</tbody>
            </table>
          </div>

          <div>
            <p className="mb-1 font-medium text-tertiary-900">Database: {size(data.database.total_bytes)}</p>
            <table className="min-w-full"><tbody>{data.database.largest_tables.slice(0, 5).map((t) => <tr key={t.name} className="border-t border-tertiary-100"><td className="py-1 font-mono text-xs">{t.name}</td><td className="py-1 text-right tabular-nums">{size(t.bytes)}</td></tr>)}</tbody></table>
          </div>
          <p className="text-[11px] text-tertiary-500">Checked {new Date(data.checked_at).toLocaleString()}. Backups are outside the app; they are pruned by scripts/backup-prune.sh.</p>
        </div>
      )}
    </section>
  );
}
