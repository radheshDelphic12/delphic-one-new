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

/** POST a body (e.g. a list of invoice ids) and hand the PDF / file that comes back to the browser as a download. */
export async function downloadFilePost(path, body, filename) {
  const { data: blob } = await apiClient.post(path, body, { responseType: 'blob' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
