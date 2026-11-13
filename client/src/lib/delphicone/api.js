import apiClient from '../apiClient.js';

// Thin wrapper over the Delphic One workspace API (/api/v1/delphic-one). Every call returns the unwrapped `data` payload.
const unwrap = (res) => res.data.data;
const clean = (params) => Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined));
const get = (path, params) => apiClient.get(`/delphic-one${path}`, { params: clean(params) }).then(unwrap);
const post = (path, body) => apiClient.post(`/delphic-one${path}`, body || {}).then(unwrap);
const patch = (path, body) => apiClient.patch(`/delphic-one${path}`, body).then(unwrap);
const del = (path) => apiClient.delete(`/delphic-one${path}`).then(unwrap);

export const doxApi = {
  me: () => get('/me'),
  summary: () => get('/summary'),
  customers: (params) => get('/customers', params),
  createCustomer: (body) => post('/customers', body),
  updateCustomer: (id, body) => patch(`/customers/${id}`, body),
  provisionCustomer: (id) => post(`/customers/${id}/provision`),
  team: () => get('/team'),
  addTeamMember: (body) => post('/team', body),
  updateTeamMember: (id, body) => patch(`/team/${id}`, body),
  deletePreview: (id) => post(`/customers/${id}/delete-preview`),
  softDeleteCustomer: (id, body) => post(`/customers/${id}/delete`, body),
  restorePreview: (id) => post(`/customers/${id}/restore-preview`),
  restoreCustomer: (id, body) => post(`/customers/${id}/restore`, body),
  deleteCustomer: (id) => del(`/customers/${id}`),
  leads: (params) => get('/leads', params),
  createLead: (body) => post('/leads', body),
  updateLead: (id, body) => patch(`/leads/${id}`, body),
  leadNotes: (id) => get(`/leads/${id}/notes`),
  addLeadNote: (id, body) => post(`/leads/${id}/notes`, body),
  convertLead: (id, body) => post(`/leads/${id}/convert`, body),
  deleteLead: (id) => del(`/leads/${id}`),
  invoices: (params) => get('/invoices', params),
  createInvoice: (body) => post('/invoices', body),
  updateInvoice: (id, body) => patch(`/invoices/${id}`, body),
  cancelInvoice: (id, reason) => post(`/invoices/${id}/cancel`, { reason }),
  payments: (id) => get(`/invoices/${id}/payments`),
  addPayment: (id, body) => post(`/invoices/${id}/payments`, body),
  removePayment: (id, paymentId) => del(`/invoices/${id}/payments/${paymentId}`),
};
