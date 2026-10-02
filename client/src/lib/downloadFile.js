import apiClient from './apiClient.js';

/** GET a file (e.g. an Excel export) and hand it to the browser as a download. */
export async function downloadFile(path, params, filename) {
  const { data: blob } = await apiClient.get(path, { params, responseType: 'blob' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
