import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import GroupInvoicesView from '../groupOverview/GroupInvoicesView.jsx';

/**
 * Finance > GST / USD invoices: the GST (INR) and USD export invoices of this company's legal entity, issued by the group admin,
 * with their own numbering, PDFs and payments. The same generator is in Group Dashboard > Book Keeping > Invoices; here it opens on
 * the company's own legal entity. (The company's project invoices are under Finance > Invoicing.)
 */
export default function TaxInvoicesTab() {
  const { user } = useAuth();
  const [options, setOptions] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    apiClient.get('/group-cash/options').then((r) => setOptions(r.data.data)).catch(() => setFailed(true));
  }, []);
  const orgId = user?.active_org?.id || user?.org_id;
  const entity = (options?.entities || []).find((e) => e.workspace_id === orgId);

  if (failed) return <p className="rounded-xl bg-warning-50 px-3 py-2 text-sm text-warning-800">GST and USD invoices are issued by the group admin.</p>;
  if (!options) return <Skeleton className="h-48" />;
  return (
    <div className="space-y-3">
      <p className="text-xs text-tertiary-500">
        {entity ? `GST (INR) and USD export invoices of ${entity.name}.` : 'This company has no legal entity of its own yet, so every legal entity of the group is listed.'}
        {' '}Payments recorded here go into the wallet of the invoice.
      </p>
      <GroupInvoicesView options={options} entityId={entity?.id || ''} />
    </div>
  );
}
