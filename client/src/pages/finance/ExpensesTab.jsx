import { useEffect, useMemo, useState } from 'react';
import { Paperclip, Pencil, Plus, Receipt, Trash2, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useFinanceCategories, useLocationOptions, useOrgMembershipOptions } from '../../lib/lookups.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import FilesPanel from '../../components/FilesPanel.jsx';
import { chargeColumns, chargeQuery } from './GroupChargesTab.jsx';

const CURRENCIES = ['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP'];

const todayIso = () => new Date().toISOString().slice(0, 10);

// The "Other" category — not an admin-managed category; needs a description.
const OTHER = '__other';
const STAGE_LABEL = { manager: 'Manager', hr: 'HR', finance: 'Finance' };

// Status, plus the step a pending claim is waiting on (Manager → HR → Finance).
function ClaimStatus({ row }) {
  return (
    <span className="inline-flex flex-col gap-0.5">
      <Badge value={row.status} />
      {row.status === 'pending' && row.approval_stage && <span className="text-[11px] text-tertiary-500">Awaiting {STAGE_LABEL[row.approval_stage]}</span>}
    </span>
  );
}

// Submit (no `claim`) and edit (`claim` set) share the form. Editing is only offered
// while the claim is pending. A new claim takes its receipts first (they upload
// right after it is saved); an existing one manages them in the Receipts panel.
// The category comes from the admin-managed Expense categories (Finance → Categories),
// or "Other" with a description. An admin can submit for any employee.
function ClaimDrawer({ open, claim, locations, categories, members = null, onClose, onSubmit }) {
  const isEditing = Boolean(claim);
  const [fields, setFields] = useState({ org_membership_id: '', location_id: '', category_id: '', expense_date: todayIso(), amount: '', currency: 'INR', description: '' });
  const [receipts, setReceipts] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReceipts([]);
    // An older claim may carry only a free-text category: match it by name.
    const byName = (name) => (String(name || '').toLowerCase() === 'other' ? OTHER : categories.find((c) => c.name.toLowerCase() === String(name || '').toLowerCase())?.id || '');
    setFields(claim
      ? {
        org_membership_id: '',
        location_id: claim.location_id,
        category_id: claim.category_id || byName(claim.category),
        expense_date: claim.expense_date ? String(claim.expense_date).slice(0, 10) : '',
        amount: String(Number(claim.amount)),
        currency: claim.currency,
        description: claim.description || '',
      }
      : { org_membership_id: '', location_id: locations[0]?.id || '', category_id: '', expense_date: todayIso(), amount: '', currency: 'INR', description: '' });
  }, [open, claim, locations, categories]);

  function set(key, value) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  const isOther = fields.category_id === OTHER;

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const { org_membership_id, category_id, description, ...rest } = fields;
      const payload = {
        ...rest,
        ...(isOther ? { category: 'Other' } : { category_id }),
        description: description.trim() || null,
        expense_date: fields.expense_date || undefined,
        amount: Number(fields.amount),
        ...(!isEditing && org_membership_id ? { org_membership_id } : {}),
      };
      await onSubmit(payload, receipts);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const ready = fields.location_id && fields.category_id && fields.amount && (!isOther || fields.description.trim());
  return (
    <Drawer open={open} title={isEditing ? 'Edit expense claim' : 'Submit expense claim'} onClose={onClose} size={isEditing ? 'md' : 'sm'} tone={isEditing ? 'edit' : 'create'} footer={
      <>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" form="expense-claim-form" className="btn-primary" disabled={saving || !ready}>
          {saving ? (isEditing ? 'Saving…' : 'Submitting…') : isEditing ? 'Save changes' : 'Submit claim'}
        </button>
      </>
    }>
      {!isEditing && (
        <div className="mb-4 space-y-2">
          <p className="text-xs font-medium text-tertiary-600">Receipts</p>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-tertiary-300 px-3 py-3 text-sm text-tertiary-600 hover:bg-tertiary-50">
            <Paperclip className="h-4 w-4" /> Add receipt (image or PDF)
            <input type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => { const picked = [...(e.target.files || [])]; e.target.value = ''; setReceipts((r) => [...r, ...picked]); }} />
          </label>
          {receipts.length > 0 && (
            <ul className="space-y-1 text-xs text-tertiary-700">
              {receipts.map((file, i) => (
                <li key={`${file.name}-${i}`} className="flex items-center justify-between rounded-lg bg-tertiary-50 px-2 py-1">
                  <span className="truncate">{file.name}</span>
                  <button type="button" className="btn-ghost p-0.5" aria-label={`Remove ${file.name}`} onClick={() => setReceipts((r) => r.filter((_, k) => k !== i))}><X className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <form id="expense-claim-form" onSubmit={submit} className="space-y-3">
        {!isEditing && members && (
          <label className="block text-xs font-medium text-tertiary-600">
            Employee <span className="font-normal text-tertiary-400">(leave blank for yourself)</span>
            <div className="mt-1"><SearchableSelect value={fields.org_membership_id} onChange={(v) => set('org_membership_id', v)} options={members} placeholder="Myself" allowClear /></div>
          </label>
        )}
        <label className="block text-xs font-medium text-tertiary-600">
          Office location
          <select required value={fields.location_id} onChange={(e) => set('location_id', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
            <option value="" disabled>Select location</option>
            {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-tertiary-600">
          Category
          <select required value={fields.category_id} onChange={(e) => set('category_id', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
            <option value="" disabled>Select category</option>
            {categories.filter((c) => (c.is_active || c.id === fields.category_id) && c.name.toLowerCase() !== 'other').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={OTHER}>Other</option>
          </select>
        </label>
        <label className="block text-xs font-medium text-tertiary-600">
          Description {isOther ? <span className="font-normal text-danger-600">(required for Other)</span> : <span className="font-normal text-tertiary-400">(optional)</span>}
          <textarea required={isOther} rows={2} value={fields.description} onChange={(e) => set('description', e.target.value)} placeholder="What was this expense for?" className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
        </label>
        <label className="block text-xs font-medium text-tertiary-600">
          Expense date
          <input type="date" max={todayIso()} value={fields.expense_date} onChange={(e) => set('expense_date', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-tertiary-600">
            Amount
            <input required type="number" min="0" step="0.01" value={fields.amount} onChange={(e) => set('amount', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs font-medium text-tertiary-600">
            Currency
            <select value={fields.currency} onChange={(e) => set('currency', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
      </form>
      {isEditing && (
        <div className="mt-5">
          <FilesPanel entityType="expense_claim" entityId={claim.id} title="Receipts" defaultLabel="Receipt" multiple />
        </div>
      )}
    </Drawer>
  );
}

const EMPTY_FILTERS = { org_membership_id: '', month: '', category_id: '', location_id: '' };

const VIEW_LABEL = { mine: 'My claims', approvals: 'Approvals', team: 'Reimbursements', group: 'Group expenses' };

/**
 * Finance → Expenses. Everyone: their own claims. Admins also get
 * Reimbursements (every employee's claims, to approve / reimburse) and Group
 * Expenses (the company's group charges). Filters at the top — Employee,
 * Month, Category, Office — combine.
 */
export default function ExpensesTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // A superadmin may correct or remove a claim in any status (approved, reimbursed…).
  const isSuperadmin = Boolean(user?.is_superadmin);
  const { pushError, pushInfo } = useAlerts();
  const [view, setView] = useState('mine');
  const [rows, setRows] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  // Managers, HR and Finance see the claims waiting on their step.
  const [approvalCount, setApprovalCount] = useState(0);
  const expenseCategories = useFinanceCategories('expense', { includeInactive: true });
  const chargeCategories = useFinanceCategories('group_charge', { includeInactive: true, enabled: isAdmin });
  const locationOptions = useLocationOptions(true);
  const memberOptions = useOrgMembershipOptions(isAdmin);
  const categories = view === 'group' ? chargeCategories : expenseCategories;
  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  const params = useMemo(() => {
    const base = chargeQuery({ month: filters.month, date: '', category_id: filters.category_id, location_id: filters.location_id });
    if (view === 'team' && filters.org_membership_id) base.org_membership_id = filters.org_membership_id;
    return base;
  }, [filters, view]);

  async function load() {
    setLoading(true);
    try {
      if (view === 'group') {
        const { data } = await apiClient.get('/billing/group-charges', { params });
        setRows(data.data || []);
      } else if (view === 'approvals') {
        const { data } = await apiClient.get('/expenses/claims/approvals');
        setRows(data.data || []);
        setApprovalCount((data.data || []).length);
      } else {
        const endpoint = view === 'team' ? '/expenses/claims' : '/expenses/claims/me';
        const { data } = await apiClient.get(endpoint, { params: { limit: 100, ...params } });
        setRows(data.data || []);
      }
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to load expenses'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [view, JSON.stringify(params)]); // eslint-disable-line react-hooks/exhaustive-deps
  // Group charges and claims use different category lists.
  useEffect(() => { setFilters((f) => ({ ...f, category_id: '' })); }, [view]);
  useEffect(() => {
    apiClient.get('/orgs/locations').then(({ data }) => setLocations(data.data || [])).catch(() => setLocations([]));
    apiClient.get('/expenses/claims/approvals').then(({ data }) => setApprovalCount((data.data || []).length)).catch(() => setApprovalCount(0));
  }, []);

  async function createClaim(payload, receipts = []) {
    let claim;
    try {
      const { data } = await apiClient.post('/expenses/claims', payload);
      claim = data.data;
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to submit claim'), 'Something went wrong');
      throw err;
    }
    // Receipts picked on the form upload to the new claim.
    let failed = 0;
    for (const file of receipts) {
      const body = new FormData();
      body.append('entity_type', 'expense_claim');
      body.append('entity_id', claim.id);
      body.append('label', 'Receipt');
      body.append('file', file);
      try { await apiClient.post('/documents', body); } catch { failed += 1; }
    }
    load();
    if (failed) {
      pushError(`${failed} receipt${failed === 1 ? '' : 's'} could not be uploaded — add ${failed === 1 ? 'it' : 'them'} from Edit.`, 'Claim submitted');
      setEditing(claim);
    } else {
      pushInfo(receipts.length ? `Expense claim submitted with ${receipts.length} receipt${receipts.length === 1 ? '' : 's'}` : 'Expense claim submitted');
    }
  }

  async function updateClaim(payload) {
    try {
      await apiClient.patch(`/expenses/claims/${editing.id}`, payload);
      pushInfo('Expense claim updated');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to update the claim'), 'Something went wrong');
      throw err;
    }
  }

  async function removeClaim(row) {
    if (!window.confirm(`Delete this ${row.currency} ${Number(row.amount).toLocaleString()} ${row.category_ref?.name || row.category || ''} claim? This can't be undone.`)) return;
    try {
      await apiClient.delete(`/expenses/claims/${row.id}`);
      pushInfo('Expense claim deleted');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to delete the claim'), 'Something went wrong');
    }
  }

  async function decide(row, status) {
    try {
      const { data } = await apiClient.post(`/expenses/claims/${row.id}/decision`, { status });
      const next = data.data?.status === 'pending' && data.data?.approval_stage;
      pushInfo(next ? `Approved — sent on to ${STAGE_LABEL[next]}` : `Claim ${status}`);
      load();
      apiClient.get('/expenses/claims/approvals').then(({ data: q }) => setApprovalCount((q.data || []).length)).catch(() => {});
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to record decision'), 'Something went wrong');
    }
  }

  // Multi approve / reject: tick claims (or all), then decide them together —
  // one decision each, so every claim still goes through its own step check.
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  useEffect(() => { setSelectedIds([]); }, [view, rows]);
  const canDecide = view === 'approvals' || (isAdmin && view === 'team');
  async function decideSelected(status, ids = selectedIds) {
    const pending = rows.filter((row) => ids.includes(row.id) && row.status === 'pending');
    if (!pending.length) { pushInfo('None of the selected claims are pending'); return; }
    let reason;
    if (status === 'rejected') {
      reason = window.prompt(`Reject ${pending.length} claim${pending.length === 1 ? '' : 's'}? Give a reason (shown to the employee):`);
      if (reason === null) return;
    } else if (!window.confirm(`Approve ${pending.length} claim${pending.length === 1 ? '' : 's'}?`)) return;
    setBulkBusy(true);
    let failed = 0;
    for (const row of pending) {
      try { await apiClient.post(`/expenses/claims/${row.id}/decision`, { status, reason: reason?.trim() || undefined }); } catch { failed += 1; }
    }
    setBulkBusy(false);
    const verb = status === 'approved' ? 'approved' : 'rejected';
    if (failed) pushError(`${pending.length - failed} ${verb}; ${failed} could not be ${verb} (not your step, or already decided).`, 'Some claims were skipped');
    else pushInfo(`${pending.length} claim${pending.length === 1 ? '' : 's'} ${verb}`);
    setSelectedIds([]);
    load();
    apiClient.get('/expenses/claims/approvals').then(({ data: q }) => setApprovalCount((q.data || []).length)).catch(() => {});
  }

  async function reimburse(row) {
    try {
      await apiClient.post(`/expenses/claims/${row.id}/reimburse`);
      pushInfo('Marked reimbursed');
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to mark reimbursed'), 'Something went wrong');
    }
  }

  const columns = [
    { key: 'date', header: 'Expense date', render: (row) => (row.expense_date ? new Date(row.expense_date).toLocaleDateString(undefined, { timeZone: 'UTC' }) : <span title="Submission date (no expense date recorded)">{new Date(row.created_at).toLocaleDateString()}</span>) },
    ...(view === 'team' || view === 'approvals' ? [{ key: 'person', header: 'Employee', render: (row) => row.org_membership?.person?.name || '—' }] : []),
    { key: 'location', header: 'Office', render: (row) => row.location?.name || '—' },
    {
      key: 'category',
      header: 'Category',
      render: (row) => (
        <span>
          {row.category_ref?.name || row.category}
          {row.description && <span className="block max-w-[16rem] truncate text-xs text-tertiary-500" title={row.description}>{row.description}</span>}
          {row.submitter && <span className="block text-[11px] text-tertiary-400">Filed by {row.submitter.name}</span>}
        </span>
      ),
    },
    { key: 'amount', header: 'Amount', render: (row) => `${row.currency} ${Number(row.amount).toLocaleString()}` },
    { key: 'status', header: 'Status', render: (row) => <ClaimStatus row={row} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div className="flex gap-2">
          {/* A pending claim can be edited by its owner (My claims) or by an admin; any claim by a superadmin. */}
          {((row.status === 'pending' && (view === 'mine' || isAdmin)) || isSuperadmin) && (
            <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs" onClick={() => setEditing(row)}><Pencil className="h-3.5 w-3.5" /> Edit</button>
          )}
          {/* Raised by mistake: its owner or an admin may delete it while pending; a superadmin any time. */}
          {(isSuperadmin || (row.status === 'pending' && (view === 'mine' || (isAdmin && view === 'team')))) && (
            <button type="button" className="btn-ghost inline-flex items-center gap-1 text-xs text-danger-600" onClick={() => removeClaim(row)}><Trash2 className="h-3.5 w-3.5" /> Delete</button>
          )}
          {((isAdmin && view === 'team') || view === 'approvals') && row.status === 'pending' && (
            <>
              <button type="button" className="btn-ghost text-xs" onClick={() => decide(row, 'approved')}>Approve</button>
              <button type="button" className="btn-ghost text-xs text-danger-600" onClick={() => decide(row, 'rejected')}>Reject</button>
            </>
          )}
          {isAdmin && row.status === 'approved' && <button type="button" className="btn-ghost text-xs" onClick={() => reimburse(row)}>Mark reimbursed</button>}
        </div>
      ),
    },
  ];

  const filtered = Object.values(filters).some(Boolean);
  const total = useMemo(() => {
    const byCurrency = new Map();
    for (const row of rows) byCurrency.set(row.currency, (byCurrency.get(row.currency) || 0) + Number(row.amount));
    return [...byCurrency].map(([c, n]) => `${c} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`).join(' · ');
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 border-b border-tertiary-200">
          {['mine', ...(isAdmin || approvalCount > 0 ? ['approvals'] : []), ...(isAdmin ? ['team', 'group'] : [])].map((key) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} className={`border-b-2 px-3 py-2 text-sm font-medium ${view === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500'}`} onClick={() => setView(key)}>
              {VIEW_LABEL[key]}
              {key === 'approvals' && approvalCount > 0 && <span className="ml-1.5 rounded-full bg-primary-100 px-1.5 text-[11px] font-semibold text-primary-700">{approvalCount}</span>}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
        {canDecide && rows.filter((row) => row.status === 'pending').length > 1 && (
          <button type="button" className="btn-secondary inline-flex items-center gap-2" disabled={bulkBusy} onClick={() => decideSelected('approved', rows.map((r) => r.id))}>
            {bulkBusy ? 'Working…' : `Approve all pending (${rows.filter((row) => row.status === 'pending').length})`}
          </button>
        )}
        {view !== 'group' && (
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setDrawerOpen(true)}>
            <Plus className="h-4 w-4" /> Submit claim
          </button>
        )}
        </div>
      </div>

      <div className="grid gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">
        {view === 'team' && (
          <label className="block text-xs font-medium text-tertiary-600">Employee<div className="mt-1"><SearchableSelect value={filters.org_membership_id} onChange={(v) => setFilter('org_membership_id', v)} options={memberOptions} placeholder="All employees" allowClear /></div></label>
        )}
        <label className="block text-xs font-medium text-tertiary-600">Month<input type="month" value={filters.month} onChange={(e) => setFilter('month', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-1.5 text-sm" /></label>
        <label className="block text-xs font-medium text-tertiary-600">Category
          <select value={filters.category_id} onChange={(e) => setFilter('category_id', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-1.5 text-sm">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_active ? '' : ' (inactive)'}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-tertiary-600">Office
          <select value={filters.location_id} onChange={(e) => setFilter('location_id', e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-1.5 text-sm">
            <option value="">All offices</option>
            {locationOptions.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </label>
        <div className="flex items-end justify-between gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={() => setFilters(EMPTY_FILTERS)} disabled={!filtered}>Clear filters</button>
          {!loading && rows.length > 0 && <span className="pb-1 text-xs font-medium text-tertiary-700">Total {total}</span>}
        </div>
      </div>

      {view === 'group' ? (
        <DataTable columns={chargeColumns} rows={rows} loading={loading} emptyLabel="No group expenses match these filters. Add them under Finance → Group Charges." />
      ) : !loading && rows.length === 0 && !filtered ? (
        <EmptyState icon={Receipt} title="No expense claims yet" description="Submit a claim for reimbursement." action={<button type="button" className="btn-secondary" onClick={() => setDrawerOpen(true)}>Submit claim</button>} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          emptyLabel="No claims match these filters."
          selectable={canDecide}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          actions={[
            { key: 'approve', label: bulkBusy ? 'Working…' : 'Approve selected', onClick: () => decideSelected('approved') },
            { key: 'reject', label: 'Reject selected', danger: true, onClick: () => decideSelected('rejected') },
          ]}
        />
      )}
      <ClaimDrawer open={drawerOpen} locations={locations} categories={expenseCategories} members={isAdmin ? memberOptions : null} onClose={() => setDrawerOpen(false)} onSubmit={createClaim} />
      <ClaimDrawer open={Boolean(editing)} claim={editing} locations={locations} categories={expenseCategories} onClose={() => setEditing(null)} onSubmit={updateClaim} />
    </div>
  );
}
