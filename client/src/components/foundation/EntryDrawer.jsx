import { useState } from 'react';
import Drawer from '../ui/Drawer.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { fxApi, foundationError, overBudgetOf } from '../../lib/foundation/api.js';
import { fxCan } from '../../lib/foundation/useFoundation.js';
import EntryForm from './EntryForm.jsx';

/**
 * Add or edit one money entry. Everything the server can answer is handled here so every page behaves the same:
 * an over-budget refusal shows its numbers (and the override reason box for those who may use it), a closed month asks
 * for a reason, and a warning (budget policy off) is passed on as a toast.
 */
export default function EntryDrawer({ open, entry, fixedCampaign, campaigns, categories, me, onClose, onSaved }) {
  const { pushSuccess, pushWarning } = useAlerts();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [overBudget, setOverBudget] = useState(null);
  const [needsReason, setNeedsReason] = useState(false);

  async function submit(body) {
    setSaving(true);
    setError('');
    try {
      const saved = entry ? await fxApi.updateEntry(entry.id, body) : await fxApi.createEntry(body);
      pushSuccess(entry ? 'Entry updated' : 'Entry saved');
      if (saved?.warning) pushWarning?.('This is over the campaign budget. It was recorded because the over-budget block is switched off.');
      setOverBudget(null);
      setNeedsReason(false);
      onSaved();
    } catch (e) {
      const ob = overBudgetOf(e);
      setOverBudget(ob);
      const msg = foundationError(e, 'Could not save');
      setNeedsReason(/enter a reason/i.test(msg));
      setError(ob ? '' : msg);
    } finally {
      setSaving(false);
    }
  }
  const close = () => { setOverBudget(null); setNeedsReason(false); setError(''); onClose(); };
  return (
    <Drawer open={open} onClose={close} size="lg" tone={entry ? 'edit' : 'create'} title={entry ? 'Edit entry' : 'Record money'}>
      {open && (
        <EntryForm
          key={entry?.id || 'new'}
          initial={entry}
          fixedCampaign={fixedCampaign}
          campaigns={campaigns}
          categories={categories}
          canApprove={fxCan(me, 'entriesApprove')}
          canOverride={fxCan(me, 'override')}
          overBudget={overBudget}
          needsReason={needsReason}
          saving={saving}
          error={error}
          onSubmit={submit}
          onCancel={close}
        />
      )}
    </Drawer>
  );
}
