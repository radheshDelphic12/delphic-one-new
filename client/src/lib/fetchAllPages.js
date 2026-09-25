import apiClient from './apiClient.js';

/**
 * Pages through a paginated list endpoint (`{ data, pagination: { totalPages } }`)
 * until every row is collected, instead of settling for the first page's `limit`
 * cap — a picker built from just page 1 silently hides anything past the cap.
 * Guarded so a bad/looping response can't run forever.
 */
export async function fetchAllPages(path, params = {}) {
  const out = [];
  for (let page = 1; page <= 200; page += 1) {
    const { data } = await apiClient.get(path, { params: { ...params, limit: 100, page } });
    const rows = data.data || [];
    out.push(...rows);
    const totalPages = data.pagination?.totalPages ?? 1;
    if (page >= totalPages || rows.length < 100) break;
  }
  return out;
}
