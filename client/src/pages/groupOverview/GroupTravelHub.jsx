import { useSearchParams } from 'react-router-dom';
import GroupTravelTab from './GroupTravelTab.jsx';
import DeploymentsTab from './deployments/DeploymentsTab.jsx';
import SectionTabs from '../../components/ui/SectionTabs.jsx';

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
      <SectionTabs tabs={SUBS.map(([key, label]) => ({ key, label }))} value={sub} onChange={pick} />
      {sub === 'trips' ? <GroupTravelTab /> : <DeploymentsTab />}
    </div>
  );
}
