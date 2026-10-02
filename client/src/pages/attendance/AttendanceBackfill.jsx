import { useEffect, useState } from 'react';
import { Download, FileUp } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useDepartmentOptions, useOrgMembershipOptions } from '../../lib/lookups.js';
import Drawer from '../../components/ui/Drawer.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';

const STATUSES = ['present', 'absent', 'half_day', 'leave', 'holiday', 'wfh'];
const TEMPLATE_COLUMNS = ['employee', 'name', 'department', 'date', 'day', 'status', 'check_in', 'check_out'];

// Local calendar day (not UTC) — "today" as the admin sees it.
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, rows) {
  const body = [TEMPLATE_COLUMNS.join(','), ...rows.map((row) => TEMPLATE_COLUMNS.map((c) => csvCell(row[c])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([`${BOM}${body}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// Minimal RFC 4180 parser (quoted cells, escaped quotes, CRLF).
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// Excel re-saves dates as DD-MM-YYYY / DD/MM/YYYY and times as H:MM:SS — normalise both.
export function normaliseDate(value) {
  const v = value.trim();
  const dmy = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const ymd = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  return v;
}

function normaliseTime(value) {
  const v = value.trim();
  const m = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?$/i);
  if (!m) return v;
  let h = Number(m[1]);
  if (m[3]) h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function sheetRows(text) {
  const [header, ...body] = parseCsv(text.replace(new RegExp(`^${BOM}`), ''));
  if (!header) throw new Error('The file is empty');
  const index = Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase().replace(/[\s-]+/g, '_'), i]));
  const missing = ['employee', 'date', 'status'].filter((c) => index[c] === undefined);
  if (missing.length) throw new Error(`Missing column(s): ${missing.join(', ')} — download the template to get the right layout`);
  const get = (r, c) => (index[c] === undefined ? '' : (r[index[c]] || '').trim());
  return body.map((r) => ({
    employee: get(r, 'employee'),
    date: normaliseDate(get(r, 'date')),
    status: get(r, 'status'),
    check_in: normaliseTime(get(r, 'check_in')),
    check_out: normaliseTime(get(r, 'check_out')),
  }));
}

// Byte-order mark: makes Excel open the CSV as UTF-8.
export const BOM = String.fromCharCode(0xfeff);

const inputClass = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm';

/** One employee, one past day — creates the record if none exists. */
export function ManualAttendanceDrawer({ open, onClose, onSaved }) {
  const { pushError } = useAlerts();
  const members = useOrgMembershipOptions(open);
  const empty = { org_membership_id: '', date: '', status: 'present', reason: '' };
  const [fields, setFields] = useState(empty);
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setFields((current) => ({ ...current, [key]: value }));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) setFields(empty); }, [open]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post('/attendance/manual', {
        org_membership_id: fields.org_membership_id,
        date: fields.date,
        status: fields.status,
        reason: fields.reason.trim(),
      });
      onSaved();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to record attendance'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  const ready = fields.org_membership_id && fields.date && fields.reason.trim();
  return (
    <Drawer open={open} title="Add past attendance" onClose={onClose} size="sm" tone="create" footer={(
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form="manual-attendance" className="btn-primary" disabled={saving || !ready}>{saving ? 'Saving…' : 'Save attendance'}</button>
      </>
    )}>
      <form id="manual-attendance" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-tertiary-600">Employee
          <div className="mt-1"><SearchableSelect value={fields.org_membership_id} onChange={(v) => set('org_membership_id', v)} options={members} placeholder="Select employee" required /></div>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">Date
            <input required type="date" max={localToday()} value={fields.date} onChange={(e) => set('date', e.target.value)} className={inputClass} />
          </label>
          <label className="block text-xs font-medium text-tertiary-600">Status
            <select value={fields.status} onChange={(e) => set('status', e.target.value)} className={inputClass}>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-xs font-medium text-tertiary-600">Reason
          <input required value={fields.reason} onChange={(e) => set('reason', e.target.value)} placeholder="e.g. Backfill — attendance kept on paper in September" className={inputClass} />
        </label>
        <p className="text-xs text-tertiary-500">Replaces anything already recorded for that day. If the month is locked, the change is flagged for review instead of altering locked salary.</p>
      </form>
    </Drawer>
  );
}

/**
 * Admin / IT: mark every applicable employee present on each working day of a PREVIOUS month
 * (one-time backfill, never the current or a future month). Preview first, then apply; audited.
 */
export function BackfillMonthDrawer({ open, onClose, onApplied }) {
  const { pushError, pushInfo } = useAlerts();
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [month, setMonth] = useState(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState([]);
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setReason('');
    apiClient.get('/attendance/backfill-month/runs').then(({ data }) => setRuns(data.data || [])).catch(() => setRuns([]));
  }, [open]);

  async function run(dryRun) {
    const [year, mon] = month.split('-').map(Number);
    setBusy(true);
    try {
      const { data } = await apiClient.post('/attendance/backfill-month', { year, month: mon, reason: reason.trim(), dry_run: dryRun });
      if (dryRun) setPreview(data.data);
      else {
        pushInfo(`Marked present: ${data.data.records} day${data.data.records === 1 ? '' : 's'} for ${data.data.employees_affected} employee${data.data.employees_affected === 1 ? '' : 's'}`);
        onApplied?.();
        onClose();
      }
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to backfill the month'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const ready = month && month < thisMonth && reason.trim().length >= 3;
  return (
    <Drawer open={open} title="Backfill previous month" onClose={onClose} size="md" tone="create" footer={(
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Close</button>
        <button type="button" className="btn-secondary" onClick={() => run(true)} disabled={busy || !ready}>Preview</button>
        <button type="button" className="btn-primary" onClick={() => run(false)} disabled={busy || !ready || !preview}>{busy ? 'Working…' : 'Mark present'}</button>
      </>
    )}>
      <div className="space-y-3">
        <p className="rounded-xl bg-primary-50 px-3 py-2 text-xs text-primary-800">
          Marks IT / attendance-paid employees <b>present</b> on every working day of the chosen month. Weekends, company holidays, approved leave and days that already have a record are skipped. Only past months can be backfilled - never the current or a future month.
        </p>
        <label className="block text-xs font-medium text-tertiary-600">Month
          <input type="month" max={thisMonth} value={month} onChange={(e) => { setMonth(e.target.value); setPreview(null); }} className={inputClass} />
        </label>
        {month >= thisMonth && <p className="text-xs text-danger-600">Pick a month before {thisMonth}.</p>}
        <label className="block text-xs font-medium text-tertiary-600">Reason
          <input value={reason} onChange={(e) => { setReason(e.target.value); setPreview(null); }} placeholder="e.g. September attendance for IT" className={inputClass} />
        </label>
        {preview && (
          <div className="rounded-xl border border-tertiary-100 p-3 text-sm text-tertiary-700">
            <p><b>{preview.records}</b> day{preview.records === 1 ? '' : 's'} would be marked present for <b>{preview.employees_affected}</b> of {preview.employees_considered} employees.</p>
            <p className="mt-1 text-xs text-tertiary-500">Skipped: {Object.keys(preview.skipped).length ? Object.entries(preview.skipped).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ') : 'none'}</p>
          </div>
        )}
        {runs.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-tertiary-500">Previous runs</h4>
            <ul className="mt-1 divide-y divide-tertiary-100 text-xs text-tertiary-600">
              {runs.map((r) => (
                <li key={r.id} className="py-1.5">{new Date(r.created_at).toLocaleString()} · {r.year}-{String(r.month).padStart(2, '0')} · {r.records} records · {r.employees_affected} employees · {r.reason}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Drawer>
  );
}

/** Download a prefilled sheet for a department/month, fill it, upload it back. */
export function BulkAttendanceDrawer({ open, onClose, onApplied }) {
  const { pushError, pushInfo } = useAlerts();
  const departments = useDepartmentOptions(open);
  const [departmentId, setDepartmentId] = useState('');
  const [month, setMonth] = useState(() => localToday().slice(0, 7));
  const [downloading, setDownloading] = useState(false);
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setRows(null); setFileName(''); setResult(null); setReason(''); }
  }, [open]);

  async function downloadTemplate() {
    setDownloading(true);
    try {
      const { data } = await apiClient.get('/attendance/import-template', { params: { ...monthRange(month), ...(departmentId ? { department_id: departmentId } : {}) } });
      const list = data.data || [];
      if (!list.length) { pushInfo('No employees or days to include for that selection'); return; }
      const dept = departments.find((d) => d.value === departmentId)?.label || 'all';
      downloadCsv(`attendance-${dept.toLowerCase().replace(/\W+/g, '-')}-${month}.csv`, list);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to build the template'), 'Something went wrong');
    } finally {
      setDownloading(false);
    }
  }

  async function pickFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setResult(null);
    try {
      const parsed = sheetRows(await file.text());
      if (!parsed.length) throw new Error('The file has no data rows');
      setRows(parsed);
      setFileName(file.name);
    } catch (err) {
      setRows(null);
      pushError(err.message, 'Could not read the file');
    }
  }

  async function send(dryRun) {
    setBusy(true);
    try {
      const { data } = await apiClient.post('/attendance/import', { rows, reason: reason.trim(), dry_run: dryRun });
      setResult(data.data);
      if (data.data.applied) {
        pushInfo(`Attendance imported — ${data.data.created} added, ${data.data.updated} updated`);
        onApplied();
      }
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to import attendance'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const checked = result && !result.applied;
  const canApply = checked && result.errors.length === 0 && result.created + result.updated > 0;
  return (
    <Drawer open={open} title="Bulk upload attendance" onClose={onClose} size="md" tone="create" footer={(
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Close</button>
        {canApply
          ? <button type="button" className="btn-primary" onClick={() => send(false)} disabled={busy}>{busy ? 'Importing…' : `Import ${result.created + result.updated} days`}</button>
          : <button type="button" className="btn-primary" onClick={() => send(true)} disabled={busy || !rows || !reason.trim() || result?.applied}>{busy ? 'Checking…' : 'Check file'}</button>}
      </>
    )}>
      <div className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-tertiary-900">1. Download the sheet</h3>
          <p className="text-xs text-tertiary-500">One row per employee per day up to today, with what&apos;s already recorded filled in (approved leave shows as <b>leave</b>). Fill the <b>status</b> column — present, absent, half_day, leave, holiday or wfh — Rows left blank are skipped.</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-tertiary-600">Department
              <div className="mt-1"><SearchableSelect value={departmentId} onChange={setDepartmentId} options={departments} placeholder="All departments" allowClear /></div>
            </label>
            <label className="block text-xs font-medium text-tertiary-600">Month
              <input type="month" max={localToday().slice(0, 7)} value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass} />
            </label>
          </div>
          <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={downloadTemplate} disabled={downloading || !month}>
            <Download className="h-4 w-4" /> {downloading ? 'Preparing…' : 'Download CSV template'}
          </button>
        </section>

        <section className="space-y-3 border-t border-tertiary-100 pt-4">
          <h3 className="text-sm font-semibold text-tertiary-900">2. Upload it back</h3>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-tertiary-300 px-3 py-3 text-sm text-tertiary-600 hover:bg-tertiary-50">
            <FileUp className="h-4 w-4" />
            {fileName ? `${fileName} · ${rows?.length || 0} rows` : 'Choose a CSV file (in Excel: Save As → CSV)'}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={pickFile} />
          </label>
          <label className="block text-xs font-medium text-tertiary-600">Reason
            <input value={reason} onChange={(e) => { setReason(e.target.value); setResult(null); }} placeholder="e.g. September attendance — HR & Sales backfill" className={inputClass} />
          </label>
        </section>

        {result && (
          <section className="space-y-2 border-t border-tertiary-100 pt-4 text-sm">
            <p className="font-semibold text-tertiary-900">{result.applied ? 'Imported' : 'Check result'}</p>
            <p className="text-tertiary-600">
              {result.created} new · {result.updated} changed · {result.unchanged} already correct · {result.skipped} blank rows skipped
            </p>
            {result.errors.length > 0 && (
              <div className="rounded-xl border border-danger-200 bg-danger-50 p-3">
                <p className="mb-2 text-xs font-semibold text-danger-700">{result.errors.length} row(s) need fixing — nothing was imported. Fix them in the sheet and upload again.</p>
                <ul className="max-h-60 space-y-1 overflow-auto text-xs text-danger-700">
                  {result.errors.slice(0, 200).map((e) => <li key={`${e.row}-${e.message}`}>Row {e.row}{e.employee ? ` · ${e.employee}` : ''}{e.date ? ` · ${e.date}` : ''}: {e.message}</li>)}
                </ul>
              </div>
            )}
            {checked && !result.errors.length && result.created + result.updated === 0 && <p className="text-xs text-tertiary-500">Nothing to change — the sheet matches what&apos;s recorded.</p>}
            {canApply && <p className="text-xs text-tertiary-500">Looks good. Click <b>Import</b> to save. Locked months are flagged for review, not rewritten.</p>}
          </section>
        )}
      </div>
    </Drawer>
  );
}
