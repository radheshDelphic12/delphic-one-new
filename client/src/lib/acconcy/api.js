import apiClient from '../apiClient.js';

// Thin wrapper over the Acconcy API (/api/v1/acconcy). Every call returns the unwrapped `data` payload.
const unwrap = (res) => res.data.data;
const get = (path, params) => apiClient.get(`/acconcy${path}`, { params }).then(unwrap);
const post = (path, body) => apiClient.post(`/acconcy${path}`, body || {}).then(unwrap);
const patch = (path, body) => apiClient.patch(`/acconcy${path}`, body).then(unwrap);
const del = (path, params) => apiClient.delete(`/acconcy${path}`, { params }).then(unwrap);

export const acconcyApi = {
  me: () => get('/me'),
  serviceTypes: () => get('/service-types'),
  settings: () => get('/settings'),
  updateSettings: (body) => patch('/settings', body),
  categories: (kind) => get('/categories', kind ? { kind } : {}),
  createCategory: (body) => post('/categories', body),
  updateCategory: (id, body) => patch(`/categories/${id}`, body),
  deleteCategory: (id) => del(`/categories/${id}`),
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

  parties: (params) => apiClient.get('/acconcy/parties', { params }).then((res) => res.data),
  createParty: (body) => post('/parties', body),
  updateParty: (id, body) => patch(`/parties/${id}`, body),
  deleteParty: (id) => del(`/parties/${id}`),
  importParties: (rows) => post('/parties/import', { rows }),
  partyStatement: (id) => get(`/parties/${id}/statement`),

  leads: (params) => get('/leads', params),
  leadSummary: (params) => get('/leads/summary', params),
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

  ledger: (params) => apiClient.get('/acconcy/ledger', { params }).then((res) => res.data),
  createEntry: (body) => post('/ledger', body),
  updateEntry: (id, body) => patch(`/ledger/${id}`, body),
  deleteEntry: (id, reason) => del(`/ledger/${id}`, reason ? { reason } : {}),

  tasks: (params) => get('/tasks', params),
  createTask: (body) => post('/tasks', body),
  updateTask: (id, body) => patch(`/tasks/${id}`, body),
  deleteTask: (id) => del(`/tasks/${id}`),
  myWork: () => get('/my-work'),

  dashboard: (params) => get('/dashboard', params),
  overview: (params) => get('/finance/overview', params),
  pnl: (params) => get('/finance/pnl', params),
  serviceReport: (params) => get('/finance/service-report', params),
  investmentReport: (params) => get('/finance/investments', params),
  valuation: (params) => get('/finance/valuation', params),
  valuationHistory: () => get('/finance/valuation/history'),
  recordValuation: (body) => post('/finance/valuation/record', body),
  periods: () => get('/finance/periods'),
  closeMonth: (month, body) => post(`/finance/periods/${month}/close`, body),
  reopenMonth: (month, body) => post(`/finance/periods/${month}/reopen`, body),

  investments: (params) => apiClient.get('/acconcy/investments', { params }).then((res) => res.data),
  investment: (id) => get(`/investments/${id}`),
  createInvestment: (body) => post('/investments', body),
  updateInvestment: (id, body) => patch(`/investments/${id}`, body),
  deleteInvestment: (id, reason) => del(`/investments/${id}`, reason ? { reason } : {}),
  realiseInvestment: (id, body) => post(`/investments/${id}/realise`, body),
  deleteRealisation: (id, rid, reason) => del(`/investments/${id}/realisations/${rid}`, reason ? { reason } : {}),
  assets: (params) => apiClient.get('/acconcy/assets', { params }).then((res) => res.data),
  createAsset: (body) => post('/assets', body),
  updateAsset: (id, body) => patch(`/assets/${id}`, body),
  deleteAsset: (id, reason) => del(`/assets/${id}`, reason ? { reason } : {}),

  salaries: (params) => apiClient.get('/acconcy/salaries', { params }).then((res) => res.data),
  generateSalaries: (body) => post('/salaries/generate', body),
  updateSalary: (id, body) => patch(`/salaries/${id}`, body),
  approveSalary: (id) => post(`/salaries/${id}/approve`),
  unapproveSalary: (id, body) => post(`/salaries/${id}/unapprove`, body),
  paySalary: (id, body) => post(`/salaries/${id}/pay`, body),
  deleteSalary: (id, reason) => del(`/salaries/${id}`, reason ? { reason } : {}),

  leadReport: (params) => get('/reports/leads', params),
  dealReport: (params) => get('/reports/deals', params),

  documents: (owner_type, owner_id) => get('/documents', { owner_type, owner_id }),
  uploadDocument: (form) => apiClient.post('/acconcy/documents', form).then(unwrap),
  updateDocument: (id, body) => patch(`/documents/${id}`, body),
  deleteDocument: (id) => del(`/documents/${id}`),
};

export function acconcyError(error, fallback = 'Something went wrong') {
  const data = error?.response?.data;
  return data?.errors?.[0]?.message || data?.message || fallback;
}
