import { useCallback, useEffect, useState } from 'react';
import { nxApi } from './api.js';

/** Option lists for the forms and filters: the three kinds of category, investments and people. `refresh()` reloads after an add elsewhere. */
export function useNxPickers({ people = true } = {}) {
  const [state, setState] = useState({ categories: [], investmentCategories: [], incomeCategories: [], expenseCategories: [], ownershipTypes: [], formats: [], outlets: [], filterOutlets: [], investments: [], persons: [] });
  const load = useCallback(() => {
    Promise.all([
      nxApi.categories().catch(() => []),
      nxApi.investments({ limit: 200 }).catch(() => ({ data: [] })),
      nxApi.outlets({ include_closed: 'true' }).catch(() => []),
      people ? nxApi.people({ active: 'true' }).catch(() => []) : Promise.resolve([]),
    ]).then(([categories, investments, outlets, persons]) => {
      const opts = (scope) => categories.filter((c) => c.scope === scope && c.active).map((c) => ({ value: c.id, label: c.name }));
      setState({
        categories,
        investmentCategories: opts('investment'),
        incomeCategories: opts('income'),
        expenseCategories: opts('expense'),
        ownershipTypes: opts('ownership_type'),
        formats: opts('format'),
        // forms: a closed outlet takes no new records; filters: every outlet (history stays readable), plus company level.
        outlets: outlets.filter((s) => s.status !== 'closed').map((s) => ({ value: s.id, label: `${s.code} ${s.name}` })),
        filterOutlets: [{ value: 'none', label: 'Company level (no outlet)' }, ...outlets.map((s) => ({ value: s.id, label: `${s.code} ${s.name}${s.status === 'closed' ? ' (closed)' : ''}` }))],
        investments: investments.data.map((i) => ({ value: i.id, label: `${i.code} ${i.name}`, status: i.status, outstanding: i.outstanding_principal })),
        persons: persons.map((p) => ({ value: p.id, label: p.name })),
      });
    });
  }, [people]);
  useEffect(() => { load(); }, [load]);
  return { ...state, refresh: load };
}
