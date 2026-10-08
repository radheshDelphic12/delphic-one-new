import { useEffect, useState } from 'react';
import { compact } from '../format.js';
import { gulatiApi } from './api.js';

export const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
/** Lakh / Crore display (₹90L, ₹1Cr); the full amount goes in a tooltip via <Money>. */
export const inrShort = (v) => `${Number(v) < 0 ? '-' : ''}₹${compact(Math.abs(Number(v || 0)))}`;
export const pctLabel = (v) => (v === null || v === undefined ? '-' : `${v}%`);
export const qtyLabel = (v, unit) => (v === null || v === undefined ? '-' : `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`);

export const LEAD_STAGES = [
  { value: 'new', label: 'New', tone: 'blue' },
  { value: 'in_discussion', label: 'In discussion', tone: 'blue' },
  { value: 'negotiation', label: 'Negotiation', tone: 'amber' },
  { value: 'sourcing', label: 'Sourcing', tone: 'purple' },
  { value: 'proposal_order', label: 'Proposal / order', tone: 'cyan' },
  { value: 'won', label: 'Won', tone: 'green' },
  { value: 'on_hold', label: 'On hold', tone: 'gray' },
  { value: 'dropped', label: 'Dropped', tone: 'red' },
  { value: 'closed', label: 'Closed', tone: 'gray' },
];
export const OPEN_STAGES = ['new', 'in_discussion', 'negotiation', 'sourcing', 'proposal_order', 'on_hold'];
export const DONE_STAGES = ['won', 'dropped', 'closed'];
export const STAGE_META = Object.fromEntries(LEAD_STAGES.map((s) => [s.value, s]));

export const DEAL_STATUSES = [
  { value: 'planned', label: 'Planned', tone: 'blue' },
  { value: 'sourcing', label: 'Sourcing', tone: 'purple' },
  { value: 'purchase_pending', label: 'Purchase pending', tone: 'amber' },
  { value: 'material_sourced', label: 'Material sourced', tone: 'cyan' },
  { value: 'ready_for_supply', label: 'Ready for supply', tone: 'cyan' },
  { value: 'supplied', label: 'Supplied', tone: 'green' },
  { value: 'completed', label: 'Completed', tone: 'green' },
  { value: 'on_hold', label: 'On hold', tone: 'gray' },
  { value: 'cancelled', label: 'Cancelled', tone: 'red' },
];
export const DEAL_STATUS_META = Object.fromEntries(DEAL_STATUSES.map((s) => [s.value, s]));

export const PAY_STATE = { unpaid: { label: 'Unpaid', tone: 'red' }, partial: { label: 'Partly paid', tone: 'amber' }, paid: { label: 'Paid', tone: 'green' } };
export const TASK_STATUSES = [
  { value: 'pending', label: 'Pending', tone: 'amber' },
  { value: 'in_progress', label: 'In progress', tone: 'blue' },
  { value: 'done', label: 'Done', tone: 'green' },
  { value: 'cancelled', label: 'Cancelled', tone: 'gray' },
];
export const TASK_STATUS_META = Object.fromEntries(TASK_STATUSES.map((s) => [s.value, s]));
export const PRIORITIES = [
  { value: 'low', label: 'Low', tone: 'gray' },
  { value: 'medium', label: 'Medium', tone: 'blue' },
  { value: 'high', label: 'High', tone: 'red' },
];
export const PRIORITY_META = Object.fromEntries(PRIORITIES.map((s) => [s.value, s]));
export const TASK_TYPES = [
  ['client_follow_up', 'Client follow-up'], ['vendor_sourcing', 'Vendor sourcing'], ['deal_coordination', 'Deal coordination'],
  ['material_verification', 'Material verification'], ['purchase_coordination', 'Purchase coordination'], ['delivery_coordination', 'Delivery coordination'],
  ['payment_follow_up', 'Payment follow-up'], ['documentation', 'Documentation'], ['deal_closure', 'Deal closure'], ['other', 'Other'],
].map(([value, label]) => ({ value, label }));
export const TASK_TYPE_LABEL = Object.fromEntries(TASK_TYPES.map((t) => [t.value, t.label]));

// Trading types and units are admin-editable master data: load once and share.
let cache = null;
let inflight = null;
function loadMasters() {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = Promise.all([gulatiApi.tradingTypes(), gulatiApi.units()]).then(
      ([types, units]) => {
        cache = { types, units };
        inflight = null;
        return cache;
      },
      (e) => {
        inflight = null;
        throw e;
      }
    );
  }
  return inflight;
}
export function resetMasters() {
  cache = null;
}
export function useMasters() {
  const [m, setM] = useState(cache || { types: [], units: [] });
  useEffect(() => {
    let live = true;
    loadMasters().then((x) => live && setM(x), () => {});
    return () => {
      live = false;
    };
  }, []);
  const label = (key) => m.types.find((t) => t.key === key)?.label || key || '-';
  return { types: m.types, units: m.units, activeTypes: m.types.filter((t) => t.active), activeUnits: m.units.filter((u) => u.active), typeLabel: label };
}
