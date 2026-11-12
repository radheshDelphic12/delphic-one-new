import { useCallback, useEffect, useState } from 'react';
import { zkApi } from './api.js';

/** Option lists for the forms and filters: the three kinds of category, investments and people. `refresh()` reloads after an add elsewhere. */
export function useZkPickers({ people = true } = {}) {
  const [state, setState] = useState({ categories: [], investmentCategories: [], incomeCategories: [], expenseCategories: [], investments: [], persons: [] });
  const load = useCallback(() => {
    Promise.all([
      zkApi.categories().catch(() => []),
      zkApi.investments({ limit: 200 }).catch(() => ({ data: [] })),
      people ? zkApi.people({ active: 'true' }).catch(() => []) : Promise.resolve([]),
    ]).then(([categories, investments, persons]) => {
      const opts = (scope) => categories.filter((c) => c.scope === scope && c.active).map((c) => ({ value: c.id, label: c.name }));
      setState({
        categories,
        investmentCategories: opts('investment'),
        incomeCategories: opts('income'),
        expenseCategories: opts('expense'),
        investments: investments.data.map((i) => ({ value: i.id, label: `${i.code} ${i.name}`, status: i.status, outstanding: i.outstanding_principal })),
        persons: persons.map((p) => ({ value: p.id, label: p.name })),
      });
    });
  }, [people]);
  useEffect(() => { load(); }, [load]);
  return { ...state, refresh: load };
}
