import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Toggle from '../../components/ui/Toggle.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';

export default function NotificationPreferencesPage() {
  const { pushSuccess, pushError } = useAlerts();
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState({}); // type -> { in_app }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    apiClient
      .get('/notifications/preferences')
      .then(({ data }) => {
        if (!alive) return;
        setRows(data.data || []);
        setDraft(Object.fromEntries((data.data || []).map((r) => [r.type, { in_app: r.in_app }])));
      })
      .catch((err) => alive && pushError(apiErrorMessage(err, 'Failed to load preferences')))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [pushError]);

  const dirty = useMemo(
    () => rows.some((r) => draft[r.type]?.in_app !== r.in_app),
    [rows, draft]
  );

  function toggle(type, next) {
    setDraft((d) => ({ ...d, [type]: { in_app: next } }));
  }

  async function save() {
    setSaving(true);
    try {
      const items = rows.map((r) => ({ type: r.type, in_app: draft[r.type]?.in_app ?? r.in_app, email: false }));
      const { data } = await apiClient.put('/notifications/preferences', { items });
      setRows(data.data || []);
      setDraft(Object.fromEntries((data.data || []).map((r) => [r.type, { in_app: r.in_app }])));
      pushSuccess('Notification preferences saved');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save preferences'));
    } finally {
      setSaving(false);
    }
  }

  async function resetDefaults() {
    setSaving(true);
    try {
      const { data } = await apiClient.delete('/notifications/preferences');
      setRows(data.data || []);
      setDraft(Object.fromEntries((data.data || []).map((r) => [r.type, { in_app: r.in_app }])));
      pushSuccess('Reset to role defaults');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to reset preferences'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-tertiary-500">
          Choose which lifecycle events reach your <Link to="/notifications" className="text-primary-700 hover:underline">in-app inbox</Link>.
        </p>
        <button type="button" className="btn-ghost text-xs" disabled={saving} onClick={resetDefaults}>
          Reset to defaults
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-tertiary-100 bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-tertiary-100 px-4 py-3">
          <span className="font-heading text-sm font-semibold text-tertiary-900">Event types</span>
          <div className="flex items-center gap-6 text-[11px] font-semibold uppercase tracking-wide text-tertiary-400">
            <span>In-app</span>
            <span className="flex items-center gap-1">
              Email <Badge value="soon" />
            </span>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-tertiary-100">
            {rows.map((r) => (
              <li key={r.type} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-tertiary-900">{r.label}</p>
                  <p className="text-xs text-tertiary-500">{r.description}</p>
                </div>
                <div className="flex items-center gap-6">
                  <Toggle
                    checked={draft[r.type]?.in_app ?? r.in_app}
                    onChange={(next) => toggle(r.type, next)}
                    label={`${r.label} in-app`}
                  />
                  <Toggle checked={false} disabled label={`${r.label} email (coming soon)`} />
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-tertiary-100 bg-tertiary-50 px-4 py-3">
          <button type="button" className="btn-primary text-sm" disabled={!dirty || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
