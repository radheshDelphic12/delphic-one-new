import apiClient from '../apiClient.js';

// Thin wrapper over the Gulati Foundation API (/api/v1/foundation). Every call returns the unwrapped `data` payload.
const unwrap = (res) => res.data.data;
const get = (path, params) => apiClient.get(`/foundation${path}`, { params }).then(unwrap);
const post = (path, body) => apiClient.post(`/foundation${path}`, body || {}).then(unwrap);
const put = (path, body) => apiClient.put(`/foundation${path}`, body || {}).then(unwrap);
const patch = (path, body) => apiClient.patch(`/foundation${path}`, body).then(unwrap);
const del = (path, params) => apiClient.delete(`/foundation${path}`, { params }).then(unwrap);
const clean = (params) => Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined));

export const fxApi = {
  me: () => get('/me'),
  settings: () => get('/settings'),
  updateSettings: (body) => patch('/settings', body),
  categories: (scope) => get('/categories', scope ? { scope } : {}),
  createCategory: (body) => post('/categories', body),
  updateCategory: (id, body) => patch(`/categories/${id}`, body),
  deleteCategory: (id) => del(`/categories/${id}`),
  audit: (params) => get('/audit', clean(params)),
  users: (params) => get('/users', params),
  createUser: (body) => post('/users', body),
  updateUser: (id, body) => patch(`/users/${id}`, body),
  setUserActive: (id, body) => post(`/users/${id}/status`, body),

  people: (params) => get('/people', clean(params)),
  createPerson: (body) => post('/people', body),
  updatePerson: (id, body) => patch(`/people/${id}`, body),
  deletePerson: (id) => del(`/people/${id}`),

  campaigns: (params) => apiClient.get('/foundation/campaigns', { params: clean(params) }).then((res) => res.data),
  campaign: (id) => get(`/campaigns/${id}`),
  createCampaign: (body) => post('/campaigns', body),
  updateCampaign: (id, body) => patch(`/campaigns/${id}`, body),
  setCampaignStatus: (id, body) => post(`/campaigns/${id}/status`, body),
  reviseBudget: (id, body) => post(`/campaigns/${id}/budget`, body),
  setPlan: (id, rows) => put(`/campaigns/${id}/plan`, { rows }),
  deleteCampaign: (id) => del(`/campaigns/${id}`),

  entries: (params) => apiClient.get('/foundation/entries', { params: clean(params) }).then((res) => res.data),
  createEntry: (body) => post('/entries', body),
  updateEntry: (id, body) => patch(`/entries/${id}`, body),
  setEntryStatus: (id, body) => post(`/entries/${id}/status`, body),
  deleteEntry: (id, reason) => del(`/entries/${id}`, reason ? { reason } : {}),

  dashboard: (params) => get('/dashboard', clean(params)),
  report: (params) => get('/reports', clean(params)),
  valuation: (params) => get('/finance/valuation', clean(params)),
  periods: () => get('/finance/periods'),
  closeMonth: (month, body) => post(`/finance/periods/${month}/close`, body),
  reopenMonth: (month, body) => post(`/finance/periods/${month}/reopen`, body),
};

/** The message to show for a failed call; an over-budget refusal explains itself with the numbers the server sent. */
export function foundationError(error, fallback = 'Something went wrong') {
  const data = error?.response?.data;
  return data?.errors?.[0]?.message || data?.message || fallback;
}
/** { code, detail } when the server refused a spend because it would pass the budget. */
export const overBudgetOf = (error) => {
  const data = error?.response?.data;
  return data && ['over_budget', 'override_reason_required'].includes(data.code) ? { code: data.code, detail: data.detail } : null;
};
