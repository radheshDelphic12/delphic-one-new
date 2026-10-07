import apiClient from '../apiClient.js';

// Thin wrapper over the Gulati API (/api/v1/gulati). Every call returns the unwrapped `data` payload.
const unwrap = (res) => res.data.data;
const get = (path, params) => apiClient.get(`/gulati${path}`, { params }).then(unwrap);
const post = (path, body) => apiClient.post(`/gulati${path}`, body || {}).then(unwrap);
const patch = (path, body) => apiClient.patch(`/gulati${path}`, body).then(unwrap);
const del = (path, params) => apiClient.delete(`/gulati${path}`, { params }).then(unwrap);

export const gulatiApi = {
  me: () => get('/me'),
  settings: () => get('/settings'),
  updateSettings: (body) => patch('/settings', body),
  categories: (kind) => get('/categories', kind ? { kind } : {}),
  createCategory: (body) => post('/categories', body),
  updateCategory: (id, body) => patch(`/categories/${id}`, body),
  deleteCategory: (id) => del(`/categories/${id}`),
  units: () => get('/units'),
  createUnit: (body) => post('/units', body),
  updateUnit: (id, body) => patch(`/units/${id}`, body),
  deleteUnit: (id) => del(`/units/${id}`),
  tradingTypes: () => get('/trading-types'),
  createTradingType: (body) => post('/trading-types', body),
  updateTradingType: (key, body) => patch(`/trading-types/${key}`, body),
  audit: (params) => get('/audit', params),
  company: () => get('/company'),
  updateCompany: (body) => patch('/company', body),
  users: (params) => get('/users', params),
  createUser: (body) => post('/users', body),
  updateUser: (id, body) => patch(`/users/${id}`, body),
  setUserActive: (id, body) => post(`/users/${id}/status`, body),

  people: (params) => get('/people', params),
  owners: () => get('/owners'),
  createPerson: (body) => post('/people', body),
  updatePerson: (id, body) => patch(`/people/${id}`, body),
  deletePerson: (id) => del(`/people/${id}`),

  parties: (params) => apiClient.get('/gulati/parties', { params }).then((res) => res.data),
  createParty: (body) => post('/parties', body),
  updateParty: (id, body) => patch(`/parties/${id}`, body),
  deleteParty: (id) => del(`/parties/${id}`),
  importParties: (rows) => post('/parties/import', { rows }),
  partyStatement: (id) => get(`/parties/${id}/statement`),

  leads: (params) => get('/leads', params),
  leadSummary: () => get('/leads/summary'),
  leadFollowUps: () => get('/leads/follow-ups'),
  lead: (id) => get(`/leads/${id}`),
  createLead: (body) => post('/leads', body),
  updateLead: (id, body) => patch(`/leads/${id}`, body),
  deleteLead: (id) => del(`/leads/${id}`),
  moveLead: (id, body) => post(`/leads/${id}/stage`, body),
  reopenLead: (id, body) => post(`/leads/${id}/reopen`, body),
  convertLead: (id, body) => post(`/leads/${id}/convert`, body),
  leadActivities: (id) => get(`/leads/${id}/activities`),
  addLeadActivity: (id, body) => post(`/leads/${id}/activities`, body),
  updateLeadActivity: (id, aid, body) => patch(`/leads/${id}/activities/${aid}`, body),
  deleteLeadActivity: (id, aid) => del(`/leads/${id}/activities/${aid}`),

  deals: (params) => get('/deals', params),
  deal: (id) => get(`/deals/${id}`),
  createDeal: (body) => post('/deals', body),
  updateDeal: (id, body) => patch(`/deals/${id}`, body),
  deleteDeal: (id) => del(`/deals/${id}`),
  setDealStatus: (id, body) => post(`/deals/${id}/status`, body),
  createPurchase: (id, body) => post(`/deals/${id}/purchases`, body),
  updatePurchase: (id, lid, body) => patch(`/deals/${id}/purchases/${lid}`, body),
  deletePurchase: (id, lid, reason) => del(`/deals/${id}/purchases/${lid}`, reason ? { reason } : {}),
  createSale: (id, body) => post(`/deals/${id}/sales`, body),
  updateSale: (id, lid, body) => patch(`/deals/${id}/sales/${lid}`, body),
  deleteSale: (id, lid, reason) => del(`/deals/${id}/sales/${lid}`, reason ? { reason } : {}),
  payPurchase: (id, lid, body) => post(`/deals/${id}/purchases/${lid}/payments`, body),
  paySale: (id, lid, body) => post(`/deals/${id}/sales/${lid}/payments`, body),
  updatePayment: (id, pid, body) => patch(`/deals/${id}/payments/${pid}`, body),
  deletePayment: (id, pid, reason) => del(`/deals/${id}/payments/${pid}`, reason ? { reason } : {}),

  ledger: (params) => apiClient.get('/gulati/ledger', { params }).then((res) => res.data),
  createEntry: (body) => post('/ledger', body),
  updateEntry: (id, body) => patch(`/ledger/${id}`, body),
  deleteEntry: (id, reason) => del(`/ledger/${id}`, reason ? { reason } : {}),

  tasks: (params) => get('/tasks', params),
  createTask: (body) => post('/tasks', body),
  updateTask: (id, body) => patch(`/tasks/${id}`, body),
  deleteTask: (id) => del(`/tasks/${id}`),
  myWork: () => get('/my-work'),

  dashboard: () => get('/dashboard'),
  overview: (params) => get('/finance/overview', params),
  pnl: (params) => get('/finance/pnl', params),
  tradingReport: (params) => get('/finance/trading-report', params),
  periods: () => get('/finance/periods'),
  closeMonth: (month, body) => post(`/finance/periods/${month}/close`, body),
  reopenMonth: (month, body) => post(`/finance/periods/${month}/reopen`, body),

  documents: (owner_type, owner_id) => get('/documents', { owner_type, owner_id }),
  uploadDocument: (form) => apiClient.post('/gulati/documents', form).then(unwrap),
  updateDocument: (id, body) => patch(`/documents/${id}`, body),
  deleteDocument: (id) => del(`/documents/${id}`),
};

export function gulatiError(error, fallback = 'Something went wrong') {
  const data = error?.response?.data;
  return data?.errors?.[0]?.message || data?.message || fallback;
}
