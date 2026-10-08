import { useCallback, useEffect, useState } from 'react';
import { gulatiApi } from './api.js';

/**
 * Option lists for the lead / deal / task forms: clients, vendors, employees and contractors.
 * `refresh()` reloads after a new party or person is added elsewhere.
 */
export function usePickers() {
  const [state, setState] = useState({ clients: [], vendors: [], employees: [], contractors: [], owners: [] });
  const load = useCallback(() => {
    Promise.all([
      gulatiApi.parties({ status: 'active', limit: 200 }).catch(() => ({ data: [] })),
      gulatiApi.people({ active: 'true' }).catch(() => []),
      gulatiApi.owners().catch(() => []),
    ]).then(([parties, people, owners]) => {
      const opt = (r) => ({ value: r.id, label: r.name });
      setState({
        clients: parties.data.filter((p) => p.kind !== 'vendor').map(opt),
        vendors: parties.data.filter((p) => p.kind !== 'client').map(opt),
        employees: people.filter((p) => p.kind === 'employee').map(opt),
        contractors: people.filter((p) => p.kind === 'contractor').map(opt),
        owners: owners.map(opt),
      });
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  return { ...state, refresh: load };
}
