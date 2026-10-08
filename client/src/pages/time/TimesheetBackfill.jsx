import { useEffect, useState } from 'react';
import { Download, FileUp } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useOrgMembershipOptions, useProjectOptions } from '../../lib/lookups.js';
import Drawer from '../../components/ui/Drawer.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import { BOM, csvCell, localToday, normaliseDate, parseCsv } from '../attendance/AttendanceBackfill.jsx';
import { financeNote } from './AdminEntryDrawer.jsx';

const COLUMNS = ['employee', 'date', 'project', 'hours', 'overtime_hours', 'billable', 'notes'];
const inputClass = 'mt-1 w-full rounded-xl border px-3 py-2 text-sm';

function downloadTemplate() {
  const example = { employee: 'EMP001 or name@company.com', date: localToday(), project: 'P0001 or project name (blank = general time)', hours: '8', overtime_hours: '0', billable: 'yes', notes: '' };
  const body = [COLUMNS.join(','), COLUMNS.map((c) => csvCell(example[c])).join(',')].join('\r\n');
  const url = URL.createObjectURL(new Blob([`${BOM}${body}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'timesheet-upload-template.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function sheetRows(text) {
  const [header, ...body] = parseCsv(text.replace(new RegExp(`^${BOM}`), ''));
  if (!header) throw new Error('The file is empty');
  const index = Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase().replace(/[\s-]+/g, '_'), i]));
  const missing = ['employee', 'date', 'hours'].filter((c) => index[c] === undefined);
  if (missing.length) throw new Error(`Missing column(s): ${missing.join(', ')} — download the template to get the right layout`);
  const get = (r, c) => (index[c] === undefined ? '' : (r[index[c]] || '').trim());
  return body.map((r) => ({
    employee: get(r, 'employee'),
    date: normaliseDate(get(r, 'date')),
    project: get(r, 'project'),
    hours: get(r, 'hours'),
    overtime_hours: get(r, 'overtime_hours'),
    billable: get(r, 'billable'),
    notes: get(r, 'notes'),
  }));
}

/** Admin: log hours for any employee on a past date (goes in approved). */
export function AddTimesheetEntryDrawer({ open, onClose, onSaved }) {
  const { pushError, pushSuccess } = useAlerts();
  const members = useOrgMembershipOptions(open);
  const projects = useProjectOptions(open);
  const empty = { org_membership_id: '', date: '', account_id: '', hours: '', overtime_hours: '', billable: true, notes: '', reason: '' };
  const [fields, setFields] = useState(empty);
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setFields((current) => ({ ...current, [key]: value }));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) setFields(empty); }, [open]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await apiClient.post('/timesheets/entries/admin', {
        org_membership_id: fields.org_membership_id,
        date: fields.date,
        account_id: fields.account_id || null,
        hours: Number(fields.hours),
        overtime_hours: fields.account_id ? Number(fields.overtime_hours) || 0 : 0,
        billable: Boolean(fields.account_id) && fields.billable,
        notes: fields.notes.trim() || null,
        reason: fields.reason.trim(),
      });
      pushSuccess(`Timesheet entry added${financeNote(data.data?.flagged)}`);
      onSaved();
      onClose();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to add the entry'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  const ready = fields.org_membership_id && fields.date && Number(fields.hours) > 0 && fields.reason.trim().length >= 3;
  return (
    <Drawer open={open} title="Add timesheet entry" onClose={onClose} size="sm" tone="create" footer={(
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form="admin-timesheet-entry" className="btn-primary" disabled={saving || !ready}>{saving ? 'Saving…' : 'Add entry'}</button>
      </>
    )}>
      <form id="admin-timesheet-entry" onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-tertiary-600">Employee
          <div className="mt-1"><SearchableSelect value={fields.org_membership_id} onChange={(v) => set('org_membership_id', v)} options={members} placeholder="Select employee" required /></div>
        </label>
        <label className="block text-xs font-medium text-tertiary-600">Date
          <input required type="date" max={localToday()} value={fields.date} onChange={(e) => set('date', e.target.value)} className={inputClass} />
        </label>
        <label className="block text-xs font-medium text-tertiary-600">Project <span className="font-normal text-tertiary-400">(blank = general time)</span>
          <div className="mt-1"><SearchableSelect value={fields.account_id} onChange={(v) => set('account_id', v)} options={projects} placeholder="General (no project)" allowClear /></div>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">Hours
            <input required type="number" min="0.25" max="24" step="0.25" value={fields.hours} onChange={(e) => set('hours', e.target.value)} className={inputClass} />
          </label>
          <label className="block text-xs font-medium text-tertiary-600">Overtime hours
            <input type="number" min="0" max="24" step="0.25" disabled={!fields.account_id} value={fields.overtime_hours} onChange={(e) => set('overtime_hours', e.target.value)} className={inputClass} />
          </label>
        </div>
        {fields.account_id && (
          <label className="flex items-center gap-2 text-sm text-tertiary-700">
            <input type="checkbox" checked={fields.billable} onChange={(e) => set('billable', e.target.checked)} /> Billable to the client
          </label>
        )}
        <label className="block text-xs font-medium text-tertiary-600">Notes <span className="font-normal text-tertiary-400">(optional)</span>
          <input value={fields.notes} onChange={(e) => set('notes', e.target.value)} className={inputClass} />
        </label>
        <label className="block text-xs font-medium text-tertiary-600">Reason
          <input required value={fields.reason} onChange={(e) => set('reason', e.target.value)} placeholder="e.g. Missed entry — confirmed with the manager" className={inputClass} />
        </label>
        <p className="text-xs text-tertiary-500">The entry goes in approved, even for a locked week. If the month is locked, the change is flagged for review instead of altering locked figures.</p>
      </form>
    </Drawer>
  );
}

/** Admin: upload a CSV of past timesheet entries — checked first, then applied all-or-nothing. */
export function BulkTimesheetDrawer({ open, onClose, onApplied }) {
  const { pushError, pushInfo } = useAlerts();
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setRows(null); setFileName(''); setResult(null); setReason(''); }
  }, [open]);

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
      const { data } = await apiClient.post('/timesheets/entries/admin/import', { rows, reason: reason.trim(), dry_run: dryRun });
      setResult(data.data);
      if (data.data.applied) {
        pushInfo(`Timesheets imported — ${data.data.created} entries added${financeNote(data.data.flagged)}`);
        onApplied();
      }
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to import timesheets'), 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const checked = result && !result.applied;
  const canApply = checked && result.errors.length === 0 && result.created > 0;
  return (
    <Drawer open={open} title="Bulk upload timesheets" onClose={onClose} size="md" tone="create" footer={(
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Close</button>
        {canApply
          ? <button type="button" className="btn-primary" onClick={() => send(false)} disabled={busy}>{busy ? 'Importing…' : `Import ${result.created} entries`}</button>
          : <button type="button" className="btn-primary" onClick={() => send(true)} disabled={busy || !rows || reason.trim().length < 3 || result?.applied}>{busy ? 'Checking…' : 'Check file'}</button>}
      </>
    )}>
      <div className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-tertiary-900">1. Download the template</h3>
          <p className="text-xs text-tertiary-500">One row per employee, date and project. <b>employee</b> is the employee code or email, <b>date</b> is YYYY-MM-DD (today or earlier), <b>project</b> is the project code or name (leave blank for general time), <b>hours</b> and <b>overtime_hours</b> are numbers, <b>billable</b> is yes / no (defaults to yes for project time).</p>
          <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={downloadTemplate}>
            <Download className="h-4 w-4" /> Download CSV template
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
            <input value={reason} onChange={(e) => { setReason(e.target.value); setResult(null); }} placeholder="e.g. September timesheets kept offline" className={inputClass} />
          </label>
        </section>

        {result && (
          <section className="space-y-2 border-t border-tertiary-100 pt-4 text-sm">
            <p className="font-semibold text-tertiary-900">{result.applied ? 'Imported' : 'Check result'}</p>
            <p className="text-tertiary-600">{result.created} entries ready · {result.skipped} blank rows skipped</p>
            {result.errors.length > 0 && (
              <div className="rounded-xl border border-danger-200 bg-danger-50 p-3">
                <p className="mb-2 text-xs font-semibold text-danger-700">{result.errors.length} row(s) need fixing — nothing was imported. Fix them in the sheet and upload again.</p>
                <ul className="max-h-60 space-y-1 overflow-auto text-xs text-danger-700">
                  {result.errors.slice(0, 200).map((e) => <li key={`${e.row}-${e.message}`}>Row {e.row}{e.employee ? ` · ${e.employee}` : ''}{e.date ? ` · ${e.date}` : ''}: {e.message}</li>)}
                </ul>
              </div>
            )}
            {canApply && <p className="text-xs text-tertiary-500">Looks good. Click <b>Import</b> to save — entries go in approved. Locked months are flagged for review, not rewritten.</p>}
          </section>
        )}
      </div>
    </Drawer>
  );
}
