import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../lib/apiClient';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';

/**
 * Right-hand panel listing the individual records behind one report count.
 * `request` = { params, label } (params go to GET /reports/drilldown) or null when closed.
 */
export default function DrilldownDrawer({ request, onClose }) {
  const [state, setState] = useState({ loading: false, error: null, data: null });

  useEffect(() => {
    if (!request) return undefined;
    let cancelled = false;
    setState({ loading: true, error: null, data: null });
    apiClient
      .get('/reports/drilldown', { params: request.params })
      .then(({ data }) => !cancelled && setState({ loading: false, error: null, data: data.data }))
      .catch((err) => !cancelled && setState({ loading: false, error: apiErrorMessage(err, 'Failed to load records'), data: null }));
    return () => {
      cancelled = true;
    };
  }, [request]);

  const { loading, error, data } = state;
  const columns = data?.columns || [];

  return (
    <Drawer open={Boolean(request)} title={data?.title || request?.label || 'Records'} onClose={onClose} size="xl" tone="info">
      {request?.label && <p className="mb-3 text-sm text-tertiary-600">{request.label}</p>}
      {loading && <p className="text-sm text-tertiary-500">Loading records…</p>}
      {error && <p className="text-sm text-danger-600">{error}</p>}
      {data && (
        <>
          <p className="mb-2 text-xs font-medium text-tertiary-500">
            {data.truncated ? `Showing first ${data.rows.length} of ${data.total}` : `${data.total} ${data.total === 1 ? 'record' : 'records'}`}
          </p>
          {data.rows.length === 0 ? (
            <p className="rounded-xl bg-canvas-muted px-3 py-6 text-center text-sm text-tertiary-500">No records found</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-tertiary-100">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-canvas-muted text-xs uppercase tracking-wide text-tertiary-500">
                  <tr>
                    {columns.map((col) => (
                      <th key={col.key} className="whitespace-nowrap px-3 py-2 font-semibold">
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-tertiary-100">
                  {data.rows.map((row) => (
                    <tr key={row.id}>
                      {columns.map((col, index) => (
                        <td key={col.key} className="px-3 py-2 text-tertiary-800">
                          {index === 0 && row.link ? (
                            <Link to={row.link} className="font-medium text-primary-600 hover:underline">
                              {row[col.key]}
                            </Link>
                          ) : (
                            row[col.key]
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
