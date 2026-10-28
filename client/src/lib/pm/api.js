import apiClient from '../apiClient.js';

// Project Management (Delphic Global): projects, their tickets, ticket statuses and the (optional) contract links.
const unwrap = (p) => p.then((r) => r.data.data);

export const pmApi = {
  meta: () => unwrap(apiClient.get('/pm/meta')),
  people: () => unwrap(apiClient.get('/pm/people')),
  myTickets: () => unwrap(apiClient.get('/pm/my-tickets')),
  linkableContracts: () => unwrap(apiClient.get('/pm/contracts/linkable')),

  createStatus: (body) => unwrap(apiClient.post('/pm/statuses', body)),
  updateStatus: (id, body) => unwrap(apiClient.patch(`/pm/statuses/${id}`, body)),

  projects: (params) => unwrap(apiClient.get('/pm/projects', { params })),
  project: (id) => unwrap(apiClient.get(`/pm/projects/${id}`)),
  createProject: (body) => unwrap(apiClient.post('/pm/projects', body)),
  updateProject: (id, body) => unwrap(apiClient.patch(`/pm/projects/${id}`, body)),
  deleteProject: (id) => unwrap(apiClient.delete(`/pm/projects/${id}`)),
  members: (id, body) => unwrap(apiClient.post(`/pm/projects/${id}/members`, body)),

  tickets: (id, params) => unwrap(apiClient.get(`/pm/projects/${id}/tickets`, { params })),
  createTicket: (id, body) => unwrap(apiClient.post(`/pm/projects/${id}/tickets`, body)),
  ticket: (id) => unwrap(apiClient.get(`/pm/tickets/${id}`)),
  updateTicket: (id, body) => unwrap(apiClient.patch(`/pm/tickets/${id}`, body)),
  deleteTicket: (id) => unwrap(apiClient.delete(`/pm/tickets/${id}`)),
  comment: (id, body) => unwrap(apiClient.post(`/pm/tickets/${id}/comments`, { body })),
  deleteAttachment: (id) => unwrap(apiClient.delete(`/pm/attachments/${id}`)),

  linkContract: (id, body) => unwrap(apiClient.post(`/pm/projects/${id}/contracts`, body)),
  unlinkContract: (id, contractId) => unwrap(apiClient.delete(`/pm/projects/${id}/contracts/${contractId}`)),
  makePrimary: (id, contractId) => unwrap(apiClient.post(`/pm/projects/${id}/contracts/${contractId}/primary`)),
  copyProgress: (id, contractId) => unwrap(apiClient.post(`/pm/projects/${id}/contracts/${contractId}/copy-progress`)),
};

export const pmError = (e, fallback = 'Something went wrong') => e?.response?.data?.errors?.[0]?.message || e?.response?.data?.message || fallback;

export const PROJECT_STATUS_OPTIONS = [
  { value: 'planning', label: 'Planning' }, { value: 'active', label: 'Active' }, { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' },
];
export const TYPE_OPTIONS = [{ value: 'task', label: 'Task' }, { value: 'bug', label: 'Bug' }, { value: 'change', label: 'Change request' }, { value: 'support', label: 'Support' }];
export const PRIORITY_OPTIONS = [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' }];
export const PRIORITY_TONE = { low: 'gray', medium: 'blue', high: 'amber', urgent: 'red' };
export const CATEGORY_TONE = { todo: 'blue', in_progress: 'purple', blocked: 'red', done: 'green' };
