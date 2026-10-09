import { useCallback, useEffect, useState } from 'react';
import { fxApi } from './api.js';

/**
 * Option lists for the Foundation forms and filters: initiatives, spending / funding categories, campaigns and people.
 * `refresh()` reloads after something is added elsewhere.
 */
export function useFxPickers({ people = true } = {}) {
  const [state, setState] = useState({ categories: [], initiatives: [], campaigns: [], managers: [] });
  const load = useCallback(() => {
    Promise.all([
      fxApi.categories().catch(() => []),
      fxApi.campaigns({ limit: 200, sort: 'name', dir: 'asc' }).catch(() => ({ data: [] })),
      people ? fxApi.people({ active: 'true' }).catch(() => []) : Promise.resolve([]),
    ]).then(([categories, campaigns, persons]) => {
      setState({
        categories,
        initiatives: categories.filter((c) => c.scope === 'initiative' && c.active).map((c) => ({ value: c.id, label: c.name })),
        campaigns: campaigns.data.map((c) => ({ value: c.id, label: `${c.code} ${c.name}`, status: c.status })),
        managers: persons.map((p) => ({ value: p.id, label: p.name })),
      });
    });
  }, [people]);
  useEffect(() => { load(); }, [load]);
  return { ...state, refresh: load };
}
