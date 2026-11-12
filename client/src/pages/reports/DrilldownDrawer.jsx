import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../lib/apiClient';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';

/** One list of records behind a report count (GET /reports/drilldown). */
function DrilldownList({ params, heading }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, data: null });
    apiClient
      .get('/reports/drilldown', { params })
      .then(({ data }) => !cancelled && setState({ loading: false, error: null, data: data.data }))
      .catch(
        (err) =>
          !cancelled && setState({ loading: false, error: apiErrorMessage(err, 'Failed to load records'), data: null })
      );
    return () => {
      cancelled = true;
    };
  }, [params]);

  const { loading, error, data } = state;
  const columns = data?.columns || [];

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-tertiary-800">
        {heading || data?.title}
        {data && (
          <span className="ml-2 text-xs font-normal text-tertiary-500">
            {data.truncated ? `first ${data.rows.length} of ${data.total}` : data.total}
          </span>
        )}
      </h3>
      {loading && <p className="text-sm text-tertiary-500">Loading records…</p>}
      {error && <p className="text-sm text-danger-600">{error}</p>}
      {data &&
        (data.rows.length === 0 ? (
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
        ))}
    </section>
  );
}

/**
 * Right-hand panel with the records behind a report row or count.
 * `request` = { title, summary?, lists: [{ params, heading? }] } or null when closed.
 * A clicked count has one list; a clicked row has one list per count column of that row.
 */
export default function DrilldownDrawer({ request, onClose }) {
  return (
    <Drawer open={Boolean(request)} title={request?.title || 'Records'} onClose={onClose} size="xl" tone="info">
      {request && (
        <div className="space-y-5">
          {request.summary}
          {request.lists.map((list) => (
            <DrilldownList key={JSON.stringify(list.params)} params={list.params} heading={list.heading} />
          ))}
        </div>
      )}
    </Drawer>
  );
}
