import { useCallback, useEffect, useState } from 'react';
import { Landmark, Pencil, PhoneCall } from 'lucide-react';
import apiClient from '../lib/apiClient.js';
import { useAlerts } from '../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../lib/alerts/apiErrorMessage.js';
import Drawer from './ui/Drawer.jsx';
import FilesPanel from './FilesPanel.jsx';
import { PeekField } from './ui/PeekFields.jsx';

const BANK_FIELDS = [
  ['bank_account_holder', 'Account holder name'],
  ['bank_name', 'Bank name'],
  ['bank_account_number', 'Account number'],
  ['bank_ifsc', 'IFSC / SWIFT code'],
  ['bank_branch', 'Branch'],
];
// Printed on the payslip alongside the bank account.
const IDENTITY_FIELDS = [
  ['aadhaar_number', 'Aadhaar number'],
  ['pan_number', 'PAN'],
];
const EMERGENCY_FIELDS = [
  ['emergency_contact_name', 'Contact name'],
  ['emergency_contact_relation', 'Relationship'],
  ['emergency_contact_phone', 'Phone', 'tel'],
  ['emergency_contact_email', 'Email', 'email'],
];
const ALL_FIELDS = [...BANK_FIELDS, ...IDENTITY_FIELDS, ...EMERGENCY_FIELDS];

// "XXXX XXXX 1234" — the full number only shows in the edit form.
function maskAccount(value) {
  if (!value) return null;
  const tail = value.replace(/\s/g, '').slice(-4);
  return `•••• ${tail}`;
}

function Card({ icon: Icon, title, action, children }) {
  return (
    <section className="rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="inline-flex items-center gap-2 font-heading text-base font-semibold text-tertiary-900">
          <Icon className="h-4 w-4 text-tertiary-400" /> {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * An employee's bank account, emergency contact and documents. `self` reads
 * and writes the signed-in employee's own (Settings → My details); otherwise
 * `membershipId` is someone else's, which only an admin may see — for anyone
 * else the API answers 403 and nothing renders.
 */
export default function PersonalDetailsSection({ membershipId, self = false }) {
  const { pushError, pushInfo } = useAlerts();
  const url = self ? '/orgs/me/details' : `/orgs/memberships/${membershipId}/details`;
  const [details, setDetails] = useState(undefined); // undefined = loading, null = not allowed
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    apiClient.get(url).then(({ data }) => setDetails(data.data)).catch(() => setDetails(null));
  }, [url]);
  useEffect(() => { load(); }, [load]);

  if (!details) return null;

  function openEdit() {
    setForm(Object.fromEntries(ALL_FIELDS.map(([key]) => [key, details[key] || ''])));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await apiClient.put(url, form);
      setDetails(data.data);
      setForm(null);
      pushInfo('Details saved');
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save the details'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  const editButton = (
    <button type="button" className="btn-secondary inline-flex items-center gap-2 text-xs" onClick={openEdit}>
      <Pencil className="h-3.5 w-3.5" /> Update
    </button>
  );
  const show = (key) => details[key] || <span className="text-tertiary-400">Not added</span>;
  const who = self ? 'your' : `${details.person?.name || 'this employee'}'s`;

  return (
    <>
      <Card icon={Landmark} title="Bank details" action={editButton}>
        <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[...BANK_FIELDS, ...IDENTITY_FIELDS].map(([key, label]) => (
            <PeekField key={key} label={label}>{key === 'bank_account_number' ? maskAccount(details[key]) || show(key) : show(key)}</PeekField>
          ))}
        </dl>
        {details.personal_details_updated_at && (
          <p className="mt-3 text-xs text-tertiary-400">Last updated {new Date(details.personal_details_updated_at).toLocaleString()}</p>
        )}
      </Card>

      <Card icon={PhoneCall} title="Emergency contact" action={editButton}>
        <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {EMERGENCY_FIELDS.map(([key, label]) => <PeekField key={key} label={label}>{show(key)}</PeekField>)}
        </dl>
      </Card>

      <section className="rounded-2xl border border-tertiary-100 bg-white p-5 shadow-card">
        <FilesPanel entityType="org_membership" entityId={details.id} title="Documents" defaultLabel="Document" multiple />
        <p className="mt-2 text-xs text-tertiary-400">ID proofs, offer / relieving letters, certificates … Only {who === 'your' ? 'you and admins' : 'admins and the employee'} can see these.</p>
      </section>

      <Drawer
        open={Boolean(form)}
        title={`Update ${who} details`}
        onClose={() => setForm(null)}
        size="lg"
        tone="edit"
        footer={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={saving}>Cancel</button>
            <button type="submit" form="personal-details-form" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save details'}</button>
          </>
        )}
      >
        {form && (
          <form id="personal-details-form" onSubmit={save} className="space-y-6">
            {[['Bank details', BANK_FIELDS], ['Identity (for the payslip)', IDENTITY_FIELDS], ['Emergency contact', EMERGENCY_FIELDS]].map(([heading, fields]) => (
              <fieldset key={heading} className="grid gap-3 sm:grid-cols-2">
                <legend className="mb-2 font-heading text-sm font-semibold text-tertiary-900">{heading}</legend>
                {fields.map(([key, label, type]) => (
                  <label key={key} className="block text-xs font-medium text-tertiary-600">
                    {label}
                    <input
                      type={type || 'text'}
                      value={form[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      autoComplete="off"
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                    />
                  </label>
                ))}
              </fieldset>
            ))}
          </form>
        )}
      </Drawer>
    </>
  );
}
