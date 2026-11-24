import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/authContext.jsx';
import { allowed, isAdminUser } from '../../lib/access.js';
import OverviewTab from './OverviewTab.jsx';
import SignTab from './SignTab.jsx';
import StorageTab from './StorageTab.jsx';

/**
 * People > Documents: what is on file for every client, vendor and employee (and what is missing), documents to sign with a person's own
 * signature, and how much storage they take.
 */
export default function DocumentsPage() {
  const { user } = useAuth();
  const admin = isAdminUser(user);
  const canView = allowed(user, 'documents.view', admin);
  const canSign = allowed(user, 'documents.sign', admin);
  const tabs = [
    ...(canView ? [{ key: 'overview', label: 'On file' }] : []),
    ...(canView || canSign ? [{ key: 'sign', label: 'Sign documents' }] : []),
    ...(canView ? [{ key: 'storage', label: 'Storage' }] : []),
  ];
  const [params, setParams] = useSearchParams();
  const requested = params.get('doc') || tabs[0]?.key;
  const tab = tabs.some((t) => t.key === requested) ? requested : tabs[0]?.key;
  const choose = (key) => { const next = new URLSearchParams(params); next.set('doc', key); setParams(next); };
  return (
    <div className="space-y-4" data-testid="documents-page">
      <div className="inline-flex rounded-xl border border-tertiary-200 bg-white p-0.5" role="tablist" aria-label="Documents">
        {tabs.map((t) => <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} data-testid={`docs-tab-${t.key}`} onClick={() => choose(t.key)} className={`rounded-lg px-3.5 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:text-tertiary-900'}`}>{t.label}</button>)}
      </div>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'sign' && <SignTab />}
      {tab === 'storage' && <StorageTab />}
    </div>
  );
}
