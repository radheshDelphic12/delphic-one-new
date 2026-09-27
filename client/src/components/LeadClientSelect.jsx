import { useMemo } from 'react';
import SearchableSelect from './ui/SearchableSelect.jsx';
import { useLeadClientOptions } from '../lib/lookups.js';

/**
 * Project "Client name" picker — this org's client accounts, any stage.
 *
 * Args:
 *   value: selected account id ('' for none).
 *   onChange: called with the next account id ('' when cleared).
 *   current: the project's already-linked client ({ id, name }) in edit mode.
 *     It stays selectable even if it's no longer offered (e.g. reclassified as
 *     a vendor), so an edit pre-loads it instead of showing a blank field.
 *   excludeId: the project being edited — it can't be its own client.
 *   enabled: fetch the options only while the form is open.
 */
export default function LeadClientSelect({ value, onChange, current = null, excludeId = null, enabled = true }) {
  const clients = useLeadClientOptions(enabled);
  const options = useMemo(() => {
    const list = excludeId ? clients.filter((o) => o.value !== excludeId) : clients;
    if (!current || list.some((o) => o.value === current.id)) return list;
    return [{ value: current.id, label: current.name, hint: 'No longer a client' }, ...list];
  }, [clients, current, excludeId]);

  return (
    <SearchableSelect
      value={value}
      onChange={onChange}
      options={options}
      allowClear
      className="mt-1"
      placeholder="Select a client"
      searchPlaceholder="Search clients…"
      noResultsMessage="No client accounts found — add one under Accounts first"
      ariaLabel="Client name"
    />
  );
}
