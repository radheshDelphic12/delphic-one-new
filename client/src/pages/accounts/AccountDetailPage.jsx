import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import DetailSkeleton from '../../components/ui/DetailSkeleton.jsx';
import Breadcrumbs from '../../components/ui/Breadcrumbs.jsx';
import NotesPanel from '../../components/NotesPanel.jsx';
import FilesPanel from '../../components/FilesPanel.jsx';
import UnlockButton from '../../components/UnlockButton.jsx';
import DeleteRecordButton from '../../components/DeleteRecordButton.jsx';
import AccountFormPage from './AccountFormPage.jsx';
import AccountStageMoveDrawer from './AccountStageMoveDrawer.jsx';
import AccountStageOverrideDrawer from './AccountStageOverrideDrawer.jsx';
import AccountMeetingEditDrawer from './AccountMeetingEditDrawer.jsx';
import { accountAccent } from '../../lib/accountAccent.js';
import { ACCOUNT_TRANSITIONS, accountKey, apiErrorMessage, canClassifyAccount, canMutateAccount, formatAccountValue } from './accountUtils.js';
import { userCan } from '../../lib/permissions.js';

function DetailField({ label, value, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-tertiary-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm capitalize text-tertiary-900">{children || formatAccountValue(value)}</dd>
    </div>
  );
}

function DetailSection({ title, actions, children }) {
  return (
    <section className="overflow-hidden rounded-xl border border-tertiary-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-tertiary-100 bg-tertiary-50/60 px-3.5 py-2.5">
        <h2 className="font-heading text-sm font-semibold tracking-tight text-tertiary-900">{title}</h2>
        {actions}
      </div>
      <dl className="grid gap-x-5 gap-y-3 p-3.5 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>
    </section>
  );
}

export default function AccountDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const [searchParams, setSearchParams] = useSearchParams();
  const [account, setAccount] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isStageModalOpen, setIsStageModalOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [movingStage, setMovingStage] = useState(false);
  const [editOpen, setEditOpen] = useState(searchParams.get('edit') === '1');
  const [classifying, setClassifying] = useState(false);
  const [meetingEditOpen, setMeetingEditOpen] = useState(false);
  const [savingMeeting, setSavingMeeting] = useState(false);

  async function loadAccount() {
    setLoading(true);
    try {
      const [accountResponse, historyResponse] = await Promise.all([
        apiClient.get(`/accounts/${id}`),
        apiClient.get(`/accounts/${id}/history`),
      ]);
      setAccount(accountResponse.data.data);
      setHistory(historyResponse.data.data || []);
    } catch (requestError) {
      pushError(apiErrorMessage(requestError, 'Failed to load account'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAccount();
  }, [id]);

  useEffect(() => {
    if (searchParams.get('edit') === '1') setEditOpen(true);
  }, [searchParams]);

  function closeEdit() {
    setEditOpen(false);
    if (searchParams.get('edit')) {
      searchParams.delete('edit');
      setSearchParams(searchParams, { replace: true });
    }
  }

  async function moveStage(body) {
    setMovingStage(true);
    try {
      await apiClient.post(`/accounts/${id}/stage`, body);
      setIsStageModalOpen(false);
      await loadAccount();
    } catch (requestError) {
      pushError(apiErrorMessage(requestError, 'Failed to move account stage'), 'Something went wrong');
    } finally {
      setMovingStage(false);
    }
  }

  async function submitOverride(body) {
    setMovingStage(true);
    try {
      await apiClient.post(`/accounts/${id}/stage/override`, body);
      setOverrideOpen(false);
      await loadAccount();
    } catch (requestError) {
      pushError(apiErrorMessage(requestError, 'Failed to override account stage'), 'Something went wrong');
    } finally {
      setMovingStage(false);
    }
  }

  async function saveMeeting(body) {
    setSavingMeeting(true);
    try {
      await apiClient.post(`/accounts/${id}/meeting`, body);
      setMeetingEditOpen(false);
      await loadAccount();
    } catch (requestError) {
      pushError(apiErrorMessage(requestError, 'Failed to update meeting'), 'Something went wrong');
    } finally {
      setSavingMeeting(false);
    }
  }

  async function classifyLead(type) {
    setClassifying(true);
    try {
      await apiClient.post(`/accounts/${id}/classify`, { type });
      await loadAccount();
    } catch (requestError) {
      pushError(apiErrorMessage(requestError, 'Failed to classify lead'), 'Something went wrong');
    } finally {
      setClassifying(false);
    }
  }

  if (loading) return <DetailSkeleton />;
  if (!account) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-tertiary-600">Account not found or could not be loaded.</p>
        <Link to="/accounts" className="text-sm text-primary-700 hover:underline">Back to accounts</Link>
      </div>
    );
  }

  const canMutate = canMutateAccount(account, user);
  const canOverride = Boolean(user?.is_superadmin);
  const canUnlock = userCan(user, 'unlockAccount');
  const nextStages = ACCOUNT_TRANSITIONS[account.stage] || [];
  const additionalContacts = Array.isArray(account.additional_contacts) ? account.additional_contacts : [];
  const accent = accountAccent(account.id);

  return (
    <div className="space-y-3.5">
      <div className={`border-b border-tertiary-200 border-l-4 pb-3 pl-3 ${accent.border}`}>
        <Breadcrumbs
          items={[
            { label: 'Accounts', to: '/accounts' },
            { label: accountKey(account.id) },
          ]}
        />
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white ${accent.dot}`}
              aria-hidden="true"
            >
              {account.name?.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-medium tracking-tight text-primary-700">{accountKey(account.id)}</span>
                <Badge value={account.stage} />
                {account.is_locked && <span className="rounded-md bg-danger-50 px-2 py-0.5 text-xs font-medium text-danger-700">Locked</span>}
              </div>
              <h1 className="mt-0.5 font-heading text-xl font-semibold tracking-tight text-tertiary-900">{account.name}</h1>
              <p className="mt-0.5 text-sm capitalize text-tertiary-500">
                {account.type || 'Unclassified lead'} · Owner: {account.owner?.name || '—'}
                {account.origin_owner && account.origin_owner.id !== account.owner?.id
                  ? ` · Brought by ${account.origin_owner.name}`
                  : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to={`/pipeline/${id}`} className="btn-secondary">Pipeline board</Link>
            {((canMutate && !account.is_locked) || canOverride) && (
              <button type="button" className="btn-secondary" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </button>
            )}
            {canMutate && !account.is_locked && nextStages.length > 0 && (
              <button type="button" onClick={() => setIsStageModalOpen(true)} className="btn-primary">Move stage</button>
            )}
            {canOverride && (
              <button type="button" onClick={() => setOverrideOpen(true)} className="btn-secondary">Override stage</button>
            )}
            {canClassifyAccount(account, user) && !account.is_locked && (
              <>
                <button type="button" disabled={classifying} className="btn-secondary" onClick={() => classifyLead('client')}>
                  Classify as Client
                </button>
                <button type="button" disabled={classifying} className="btn-secondary" onClick={() => classifyLead('vendor')}>
                  Classify as Vendor
                </button>
              </>
            )}
            {canUnlock && account.is_locked && (
              <UnlockButton entityType="account" entityId={account.id} onUnlocked={loadAccount} />
            )}
            {userCan(user, 'deleteRecords') && (
              <DeleteRecordButton
                entityType="account"
                entityId={account.id}
                entityLabel={`${accountKey(account.id)} · ${account.name}`}
                onDeleted={() => navigate('/accounts')}
              />
            )}
          </div>
        </div>
      </div>

      {account.is_locked && (
        <div className="rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-700">
          This account is locked because it reached a terminal stage. It remains available for viewing.
          {canUnlock ? ' Use Unlock to allow edits again.' : ''}
        </div>
      )}

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="space-y-3.5">
          <DetailSection title="Company information">
            <DetailField label="Type" value={account.type} />
            <DetailField label="Industry" value={account.industry} />
            <DetailField label="Company size" value={account.company_size} />
            <DetailField label="Website">
              {account.website ? <a href={account.website} target="_blank" rel="noreferrer" className="normal-case text-primary-700 hover:underline">{account.website}</a> : '—'}
            </DetailField>
            <DetailField label="Location" value={[account.location_city, account.location_country].filter(Boolean).join(', ')} />
            <DetailField label="GST / Tax ID" value={account.gst_or_tax_id} />
            <DetailField label="Source" value={account.source} />
            <DetailField label="Owner (POC)" value={account.owner?.name} />
            <DetailField label="Brought by" value={account.origin_owner?.name} />
            <DetailField label="Lead location" value={account.location} />
            <DetailField label="LinkedIn">
              {account.linkedin_url ? <a href={account.linkedin_url} target="_blank" rel="noreferrer" className="normal-case text-primary-700 hover:underline">{account.linkedin_url}</a> : '—'}
            </DetailField>
            <DetailField label="Created" value={new Date(account.created_at).toLocaleString()} />
            <DetailField label="Updated" value={new Date(account.updated_at).toLocaleString()} />
          </DetailSection>

          <DetailSection title="Primary contact">
            <DetailField label="Name" value={account.poc_name} />
            <DetailField label="Designation" value={account.poc_designation} />
            <DetailField label="Email">
              {account.poc_email ? <a href={`mailto:${account.poc_email}`} className="normal-case text-primary-700 hover:underline">{account.poc_email}</a> : '—'}
            </DetailField>
            <DetailField label="Phone" value={account.poc_phone} />
          </DetailSection>

          <DetailSection
            title="Meeting information"
            actions={
              canMutate &&
              !account.is_locked &&
              account.meeting_date && (
                <button type="button" className="btn-secondary" onClick={() => setMeetingEditOpen(true)}>
                  <Pencil className="h-4 w-4" /> Edit meeting
                </button>
              )
            }
          >
            <DetailField label="Mode" value={account.meeting_mode} />
            <DetailField label="Date" value={account.meeting_date ? new Date(account.meeting_date).toLocaleString() : null} />
            <DetailField label="Location" value={account.meeting_location} />
            <DetailField label="Notes" value={account.meeting_notes} />
            <DetailField label="Attendees">
              {account.meeting_attendees?.length
                ? account.meeting_attendees.map((a) => (
                    <span key={a.id} className="mr-1 inline-block rounded-full bg-tertiary-100 px-2 py-0.5 text-xs normal-case text-tertiary-700">
                      {a.name}
                    </span>
                  ))
                : '—'}
            </DetailField>
          </DetailSection>

          {account.type && (
          <DetailSection title={account.type === 'vendor' ? 'Vendor details' : 'Client details'}>
            {account.type === 'vendor' ? (
              <>
                <DetailField label="Specializations" value={(account.vendor_specializations || []).join(', ')} />
                <DetailField
                  label="Rate range"
                  value={account.vendor_rate_range ? `${account.vendor_rate_range.currency} ${account.vendor_rate_range.min}–${account.vendor_rate_range.max}` : null}
                />
                <DetailField label="Payment terms" value={account.vendor_payment_terms} />
                <DetailField label="Agreement URL">
                  {account.vendor_agreement_url ? (
                    <a href={account.vendor_agreement_url} target="_blank" rel="noreferrer" className="normal-case text-primary-700 hover:underline">
                      Open agreement
                    </a>
                  ) : '—'}
                </DetailField>
              </>
            ) : (
              <>
                <DetailField label="Billing currency" value={account.client_billing_currency} />
                <DetailField label="Payment terms" value={account.client_payment_terms} />
                <DetailField label="Agreement URL">
                  {account.client_agreement_url ? (
                    <a href={account.client_agreement_url} target="_blank" rel="noreferrer" className="normal-case text-primary-700 hover:underline">
                      Open agreement
                    </a>
                  ) : '—'}
                </DetailField>
              </>
            )}
          </DetailSection>
          )}

          <section className="overflow-hidden rounded-xl border border-tertiary-200 bg-white">
            <h2 className="border-b border-tertiary-100 bg-tertiary-50/60 px-3.5 py-2.5 font-heading text-sm font-semibold tracking-tight text-tertiary-900">
              Additional contacts
            </h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-tertiary-100 bg-white text-[11px] uppercase tracking-wide text-tertiary-500">
                  <tr>
                    <th className="px-3.5 py-2 font-medium">Name</th>
                    <th className="px-3.5 py-2 font-medium">Role</th>
                    <th className="px-3.5 py-2 font-medium">Designation</th>
                    <th className="px-3.5 py-2 font-medium">Email</th>
                    <th className="px-3.5 py-2 font-medium">Phone</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-tertiary-100">
                  {additionalContacts.map((contact, index) => (
                    <tr key={`${contact.email || contact.name}-${index}`} className="transition-colors hover:bg-primary-50/40">
                      <td className="px-3.5 py-2 text-tertiary-900">{formatAccountValue(contact.name)}</td>
                      <td className="px-3.5 py-2">{formatAccountValue(contact.role_label)}</td>
                      <td className="px-3.5 py-2">{formatAccountValue(contact.designation)}</td>
                      <td className="px-3.5 py-2 normal-case">{formatAccountValue(contact.email)}</td>
                      <td className="px-3.5 py-2">{formatAccountValue(contact.phone)}</td>
                    </tr>
                  ))}
                  {additionalContacts.length === 0 && (
                    <tr><td colSpan={5} className="px-3.5 py-4 text-center text-tertiary-400">No additional contacts</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="space-y-3.5 self-start xl:sticky xl:top-0">
          <section className="overflow-hidden rounded-xl border border-tertiary-200 bg-white">
            <h2 className="border-b border-tertiary-100 bg-tertiary-50/60 px-3.5 py-2.5 font-heading text-sm font-semibold tracking-tight text-tertiary-900">
              Stage history
            </h2>
            <ol className="divide-y divide-tertiary-100">
              {history.map((entry) => (
                <li key={entry.id} className="px-3.5 py-2.5 transition-colors hover:bg-primary-50/40">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge value={entry.from_stage} />
                    <span className="text-tertiary-400">→</span>
                    <Badge value={entry.to_stage} />
                  </div>
                  <p className="mt-1.5 text-xs text-tertiary-500">
                    {entry.changed_by?.name || 'Unknown'} · {new Date(entry.changed_at).toLocaleString()}
                  </p>
                  {entry.reason && <p className="mt-1 text-sm text-tertiary-700">{entry.reason}</p>}
                </li>
              ))}
              {history.length === 0 && <li className="px-3.5 py-4 text-sm text-tertiary-400">No stage changes yet.</li>}
            </ol>
          </section>
          <NotesPanel entityType="account" entityId={account.id} />
          <FilesPanel entityType="account" entityId={account.id} canUpload={canMutate} defaultLabel="Agreement" />
        </aside>
      </div>

      {account && (
        <AccountStageMoveDrawer
          account={account}
          open={isStageModalOpen}
          saving={movingStage}
          onClose={() => setIsStageModalOpen(false)}
          onMove={moveStage}
        />
      )}

      {account && canOverride && (
        <AccountStageOverrideDrawer
          account={account}
          open={overrideOpen}
          saving={movingStage}
          onClose={() => setOverrideOpen(false)}
          onMove={submitOverride}
        />
      )}

      {account && (
        <AccountMeetingEditDrawer
          account={account}
          open={meetingEditOpen}
          saving={savingMeeting}
          onClose={() => setMeetingEditOpen(false)}
          onSave={saveMeeting}
        />
      )}

      <Drawer open={editOpen} title="Edit account" onClose={closeEdit} size="xl" tone="edit">
        {editOpen && (
          <AccountFormPage
            asPanel
            accountId={id}
            onCancel={closeEdit}
            onDone={() => {
              closeEdit();
              loadAccount();
            }}
          />
        )}
      </Drawer>
    </div>
  );
}
