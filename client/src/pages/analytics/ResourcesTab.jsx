import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import useLiveData from '../../lib/useLiveData.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { useClientAccountOptions, useOrgMembershipOptions } from '../../lib/lookups.js';
import { dateLabel, isoDate, money } from '../../lib/format.js';
import DataTable from '../../components/ui/DataTable.jsx';
import FormDrawer from '../../components/ui/FormDrawer.jsx';
import { LiveIndicator, RangeBar, monthStartIso } from './LiveSalesTab.jsx';

const POLL_MS = 60000;

function PersonLink({ person }) {
  if (!person) return '-';
  return (
    <Link className="font-medium text-primary-700 hover:underline" to={`/people/${person.membership_id}`} onClick={(e) => e.stopPropagation()}>
      {person.name}
    </Link>
  );
}

/**
 * Resource-wise revenue. The WORKING resource is whoever logs the approved
 * hours; the FACE resource is the person who fronts that work to the client
 * (set via a mapping). Unmapped workers are their own face.
 */
export default function ResourcesTab() {
  const { pushError, pushSuccess } = useAlerts();
  const [range, setRange] = useState({ from: monthStartIso(), to: isoDate() });
  const [drawer, setDrawer] = useState(false);
  const report = useLiveData(() => apiClient.get('/analytics/revenue-by-resource', { params: range }).then((r) => r.data.data), { intervalMs: POLL_MS, deps: [range.from, range.to] });
  const mappings = useLiveData(() => apiClient.get('/analytics/resource-mappings').then((r) => r.data.data));
  const memberOptions = useOrgMembershipOptions(drawer);
  const accountOptions = useClientAccountOptions(drawer);

  async function createMapping(values) {
    try {
      await apiClient.post('/analytics/resource-mappings', values);
      pushSuccess?.('Resource mapping saved');
      mappings.refresh();
      report.refresh();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save mapping'), 'Could not save');
      throw err;
    }
  }

  async function removeMapping(id) {
    try {
      await apiClient.delete(`/analytics/resource-mappings/${id}`);
      mappings.refresh();
      report.refresh();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to remove mapping'), 'Could not remove');
    }
  }

  const workingCols = [
    { key: 'name', header: 'Working resource', render: (r) => <PersonLink person={r} /> },
    { key: 'designation', header: 'Designation', render: (r) => r.designation || '-' },
    { key: 'face', header: 'Face resource', render: (r) => (r.face_resource ? <PersonLink person={r.face_resource} /> : <span className="text-tertiary-400">Self</span>) },
    { key: 'revenue', header: 'Revenue', render: (r) => <span className="font-medium">{money(r.revenue)}</span> },
    { key: 'cost', header: 'Cost', render: (r) => money(r.cost) },
    { key: 'margin', header: 'Margin', render: (r) => <span className={r.margin < 0 ? 'text-red-600' : 'text-green-700'}>{money(r.margin)}</span> },
  ];
  const faceCols = [
    { key: 'name', header: 'Face resource', render: (r) => <PersonLink person={r} /> },
    { key: 'working_resources', header: 'Working resources' },
    { key: 'revenue', header: 'Revenue', render: (r) => <span className="font-medium">{money(r.revenue)}</span> },
    { key: 'margin', header: 'Margin', render: (r) => money(r.margin) },
  ];
  const mapCols = [
    { key: 'face_name', header: 'Face' },
    { key: 'working_name', header: 'Working' },
    { key: 'account_name', header: 'Client', render: (r) => r.account_name || 'All clients' },
    { key: 'effective_from', header: 'From', render: (r) => dateLabel(r.effective_from) },
    { key: 'effective_to', header: 'To', render: (r) => (r.effective_to ? dateLabel(r.effective_to) : 'Open') },
    { key: 'x', header: '', render: (r) => <button type="button" aria-label="Remove mapping" className="text-tertiary-400 hover:text-red-600" onClick={() => removeMapping(r.id)}><Trash2 className="h-4 w-4" /></button> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <LiveIndicator updatedAt={report.updatedAt} everyMs={POLL_MS} />
        <RangeBar from={range.from} to={range.to} onChange={setRange} />
      </div>

      <section className="space-y-2">
        <h2 className="font-heading text-sm font-semibold text-tertiary-900">Working resources</h2>
        <DataTable columns={workingCols} rows={(report.data?.working_resources || []).map((r) => ({ ...r, id: r.membership_id }))} loading={report.loading} emptyLabel="No computed profitability in this range. Approve timesheets and run the nightly compute." />
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-sm font-semibold text-tertiary-900">Face resources <span className="font-normal text-tertiary-500">- revenue attributed to whoever fronts the work</span></h2>
        <DataTable columns={faceCols} rows={(report.data?.face_resources || []).map((r) => ({ ...r, id: r.membership_id }))} loading={report.loading} emptyLabel="Nothing to attribute yet" />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-sm font-semibold text-tertiary-900">Face to working mappings</h2>
          <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => setDrawer(true)}><Plus className="h-4 w-4" />Map resource</button>
        </div>
        <DataTable columns={mapCols} rows={mappings.data || []} loading={mappings.loading} emptyLabel="No mappings: every working resource is its own face" />
      </section>

      <FormDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        title="Map face to working resource"
        intro="Revenue earned by the working resource is attributed to the face resource who fronts the client relationship."
        submitLabel="Save mapping"
        onSubmit={createMapping}
        fields={[
          { name: 'face_membership_id', label: 'Face resource', type: 'search', options: memberOptions, required: true },
          { name: 'working_membership_id', label: 'Working resource', type: 'search', options: memberOptions, required: true },
          { name: 'account_id', label: 'Client', type: 'search', options: accountOptions, hint: 'optional, blank = all clients', placeholder: 'All clients' },
          { name: 'effective_from', label: 'Effective from', type: 'date', required: true, default: isoDate() },
          { name: 'effective_to', label: 'Effective to', type: 'date', hint: 'optional' },
        ]}
      />
    </div>
  );
}
