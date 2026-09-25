import axios from 'axios';

const apiClient = axios.create({ baseURL: '/api/v1' });

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

function clearSessionAndRedirect() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

// Shared so a burst of concurrent 401s triggers only one refresh call.
let refreshPromise = null;

// 403s from middleware/auth.js that a refresh can cure: an access token issued
// before multi-company tenancy has no org_id, and a token whose membership was
// ended carries a stale one. /auth/refresh re-resolves the user's current
// membership, so retry once instead of treating the session as dead.
const ORG_CONTEXT_403 = new Set(['No active org membership', 'Active organization membership required']);

function needsRefresh(error) {
  const status = error.response?.status;
  if (status === 401) return true;
  return status === 403 && ORG_CONTEXT_403.has(error.response?.data?.message);
}

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    if (!needsRefresh(error) || !original || original._retry) {
      return Promise.reject(error);
    }

    // A 401 from the refresh endpoint itself means the refresh token is dead.
    if (String(original.url || '').includes('/auth/refresh')) {
      clearSessionAndRedirect();
      return Promise.reject(error);
    }

    original._retry = true;
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) {
      clearSessionAndRedirect();
      return Promise.reject(error);
    }

    try {
      if (!refreshPromise) {
        refreshPromise = axios
          .post('/api/v1/auth/refresh', { refresh_token: refreshToken })
          .then(({ data }) => {
            localStorage.setItem('access_token', data.data.access_token);
            localStorage.setItem('refresh_token', data.data.refresh_token);
            return data.data.access_token;
          })
          .finally(() => {
            refreshPromise = null;
          });
      }
      const accessToken = await refreshPromise;
      original.headers = original.headers || {};
      original.headers.Authorization = `Bearer ${accessToken}`;
      return apiClient(original);
    } catch {
      clearSessionAndRedirect();
      return Promise.reject(error);
    }
  }
);

/**
 * Download a protected /uploads file with the bearer token and open it in a new tab.
 */
/** Fetch a protected /uploads file with the bearer token and return the Blob. */
export async function fetchAuthenticatedBlob(fileUrl) {
  const token = localStorage.getItem('access_token');
  const response = await fetch(fileUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch file (${response.status})`);
  }
  return response.blob();
}

/** Fetch a protected /uploads file with the bearer token and open it in a new tab (inline view). */
export async function openAuthenticatedFile(fileUrl) {
  const blob = await fetchAuthenticatedBlob(fileUrl);
  const objectUrl = URL.createObjectURL(blob);
  window.open(objectUrl, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

/** Fetch a protected /uploads file with the bearer token and save it with the given filename. */
export async function downloadAuthenticatedFile(fileUrl, filename) {
  const blob = await fetchAuthenticatedBlob(fileUrl);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename || fileUrl.split('/').pop() || 'download';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export default apiClient;
