import { useEffect, useState } from 'react';
import { Building2, Handshake, HardHat, KeyRound, Paintbrush } from 'lucide-react';
import { useAuth } from '../authContext.jsx';
import { zephyrApi } from './api.js';

// The five Zephyr services. Keys match the server (serviceTypes.js); labels come from the company's
// own settings (GET /zephyr/service-types) and fall back to these defaults.
export const SERVICES = [
  { key: 'civil_construction', label: 'Civil Construction', short: 'Civil', icon: HardHat, tone: 'amber' },
  { key: 'interior_design', label: 'Interior Design', short: 'Interior', icon: Paintbrush, tone: 'purple' },
  { key: 'property_management', label: 'Property Management', short: 'Management', icon: KeyRound, tone: 'blue' },
  { key: 'property_trading', label: 'Property Trading', short: 'Trading', icon: Building2, tone: 'green' },
  { key: 'real_estate_consulting', label: 'Real Estate Consulting', short: 'Consulting', icon: Handshake, tone: 'cyan' },
];
export const SERVICE_META = Object.fromEntries(SERVICES.map((s) => [s.key, s]));

const cache = new Map();

/** Service list for the active company with admin-edited labels. */
export function useServiceTypes() {
  const { user } = useAuth();
  const orgId = user?.active_org?.id || null;
  const [rows, setRows] = useState(() => (orgId ? cache.get(orgId) || null : null));
  useEffect(() => {
    if (!orgId) return undefined;
    if (cache.has(orgId)) {
      setRows(cache.get(orgId));
      return undefined;
    }
    let live = true;
    zephyrApi.serviceTypes().then(
      (data) => {
        cache.set(orgId, data);
        if (live) setRows(data);
      },
      () => live && setRows([])
    );
    return () => {
      live = false;
    };
  }, [orgId]);
  const services = SERVICES.map((s) => {
    const row = rows?.find((r) => r.key === s.key);
    return { ...s, label: row?.label || s.label, active: row ? row.active : true, sort_order: row?.sort_order ?? 0 };
  }).sort((a, b) => a.sort_order - b.sort_order);
  const label = (key) => services.find((s) => s.key === key)?.label || (key ? key : 'No service');
  return { services, label, active: services.filter((s) => s.active), refresh: () => { cache.delete(orgId); } };
}

export const LEAD_STAGES = [
  { key: 'new', label: 'New', tone: 'blue' },
  { key: 'in_discussion', label: 'In discussion', tone: 'cyan' },
  { key: 'negotiation', label: 'Proposal / negotiation', short: 'Negotiation', tone: 'amber' },
  { key: 'on_hold', label: 'On hold', tone: 'gray' },
  { key: 'won', label: 'Won', tone: 'green' },
  { key: 'closed', label: 'Closed', tone: 'gray' },
  { key: 'dropped', label: 'Dropped', tone: 'red' },
];
export const STAGE_META = Object.fromEntries(LEAD_STAGES.map((s) => [s.key, s]));
export const OPEN_STAGE_KEYS = ['new', 'in_discussion', 'negotiation', 'on_hold'];
export const DONE_STAGE_KEYS = ['won', 'closed', 'dropped'];

/** Free-form label/value rows <-> the form's editable list. */
export const blankDetail = () => ({ label: '', value: '' });
