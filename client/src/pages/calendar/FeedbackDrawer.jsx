import { useEffect, useState } from 'react';
import apiClient from '../../lib/apiClient.js';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import Drawer from '../../components/ui/Drawer.jsx';
import { RESULT_LABELS, hasSubmittedFeedback } from '../../lib/interviewRounds.js';

const RESULTS = ['pending', 'pass', 'fail', 'no_show'];

/** Write feedback straight to the candidate's InterviewRound (same row as the panel). */
export default function FeedbackDrawer({ event, open, onClose, onSaved }) {
  const { pushSuccess, pushError } = useAlerts();
  const [result, setResult] = useState('pending');
  const [rating, setRating] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  const reviewing = hasSubmittedFeedback(event);

  useEffect(() => {
    if (!open || !event) return;
    // Pre-fill from the round so "Review feedback" shows what was already saved
    // (and can be amended) instead of a blank form.
    setResult(event.result && event.result !== 'rescheduled' ? event.result : 'pending');
    setRating(event.rating != null ? String(event.rating) : '');
    setFeedback(event.feedback || '');
  }, [open, event]);

  async function submit() {
    if (!event) return;
    setBusy(true);
    try {
      const payload = { result };
      if (feedback.trim()) payload.feedback = feedback.trim();
      if (rating !== '') payload.rating = Number(rating);
      await apiClient.post(`/interviews/${event.id}/feedback`, payload);
      pushSuccess(reviewing ? 'Feedback updated' : 'Feedback saved');
      onClose();
      onSaved?.();
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save feedback'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={() => !busy && onClose()}
      tone="edit"
      size="sm"
      title={reviewing ? 'Review interview feedback' : 'Submit interview feedback'}
      footer={
        <>
          <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={submit}>
            {busy ? 'Saving…' : reviewing ? 'Update feedback' : 'Save feedback'}
          </button>
        </>
      }
    >
      {event && (
        <div className="space-y-3">
          <p className="text-xs text-tertiary-500">
            {event.candidate_name} · {event.round_type_label}
          </p>

          <label className="block text-xs font-medium text-tertiary-600">
            Result
            <select
              value={result}
              onChange={(e) => setResult(e.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            >
              {RESULTS.map((r) => (
                <option key={r} value={r}>
                  {RESULT_LABELS[r] || r.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-medium text-tertiary-600">
            Rating (1-10)
            <input
              type="number"
              min={1}
              max={10}
              value={rating}
              onChange={(e) => setRating(e.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-xs font-medium text-tertiary-600">
            Feedback
            <textarea
              rows={4}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            />
          </label>
        </div>
      )}
    </Drawer>
  );
}
