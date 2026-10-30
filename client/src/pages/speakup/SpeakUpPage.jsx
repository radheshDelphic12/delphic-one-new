import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Inbox, ListChecks, Megaphone, ScanSearch, Settings } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import EmptyState from '../../components/ui/EmptyState.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import RaiseComplaintForm from './RaiseComplaintForm.jsx';
import MyComplaints from './MyComplaints.jsx';
import TrackComplaint from './TrackComplaint.jsx';
import InboxTab from './InboxTab.jsx';
import SpeakUpSettings from './SpeakUpSettings.jsx';

/**
 * Speak Up - Confidential Reporting. Any employee raises a complaint in confidence (or anonymously) and follows it by its reference
 * number; the people an admin set for each category receive and handle it. Delphic Global (the master workspace). Off until an admin
 * switches it on under Settings.
 */
export default function SpeakUpPage() {
  const { pushError } = useAlerts();
  const [params, setParams] = useSearchParams();
  const [meta, setMeta] = useState(null);

  const loadMeta = useCallback(() => {
    apiClient.get('/whistleblower/meta').then(({ data }) => setMeta(data.data)).catch((err) => pushError(apiErrorMessage(err, 'Could not open Speak Up'), 'Something went wrong'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadMeta(); }, [loadMeta]);

  const tabs = useMemo(() => {
    if (!meta) return [];
    const list = [];
    if (meta.enabled) list.push({ key: 'raise', label: 'Raise a complaint', icon: Megaphone }, { key: 'mine', label: 'My complaints', icon: ListChecks }, { key: 'track', label: 'Track a complaint', icon: ScanSearch });
    if (meta.is_handler) list.push({ key: 'inbox', label: 'Complaints to handle', icon: Inbox });
    if (meta.can_manage) list.push({ key: 'settings', label: 'Settings', icon: Settings });
    return list;
  }, [meta]);

  const requested = params.get('tab');
  const tab = tabs.some((t) => t.key === requested) ? requested : tabs[0]?.key;
  const go = (key) => setParams({ tab: key });

  if (!meta) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-semibold text-tertiary-900">Speak Up – Confidential Reporting</h1>
        <p className="mt-1 text-sm text-tertiary-500">Raise a complaint in confidence, or anonymously, and follow it with its reference number. It reaches only the people who handle that category.</p>
      </div>

      {!meta.enabled && (
        <p className="rounded-xl bg-warning-50 px-3 py-2 text-sm text-warning-800" data-testid="speakup-off">
          Speak Up is switched off for this company. {meta.can_manage ? 'Set the handlers for each category, then switch it on under Settings.' : 'It will appear here when an admin switches it on.'}
        </p>
      )}

      {tabs.length === 0 ? (
        <EmptyState icon={Megaphone} title="Speak Up is not available yet" description="An admin has not switched it on for this company." />
      ) : (
        <>
          <SectionTabs tabs={tabs} value={tab} onChange={go} />
          {tab === 'raise' && <RaiseComplaintForm meta={meta} onMine={() => go('mine')} />}
          {tab === 'mine' && <MyComplaints onRaise={() => go('raise')} />}
          {tab === 'track' && <TrackComplaint />}
          {tab === 'inbox' && <InboxTab meta={meta} initialFilters={params.get('filter') === 'overdue' ? { overdue: true } : params.get('filter') === 'new' ? { status: 'new' } : {}} />}
          {tab === 'settings' && <SpeakUpSettings onChanged={loadMeta} />}
        </>
      )}
    </div>
  );
}
