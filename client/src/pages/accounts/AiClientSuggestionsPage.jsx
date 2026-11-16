import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Loader2, Sparkles } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import EmptyState from '../../components/ui/EmptyState.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import { FIELD_INPUT } from '../../components/ui/formLayout.jsx';
import { canCreateAccount } from './accountUtils.js';

const SIZE_LABEL = { startup: 'Startup', small: 'Small', mid: 'Mid-size', enterprise: 'Enterprise' };
const TABS = [{ key: 'new', label: 'New' }, { key: 'added', label: 'Added as leads' }, { key: 'dismissed', label: 'Dismissed' }];

/**
 * Accounts > AI suggestions. The AI reads our accounts and requirements and suggests NEW companies that could become clients, the service each could
 * take from us, the roles to approach and how. It never writes phone numbers or emails (it would make them up): add the real contact yourself
 * once a suggestion is turned into a lead.
 */
export default function AiClientSuggestionsPage() {
  const { user } = useAuth();
  const { pushError, pushSuccess } = useAlerts();
  const navigate = useNavigate();
  const canAsk = canCreateAccount(user);
  const [tab, setTab] = useState('new');
  const [data, setData] = useState(null);
  const [count, setCount] = useState(10);
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false); // asking the AI
  const [acting, setActing] = useState('');

  const load = useCallback(() => {
    apiClient.get('/lead-suggestions', { params: { status: tab } }).then(({ data: res }) => setData(res.data)).catch((err) => { setData({ ready: false, items: [], services: [] }); pushError(apiErrorMessage(err, 'Could not load the suggestions'), 'Something went wrong'); });
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setData(null); load(); }, [load]);

  async function generate() {
    setBusy(true);
    try {
      const { data: res } = await apiClient.post('/lead-suggestions/generate', { count: Number(count) || 10, ...(focus.trim() ? { focus: focus.trim() } : {}) });
      pushSuccess(res.data.items.length ? `${res.data.items.length} new companies suggested.` : 'The AI had no new company to add this time. Try a different focus.', 'Done');
      if (tab !== 'new') setTab('new'); else load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'The AI could not make suggestions'), 'Could not suggest');
    } finally {
      setBusy(false);
    }
  }

  async function act(item, action) {
    setActing(item.id);
    try {
      const { data: res } = await apiClient.post(`/lead-suggestions/${item.id}/${action}`);
      if (action === 'add') { pushSuccess(`${item.name} is now a lead account.`, 'Added'); navigate(`/accounts/${res.data.account_id}`); return; }
      load();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Could not do that'), 'Something went wrong');
    } finally {
      setActing('');
    }
  }

  return (
    <div className="space-y-4" data-testid="ai-suggestions">
      <Link to="/accounts" className="inline-flex items-center gap-1 text-sm text-primary-700 hover:underline"><ArrowLeft className="h-4 w-4" /> Accounts</Link>
      <div>
        <h1 className="font-heading text-xl font-semibold text-tertiary-900">AI suggestions: companies that could become clients</h1>
        <p className="mt-1 text-sm text-tertiary-500">The AI looks at our own accounts and requirements and suggests new companies, the service each could take from us, the roles to approach and how. These are starting points from the AI general knowledge: check each company before you reach out. It does not write phone numbers or emails; add the real contact yourself after you add the company as a lead.</p>
      </div>

      {canAsk && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card">
          <div className="w-28"><label className="mb-1 block text-xs font-medium text-tertiary-600" htmlFor="ai-count">How many</label><input id="ai-count" type="number" min="1" max="15" className={FIELD_INPUT} value={count} onChange={(e) => setCount(e.target.value)} /></div>
          <div className="min-w-[16rem] flex-1"><label className="mb-1 block text-xs font-medium text-tertiary-600" htmlFor="ai-focus">Focus (optional)</label><input id="ai-focus" className={FIELD_INPUT} value={focus} maxLength={300} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. fintech companies in Bengaluru that need Java engineers" /></div>
          <button type="button" className="btn-primary inline-flex items-center gap-1.5" disabled={busy || data?.ready === false} onClick={generate} data-testid="ai-generate">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Asking the AI... up to a minute</> : <><Sparkles className="h-4 w-4" /> Suggest companies</>}
          </button>
          {data?.ready === false && <p className="w-full text-xs text-warning-700">The AI key is not set on the server, so suggestions cannot be made yet.</p>}
        </div>
      )}

      <SectionTabs tabs={TABS} value={tab} onChange={setTab} />

      {!data ? <Skeleton className="h-48" /> : data.items.length === 0 ? (
        <EmptyState icon={Building2} title={tab === 'new' ? 'No new suggestions' : 'Nothing here'} description={tab === 'new' ? (canAsk ? 'Press "Suggest companies" to ask the AI.' : 'Someone who can create accounts can ask the AI for suggestions.') : 'No suggestion in this list.'} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.items.map((s) => (
            <div key={s.id} className="rounded-2xl border border-tertiary-100 bg-white p-4 shadow-card" data-testid="suggestion-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-heading text-base font-semibold text-tertiary-900">{s.name}</h2>
                  <p className="text-xs text-tertiary-500">{[s.industry, SIZE_LABEL[s.company_size], s.location].filter(Boolean).join(' · ')}</p>
                </div>
                {s.status === 'added' && s.account_id && <Link to={`/accounts/${s.account_id}`} className="text-xs font-medium text-primary-700 hover:underline">Open account</Link>}
              </div>
              <p className="mt-2 text-sm text-tertiary-800"><span className="font-medium">Why it fits: </span>{s.why_fit}</p>
              <div className="mt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-tertiary-500">Service they could take from us</p>
                <ul className="mt-1 space-y-1.5">
                  {s.services.map((x) => (
                    <li key={x.key} className="text-sm text-tertiary-800"><span className="mr-1.5 inline-block rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">{x.service}</span>{x.pitch}</li>
                  ))}
                </ul>
              </div>
              {s.decision_makers.length > 0 && <p className="mt-3 text-sm text-tertiary-800"><span className="font-medium">Who to approach: </span>{s.decision_makers.join(', ')}</p>}
              {s.approach && <p className="mt-1 text-sm text-tertiary-700"><span className="font-medium">How: </span>{s.approach}</p>}
              {canAsk && s.status !== 'added' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {s.status === 'new' && <button type="button" className="btn-primary text-xs" disabled={acting === s.id} onClick={() => act(s, 'add')} data-testid="suggestion-add">Add as lead</button>}
                  {s.status === 'new' && <button type="button" className="btn-secondary text-xs" disabled={acting === s.id} onClick={() => act(s, 'dismiss')}>Dismiss</button>}
                  {s.status === 'dismissed' && <button type="button" className="btn-secondary text-xs" disabled={acting === s.id} onClick={() => act(s, 'restore')}>Bring back</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
