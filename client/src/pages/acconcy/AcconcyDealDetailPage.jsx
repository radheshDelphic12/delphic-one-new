import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { acconcyApi, acconcyError } from '../../lib/acconcy/api.js';
import { useAcconcy, axCan } from '../../lib/acconcy/useAcconcy.js';
import { DEAL_STATUSES, DEAL_STATUS_META, INVESTMENT_TYPE_META, SERVICE_META, TASK_STATUS_META, pctLabel, serviceLabel } from '../../lib/acconcy/meta.js';
import { usePickers } from '../../lib/acconcy/pickers.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Pill from '../../components/ui/Pill.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import DealForm from '../../components/acconcy/DealForm.jsx';
import EntryForm from '../../components/acconcy/EntryForm.jsx';
import AcconcyDocuments from '../../components/acconcy/AcconcyDocuments.jsx';
import { DateInput, Detail, Empty, Kpi, Money, Select, Text, card, today, withReason } from '../../components/acconcy/ui.jsx';
import { dateLabel } from '../../lib/format.js';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'money', label: 'Revenue & expenses' },
  { key: 'investments', label: 'Investments' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'documents', label: 'Documents' },
];

function DealTasks({ deal, canTasks, pickers, reload }) {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState(null);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const load = useCallback(() => acconcyApi.tasks({ deal_id: deal.id }).then(setRows, () => setRows([])), [deal.id]);
  useEffect(() => { load(); }, [load]);
  async function add(e) {
    e.preventDefault();
    try {
      await acconcyApi.createTask({ title: title.trim(), deal_id: deal.id, party_id: deal.party_id, ...(assignee ? { assignee_id: assignee } : {}), ...(due ? { due_date: due } : {}) });
      setTitle(''); setDue(''); setAssignee('');
      load(); reload();
    } catch (err) {
      pushError(acconcyError(err, 'Could not add'), 'Could not add');
    }
  }
  async function status(t, s) {
    try { await acconcyApi.updateTask(t.id, { status: s }); load(); reload(); } catch (err) { pushError(acconcyError(err), 'Could not update'); }
  }
  return (
    <div className="space-y-3">
      {canTasks && (
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_12rem_9rem_auto] sm:items-end">
          <Text label="New task" value={title} onChange={setTitle} placeholder="Prepare due diligence checklist" required maxLength={200} />
          <Select label="Assign to" value={assignee} onChange={setAssignee} options={pickers.employees} blank="Unassigned" />
          <DateInput label="Due" value={due} onChange={setDue} />
          <button type="submit" className="btn-primary" disabled={!title.trim()}>Add</button>
        </form>
      )}
      {rows === null ? <div className="text-sm text-tertiary-500">Loading...</div> : rows.length === 0 ? <Empty>No tasks for this deal yet.</Empty> : (
        <ul className="divide-y rounded-xl border bg-white text-sm">
          {rows.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0"><span className="font-medium text-tertiary-900">{t.title}</span><span className="block text-xs text-tertiary-500">{t.code} · {t.assignee?.name || t.contractor?.name || 'Unassigned'}{t.due_date ? ` · due ${dateLabel(t.due_date)}` : ''}{t.overdue ? ' · overdue' : ''}</span></span>
              <span className="flex items-center gap-2"><Pill tone={TASK_STATUS_META[t.status]?.tone}>{TASK_STATUS_META[t.status]?.label}</Pill>{canTasks && t.status !== 'done' && <button type="button" className="text-xs font-medium text-primary-700 hover:underline" onClick={() => status(t, 'done')}>Mark done</button>}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AcconcyDealDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { me, loading } = useAcconcy();
  const { pushError, pushSuccess } = useAlerts();
  const pickers = usePickers();
  const [deal, setDeal] = useState(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState('overview');
  const [modal, setModal] = useState(null); // { kind: 'edit' | 'entry', row?, type? }
  const [categories, setCategories] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => acconcyApi.deal(id).then((d) => { setDeal(d); setError(false); }, () => setError(true)), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (me && axCan(me, 'ledger')) acconcyApi.categories().then((c) => setCategories(c.filter((x) => x.active)), () => {}); }, [me]);

  if (loading) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;
  if (!axCan(me, 'deals')) return <Navigate to="/acconcy" replace />;
  if (error) return <div className="py-10 text-center text-sm text-tertiary-500">Deal not found. <Link className="text-primary-700 underline" to="/acconcy/deals">Back to deals</Link></div>;
  if (!deal) return <div className="py-10 text-center text-sm text-tertiary-500">Loading...</div>;

  const isAdmin = me.role === 'admin';
  const canEdit = axCan(me, 'dealsEdit');
  const canMoney = axCan(me, 'ledger');
  const showMoney = axCan(me, 'overview');
  const s = deal.summary;
  const locked = ['completed', 'cancelled'].includes(deal.status) && !isAdmin;
  const close = () => setModal(null);

  async function run(fn, ok) {
    setSaving(true);
    try {
      await withReason(fn);
      if (ok) pushSuccess(ok);
      close();
      await load();
    } catch (e) {
      pushError(acconcyError(e, 'Could not save'), 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(status) {
    let reason;
    let actual_end;
    if (status === 'cancelled') { reason = window.prompt('Why is this deal cancelled?'); if (!reason?.trim()) return; }
    else if (['completed', 'cancelled'].includes(deal.status)) { reason = window.prompt('Reason for reopening this deal:'); if (!reason?.trim()) return; }
    if (status === 'completed') { actual_end = window.prompt('Actual completion date (YYYY-MM-DD)', today()); if (!actual_end) return; }
    try {
      await acconcyApi.setDealStatus(deal.id, { status, ...(reason ? { reason: reason.trim() } : {}), ...(actual_end ? { actual_end } : {}) });
      load();
    } catch (e) {
      pushError(acconcyError(e, 'Could not change status'), 'Could not change status');
    }
  }
  async function removeDeal() {
    if (!window.confirm(`Delete ${deal.name}? Its entries are removed from the deal reports.`)) return;
    try {
      await acconcyApi.deleteDeal(deal.id);
      navigate('/acconcy/deals');
    } catch (e) {
      pushError(acconcyError(e, 'Could not delete'), 'Delete failed');
    }
  }
  const delEntry = (e) => async () => {
    if (!window.confirm('Delete this entry?')) return;
    try { await withReason((reason) => acconcyApi.deleteEntry(e.id, reason)); load(); } catch (err) { pushError(acconcyError(err, 'Could not delete'), 'Delete failed'); }
  };

  const saveDeal = (body) => run(async (reason) => acconcyApi.updateDeal(deal.id, { ...body, ...(reason ? { reason } : {}) }), 'Saved');
  const saveEntry = (body) => run(async (reason) => {
    const payload = { ...body, deal_id: deal.id, ...(reason ? { reason } : {}) };
    return modal.row ? acconcyApi.updateEntry(modal.row.id, payload) : acconcyApi.createEntry(payload);
  }, 'Saved');

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/acconcy/deals" className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline"><ArrowLeft className="h-3 w-3" />Deals</Link>
          <h1 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">{deal.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-tertiary-500">
            <span>{deal.code}</span><Pill tone={SERVICE_META[deal.service_type]?.tone || 'gray'}>{serviceLabel(deal.service_type)}</Pill>
            <Pill tone={DEAL_STATUS_META[deal.status]?.tone}>{DEAL_STATUS_META[deal.status]?.label}</Pill>
            {s.delayed && <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-red-700"><AlertTriangle className="h-3 w-3" />Delayed</span>}
            {deal.lead && <Link className="text-primary-700 hover:underline" to="/acconcy/leads">From lead {deal.lead.code}</Link>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && !locked && (
            <select aria-label="Change status" className="rounded-xl border bg-white px-3 py-2 text-sm" value="" onChange={(e) => e.target.value && setStatus(e.target.value)}>
              <option value="">Change status...</option>
              {DEAL_STATUSES.filter((x) => x.value !== deal.status).map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          )}
          {canEdit && !locked && <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setModal({ kind: 'edit' })}><Pencil className="h-4 w-4" />Edit</button>}
          {axCan(me, 'delete') && <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-danger-200 px-3 py-2 text-sm font-medium text-danger-600 hover:bg-danger-50" onClick={removeDeal}><Trash2 className="h-4 w-4" />Delete</button>}
        </div>
      </div>
      {locked && <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">This deal is {deal.status}. Only an admin can change it.</div>}

      {showMoney && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Deal amount" value={deal.deal_amount !== null ? <Money v={deal.deal_amount} /> : '-'} />
          <Kpi label="Revenue" value={<Money v={s.revenue} />} />
          <Kpi label="Expenses" value={<Money v={s.expense} />} />
          <Kpi label="Profit" value={<Money v={s.profit} signed />} hint={`Revenue - expenses · margin ${pctLabel(s.margin_pct)}`} tone="ax-gold" />
          <Kpi label="Open tasks" value={deal.open_tasks} />
        </div>
      )}

      <SectionTabs tabs={TABS.filter((t) => (t.key !== 'money' || showMoney) && (t.key !== 'investments' || axCan(me, 'investments')))} value={tab} onChange={setTab} className="min-w-0" />

      {tab === 'overview' && (
        <section className={card}>
          <h3 className="mb-3 font-heading text-sm font-semibold text-tertiary-900">Deal details</h3>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Client">{deal.party?.name}</Detail>
            <Detail label="Vendor">{deal.vendor?.name}</Detail>
            <Detail label="Location">{deal.location}</Detail>
            <Detail label="Start">{deal.start_date ? dateLabel(deal.start_date) : null}</Detail>
            <Detail label="Expected end">{deal.expected_end ? dateLabel(deal.expected_end) : null}</Detail>
            <Detail label="Actual end">{deal.actual_end ? dateLabel(deal.actual_end) : null}</Detail>
            <Detail label="Duration">{s.duration_days !== null ? `${s.duration_days} days` : null}</Detail>
            <Detail label="Assigned">{[deal.assignee?.name, deal.contractor?.name].filter(Boolean).join(' · ')}</Detail>
            {deal.cancel_reason && <div className="sm:col-span-2"><Detail label="Cancelled because">{deal.cancel_reason}</Detail></div>}
            <div className="sm:col-span-2 lg:col-span-3"><Detail label="Description"><span className="whitespace-pre-wrap">{deal.description}</span></Detail></div>
            <div className="sm:col-span-2 lg:col-span-3"><Detail label="Notes"><span className="whitespace-pre-wrap">{deal.notes}</span></Detail></div>
            {Array.isArray(deal.details) && deal.details.map((d) => <Detail key={d.label} label={d.label}>{d.value}</Detail>)}
          </dl>
        </section>
      )}

      {tab === 'money' && (
        <div className="space-y-3">
          {canMoney && (
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setModal({ kind: 'entry', type: 'expense' })}><Plus className="h-4 w-4" />Add expense</button>
              <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setModal({ kind: 'entry', type: 'revenue' })}><Plus className="h-4 w-4" />Add revenue</button>
            </div>
          )}
          {deal.entries.length === 0 ? <Empty>No revenue or expenses recorded on this deal yet. Profit is calculated from these entries.</Empty> : (
            <div className="overflow-x-auto rounded-xl border bg-white">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-primary-50/60 text-left text-xs text-tertiary-500"><tr><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium">Category</th><th className="px-3 py-2 font-medium">Description</th><th className="px-3 py-2 text-right font-medium">Amount</th><th className="px-3 py-2" /></tr></thead>
                <tbody>
                  {deal.entries.map((e) => (
                    <tr key={e.id} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap">{dateLabel(e.entry_date)}</td>
                      <td className="px-3 py-2"><Pill tone={e.type === 'revenue' ? 'green' : 'amber'}>{e.type === 'revenue' ? 'Revenue' : 'Expense'}</Pill></td>
                      <td className="px-3 py-2">{e.category_name}</td>
                      <td className="px-3 py-2 text-tertiary-600">{e.description || e.reference || '-'}</td>
                      <td className="px-3 py-2 text-right"><Money v={e.amount} className="font-medium" /></td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{canMoney && !e.source_type && <><button type="button" title="Edit" className="mr-1 rounded p-1 text-tertiary-500 hover:bg-primary-50" onClick={() => setModal({ kind: 'entry', row: e, type: e.type })}><Pencil className="h-4 w-4" /></button><button type="button" title="Delete" className="rounded p-1 text-tertiary-400 hover:bg-danger-50 hover:text-danger-600" onClick={delEntry(e)}><Trash2 className="h-4 w-4" /></button></>}{e.source_type && <span className="text-[11px] text-tertiary-400">from investment</span>}</td>
                    </tr>
                  ))}
                  <tr className="border-t bg-primary-50/40 font-semibold"><td className="px-3 py-2" colSpan={4}>Profit (revenue - expenses)</td><td className="px-3 py-2 text-right"><Money v={s.profit} signed /></td><td /></tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'investments' && (
        deal.investments.length === 0 ? <Empty>No investments are linked to this deal. Link one from the Investments page.</Empty> : (
          <ul className="divide-y rounded-xl border bg-white text-sm">
            {deal.investments.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span><Link className="font-medium text-primary-700 hover:underline" to="/acconcy/investments">{i.code} · {i.name}</Link><span className="ml-2 text-xs text-tertiary-500">{INVESTMENT_TYPE_META[i.type]?.label}</span></span>
                <span className="flex items-center gap-3 text-xs text-tertiary-600">Invested <Money v={i.amount} /> · Current <Money v={i.current_value} /></span>
              </li>
            ))}
          </ul>
        )
      )}
      {tab === 'tasks' && <DealTasks deal={deal} canTasks={axCan(me, 'tasksAll')} pickers={pickers} reload={load} />}
      {tab === 'documents' && <AcconcyDocuments ownerType="deal" ownerId={deal.id} canEdit={canEdit || canMoney} />}

      <Drawer open={modal?.kind === 'edit'} onClose={close} size="xl" tone="edit" title={`Edit ${deal.name}`}>
        {modal?.kind === 'edit' && <DealForm initial={deal} pickers={pickers} editing saving={saving} onSubmit={saveDeal} onCancel={close} />}
      </Drawer>
      <Modal open={modal?.kind === 'entry'} onClose={close} wide title={`${modal?.row ? 'Edit' : 'Add'} ${modal?.type === 'revenue' ? 'revenue' : 'expense'}`}>
        {modal?.kind === 'entry' && <EntryForm initial={modal.row} fixedType={modal.type} fixedDeal={deal} categories={categories} clients={pickers.clients} vendors={pickers.vendors} saving={saving} onSubmit={saveEntry} onCancel={close} />}
      </Modal>
    </div>
  );
}
