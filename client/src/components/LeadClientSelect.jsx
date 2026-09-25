import { useMemo } from 'react';
import SearchableSelect from './ui/SearchableSelect.jsx';
import { useLeadClientOptions } from '../lib/lookups.js';

/**
 * Project "Client name" picker — this org's Lead accounts only.
 *
 * Args:
 *   value: selected account id ('' for none).
 *   onChange: called with the next account id ('' when cleared).
 *   current: the project's already-linked client ({ id, name }) in edit mode.
 *     It stays selectable even once that account has left the Lead stage, so
 *     an edit pre-loads it instead of showing a blank field.
 *   enabled: fetch the options only while the form is open.
 */
export default function LeadClientSelect({ value, onChange, current = null, enabled = true }) {
  const leads = useLeadClientOptions(enabled);
  const options = useMemo(() => {
    if (!current || leads.some((o) => o.value === current.id)) return leads;
    return [{ value: current.id, label: current.name, hint: 'No longer a lead' }, ...leads];
  }, [leads, current]);

  return (
    <SearchableSelect
      value={value}
      onChange={onChange}
      options={options}
      allowClear
      className="mt-1"
      placeholder="Select a lead account"
      searchPlaceholder="Search leads…"
      noResultsMessage="No Lead accounts found — add one under Accounts first"
      ariaLabel="Client name"
    />
  );
}
