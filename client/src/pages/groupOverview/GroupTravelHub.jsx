import { useSearchParams } from 'react-router-dom';
import GroupTravelTab from './GroupTravelTab.jsx';
import DeploymentsTab from './deployments/DeploymentsTab.jsx';

// Group Dashboard > Travel: short trips for meetings (the original screen) and client onsite deployments of people, with their budgets,
// approvals, expenses and onsite work (Deployments).
const SUBS = [['trips', 'Trips'], ['deployments', 'Client deployments']];

export default function GroupTravelHub() {
  const [params, setParams] = useSearchParams();
  const sub = params.get('sub') === 'deployments' ? 'deployments' : 'trips';
  const pick = (key) => {
    const next = new URLSearchParams(params);
    if (key === 'trips') next.delete('sub'); else next.set('sub', key);
    setParams(next, { replace: true });
  };
  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b" role="tablist" aria-label="Travel sections">
        {SUBS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={sub === k} onClick={() => pick(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${sub === k ? 'border-primary-600 text-primary-700' : 'border-transparent text-tertiary-500 hover:text-tertiary-800'}`}>{label}</button>
        ))}
      </div>
      {sub === 'trips' ? <GroupTravelTab /> : <DeploymentsTab />}
    </div>
  );
}
