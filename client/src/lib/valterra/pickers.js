import { useCallback, useEffect, useState } from 'react';
import { vtApi } from './api.js';

/** Option lists for the forms and filters: the three kinds of category, investments and people. `refresh()` reloads after an add elsewhere. */
export function useVtPickers({ people = true } = {}) {
  const [state, setState] = useState({ categories: [], investmentCategories: [], incomeCategories: [], expenseCategories: [], miningTypes: [], materials: [], sites: [], filterSites: [], investments: [], persons: [] });
  const load = useCallback(() => {
    Promise.all([
      vtApi.categories().catch(() => []),
      vtApi.investments({ limit: 200 }).catch(() => ({ data: [] })),
      vtApi.sites({ include_closed: 'true' }).catch(() => []),
      people ? vtApi.people({ active: 'true' }).catch(() => []) : Promise.resolve([]),
    ]).then(([categories, investments, sites, persons]) => {
      const opts = (scope) => categories.filter((c) => c.scope === scope && c.active).map((c) => ({ value: c.id, label: c.name }));
      setState({
        categories,
        investmentCategories: opts('investment'),
        incomeCategories: opts('income'),
        expenseCategories: opts('expense'),
        miningTypes: opts('mining_type'),
        materials: opts('material'),
        // forms: a closed site takes no new records; filters: every site (history stays readable), plus company level.
        sites: sites.filter((s) => s.status !== 'closed').map((s) => ({ value: s.id, label: `${s.code} ${s.name}` })),
        filterSites: [{ value: 'none', label: 'Company level (no site)' }, ...sites.map((s) => ({ value: s.id, label: `${s.code} ${s.name}${s.status === 'closed' ? ' (closed)' : ''}` }))],
        investments: investments.data.map((i) => ({ value: i.id, label: `${i.code} ${i.name}`, status: i.status, outstanding: i.outstanding_principal })),
        persons: persons.map((p) => ({ value: p.id, label: p.name })),
      });
    });
  }, [people]);
  useEffect(() => { load(); }, [load]);
  return { ...state, refresh: load };
}
