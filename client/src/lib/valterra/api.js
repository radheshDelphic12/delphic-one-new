import { trackInWallet } from '../payments/trackInWallet.js';
import apiClient from '../apiClient.js';

// Thin wrapper over the Valterra Resources API (/api/v1/valterra). Every call returns the unwrapped `data` payload.
const unwrap = (res) => res.data.data;
const clean = (params) => Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined));
const get = (path, params) => apiClient.get(`/valterra${path}`, { params: clean(params) }).then(unwrap);
const getPage = (path, params) => apiClient.get(`/valterra${path}`, { params: clean(params) }).then((res) => res.data);
const post = (path, body) => apiClient.post(`/valterra${path}`, body || {}).then(unwrap);
const patch = (path, body) => apiClient.patch(`/valterra${path}`, body).then(unwrap);
const del = (path, params) => apiClient.delete(`/valterra${path}`, { params: clean(params) }).then(unwrap);

export const vtApi = {
  me: () => get('/me'),
  settings: () => get('/settings'),
  updateSettings: (body) => patch('/settings', body),
  categories: (scope) => get('/categories', scope ? { scope } : {}),
  createCategory: (body) => post('/categories', body),
  updateCategory: (id, body) => patch(`/categories/${id}`, body),
  deleteCategory: (id) => del(`/categories/${id}`),
  audit: (params) => get('/audit', params),
  users: (params) => get('/users', params),
  createUser: (body) => post('/users', body),
  updateUser: (id, body) => patch(`/users/${id}`, body),
  setUserActive: (id, body) => post(`/users/${id}/status`, body),

  sites: (params) => get('/sites', params),
  site: (id) => get(`/sites/${id}`),
  createSite: (body) => post('/sites', body),
  updateSite: (id, body) => patch(`/sites/${id}`, body),
  siteDashboard: (id, params) => get(`/sites/${id}/dashboard`, params),

  people: (params) => get('/people', params),
  createPerson: (body) => post('/people', body),
  updatePerson: (id, body) => patch(`/people/${id}`, body),
  deletePerson: (id) => del(`/people/${id}`),

  investments: (params) => getPage('/investments', params),
  investment: (id) => get(`/investments/${id}`),
  createInvestment: (body) => post('/investments', body),
  updateInvestment: (id, body) => patch(`/investments/${id}`, body),
  deleteInvestment: (id, reason) => del(`/investments/${id}`, reason ? { reason } : {}),
  addReturn: (id, body) => post(`/investments/${id}/returns`, body),
  updateReturn: (id, body) => patch(`/returns/${id}`, body),
  deleteReturn: (id, reason) => del(`/returns/${id}`, reason ? { reason } : {}),

  entries: (params) => getPage('/entries', params),
  createEntry: async (body) => {
    const r = await post('/entries', body);
    if (['income', 'expense', 'salary'].includes(body?.kind) && (body.payment_status || 'paid') === 'paid') {
      await trackInWallet({ kind: body.kind === 'income' ? 'ledger_income' : 'ledger_expense', reference_id: r?.id, amount: r?.amount ?? body.amount, title: body.kind === 'income' ? 'Income received' : 'Payment made', category: body.kind === 'salary' ? 'Salary' : undefined });
    }
    return r;
  },
  updateEntry: (id, body) => patch(`/entries/${id}`, body),
  deleteEntry: (id, reason) => del(`/entries/${id}`, reason ? { reason } : {}),

  projections: (params) => get('/projections', params),
  projectionCompare: (params) => get('/projections/compare', params),
  createProjection: (body) => post('/projections', body),
  updateProjection: (id, body) => patch(`/projections/${id}`, body),
  deleteProjection: (id) => del(`/projections/${id}`),

  dashboard: (params) => get('/dashboard', params),
  monthlyReport: (params) => get('/monthly-report', params),
  transactions: (params) => getPage('/transactions', params),
  report: (params) => get('/reports', params),
  valuation: (params) => get('/finance/valuation', params),
  periods: () => get('/finance/periods'),
  closeMonth: (month, body) => post(`/finance/periods/${month}/close`, body),
  reopenMonth: (month, body) => post(`/finance/periods/${month}/reopen`, body),
};

/** The message to show for a failed call. */
export function valterraError(error, fallback = 'Something went wrong') {
  const data = error?.response?.data;
  return data?.errors?.[0]?.message || data?.message || fallback;
}
