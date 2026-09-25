import { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { groupByStage } from './pipelineBoardUtils.js';

/**
 * Fetch a list endpoint and group rows into stage columns.
 *
 * Args:
 *   path: API path (e.g. "/accounts").
 *   params: Query params object.
 *   columns: Ordered stage keys.
 *   stageField: Field on each row that holds the stage (default "stage").
 *
 * Returns:
 *   { cells, rows, loading, reload }
 */
export function usePipelineBoard({ path, params, columns, stageField = 'stage' }) {
  const { pushError } = useAlerts();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const paramsKey = useMemo(() => JSON.stringify(params || {}), [params]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const query = paramsKey ? JSON.parse(paramsKey) : {};
      const { data } = await apiClient.get(path, { params: { limit: 100, ...query } });
      setRows(data.data || []);
    } catch (err) {
      setRows([]);
      pushError(apiErrorMessage(err, 'Failed to load pipeline'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [path, paramsKey, pushError]);

  useEffect(() => {
    reload();
  }, [reload]);

  const cells = groupByStage(rows, columns, stageField);
  return { cells, rows, loading, reload };
}
