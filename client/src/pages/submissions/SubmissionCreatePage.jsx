import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Send, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { fetchAllPages } from '../../lib/fetchAllPages.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import { canCreateSubmission, canOnlyPutForwardBench, computeMarginPreview } from '../../lib/submissionStages.js';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import FormActionsBar from '../../components/ui/FormActionsBar.jsx';
import { FIELD_INPUT } from '../../components/ui/formLayout.jsx';

const RATE_TYPES = ['monthly', 'hourly', 'annual'];
const CURRENCIES = ['INR', 'USD', 'AED', 'SAR'];

function toOptionalNumber(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export default function SubmissionCreatePage({
  asPanel = false,
  onDone,
  onCancel,
  initialRequirementId = '',
  initialProfileId = '',
  accountId = '',
}) {
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState([]);
  const [requirements, setRequirements] = useState([]);
  const [seats, setSeats] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loadingSeats, setLoadingSeats] = useState(false);
  // Sales is locked to bench candidates; recruiter/admin get the toggle.
  const salesBenchOnly = canOnlyPutForwardBench(user);
  const [benchOnly, setBenchOnly] = useState(false);
  const effectiveBenchOnly = salesBenchOnly || benchOnly;

  const [form, setForm] = useState({
    profile_id: initialProfileId || '',
    requirement_id: initialRequirementId || '',
    requirement_seat_id: '',
    proposed_rate: '',
    proposed_rate_type: 'monthly',
    proposed_rate_currency: 'INR',
    vendor_rate: '',
    vendor_rate_type: 'monthly',
    vendor_rate_currency: 'INR',
    relevancy_score: '',
    submission_notes: '',
  });

  const selectedProfile = profiles.find((p) => p.id === form.profile_id);
  const vendorRequired = selectedProfile?.source === 'vendor';
  const requirementLocked = Boolean(initialRequirementId);
  const visibleProfiles = effectiveBenchOnly ? profiles.filter((p) => p.source === 'direct' && p.on_bench) : profiles;

  const liveMargin = useMemo(
    () =>
      computeMarginPreview(
        toOptionalNumber(form.proposed_rate),
        form.proposed_rate_currency,
        toOptionalNumber(form.vendor_rate),
        form.vendor_rate_currency
      ),
    [form.proposed_rate, form.proposed_rate_currency, form.vendor_rate, form.vendor_rate_currency]
  );

  useEffect(() => {
    if (!canCreateSubmission(user)) {
      pushError('Only recruiters, sales, or admins can put a candidate forward.', 'Validation');
      return;
    }
    const reqParams = {};
    if (accountId) reqParams.account_id = accountId;
    // Only offer in-progress requirements in the picker — unless we were opened
    // locked to a specific requirement row, which shows regardless of status.
    if (!initialRequirementId) reqParams.status = 'in_progress';
    // Page through both lists fully — a `limit`-capped first page silently hides
    // candidates/requirements past the cap.
    Promise.all([
      fetchAllPages('/profiles', { is_active: 'true' }),
      fetchAllPages('/requirements', reqParams),
    ])
      .then(([profileRows, reqRows]) => {
        setProfiles(profileRows);
        setRequirements(reqRows);
        if (initialRequirementId) {
          setForm((prev) => ({ ...prev, requirement_id: initialRequirementId }));
        }
      })
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load candidates or jobs'), 'Something went wrong'));
  }, [user, accountId, initialRequirementId, pushError]);

  useEffect(() => {
    if (!form.requirement_id) {
      setSeats([]);
      setForm((prev) => ({ ...prev, requirement_seat_id: '' }));
      return;
    }
    setLoadingSeats(true);
    apiClient
      .get(`/requirements/${form.requirement_id}/seats`)
      .then(({ data }) => {
        const openSeats = (data.data || []).filter((s) => !s.is_locked && !['closed', 'dropped'].includes(s.seat_status));
        setSeats(openSeats);
        setForm((prev) => ({
          ...prev,
          requirement_seat_id: openSeats.some((s) => s.id === prev.requirement_seat_id) ? prev.requirement_seat_id : '',
        }));
      })
      .catch(() => {
        setSeats([]);
        pushError('Failed to load seats for this requirement', 'Something went wrong');
      })
      .finally(() => setLoadingSeats(false));
  }, [form.requirement_id]);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        requirement_seat_id: form.requirement_seat_id,
        profile_id: form.profile_id,
        proposed_rate: toOptionalNumber(form.proposed_rate),
        proposed_rate_type: form.proposed_rate_type || undefined,
        proposed_rate_currency: form.proposed_rate_currency || undefined,
        vendor_rate: toOptionalNumber(form.vendor_rate),
        vendor_rate_type: form.vendor_rate_type || undefined,
        vendor_rate_currency: form.vendor_rate_currency || undefined,
        relevancy_score: toOptionalNumber(form.relevancy_score),
        submission_notes: form.submission_notes.trim() || undefined,
      };
      const { data } = await apiClient.post('/submissions', payload);
      if (asPanel && onDone) onDone(data.data.id);
      else navigate(`/submissions/${data.data.id}`);
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to create submission'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  if (!canCreateSubmission(user)) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-tertiary-600">Only recruiters, sales, or admins can put a candidate forward.</p>
        {!asPanel && (
          <Link to="/submissions" className="text-sm text-primary-600 hover:underline">
            ← Back to submissions
          </Link>
        )}
      </div>
    );
  }

  function handleCancel() {
    if (asPanel && onCancel) onCancel();
    else navigate('/submissions');
  }

  return (
    <div className={asPanel ? 'space-y-4' : 'mx-auto max-w-3xl space-y-4'}>
      {!asPanel && (
        <div>
          <Link to="/submissions" className="text-xs text-primary-600 hover:underline">
            ← Submissions
          </Link>
          <h1 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">Put a candidate forward</h1>
          <p className="mt-1 text-sm text-tertiary-500">Pick a candidate and open seat, enter rates, then submit.</p>
        </div>
      )}

      <form id="submission-form" onSubmit={handleSubmit} className={`space-y-4 ${asPanel ? '' : 'rounded-2xl border bg-white p-4 shadow-soft'}`}>
        {asPanel && (
          <FormActionsBar>
            <button type="submit" form="submission-form" disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {saving ? 'Submitting…' : 'Create submission'}
            </button>
          </FormActionsBar>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="block text-xs font-medium text-tertiary-600">Candidate *</label>
              <label
                className={`flex items-center gap-1.5 text-xs text-tertiary-600 ${salesBenchOnly ? 'opacity-70' : ''}`}
                title={salesBenchOnly ? 'Sales can only put forward bench candidates' : undefined}
              >
                <input
                  type="checkbox"
                  checked={effectiveBenchOnly}
                  disabled={salesBenchOnly}
                  onChange={(e) => setBenchOnly(e.target.checked)}
                />
                On bench only
              </label>
            </div>
            <SearchableSelect
              required
              value={form.profile_id}
              onChange={(v) => updateField('profile_id', v)}
              placeholder="Select candidate…"
              searchPlaceholder="Search candidates…"
              options={visibleProfiles.map((p) => ({
                value: p.id,
                label: `${p.name}${p.current_company ? ` - ${p.current_company}` : ''}${
                  p.source ? ` (${p.source}${p.on_bench ? ', on bench' : ''})` : ''
                }`,
              }))}
            />
            {vendorRequired && (
              <p className="mt-1 text-xs text-warning-700">Vendor candidate - vendor rate is required.</p>
            )}
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-tertiary-600">Job requirement *</label>
            <SearchableSelect
              required
              value={form.requirement_id}
              disabled={requirementLocked}
              onChange={(v) => updateField('requirement_id', v)}
              placeholder="Select job…"
              searchPlaceholder="Search jobs…"
              options={requirements.map((r) => ({
                value: r.id,
                label: `${r.title}${r.account?.name ? ` - ${r.account.name}` : ''} (${r.status})`,
              }))}
            />
            {requirementLocked && (
              <p className="mt-1 text-xs text-tertiary-500">Locked to this requirement row.</p>
            )}
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-tertiary-600">Seat *</label>
            <SearchableSelect
              required
              disabled={!form.requirement_id || loadingSeats}
              value={form.requirement_seat_id}
              onChange={(v) => updateField('requirement_seat_id', v)}
              placeholder={loadingSeats ? 'Loading seats…' : 'Select open seat…'}
              searchPlaceholder="Search seats…"
              options={seats.map((s) => ({
                value: s.id,
                label: `${s.seat_label || s.id.slice(0, 8)} - ${s.seat_status}${
                  s.active_submissions_count ? ` (${s.active_submissions_count} active)` : ''
                }`,
              }))}
            />
            {form.requirement_id && !loadingSeats && seats.length === 0 && (
              <p className="mt-1 text-xs text-warning-700">No open seats on this requirement.</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-600">Proposed rate</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.proposed_rate}
              onChange={(e) => updateField('proposed_rate', e.target.value)}
              className={FIELD_INPUT}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-600">Proposed type / currency</label>
            <div className="flex gap-2">
              <select
                value={form.proposed_rate_type}
                onChange={(e) => updateField('proposed_rate_type', e.target.value)}
                className={FIELD_INPUT}
              >
                {RATE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                value={form.proposed_rate_currency}
                onChange={(e) => updateField('proposed_rate_currency', e.target.value)}
                className={FIELD_INPUT}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-600">
              Vendor rate {vendorRequired ? '*' : ''}
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              required={vendorRequired}
              value={form.vendor_rate}
              onChange={(e) => updateField('vendor_rate', e.target.value)}
              className={FIELD_INPUT}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-600">Vendor type / currency</label>
            <div className="flex gap-2">
              <select
                value={form.vendor_rate_type}
                onChange={(e) => updateField('vendor_rate_type', e.target.value)}
                className={FIELD_INPUT}
              >
                {RATE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                value={form.vendor_rate_currency}
                onChange={(e) => updateField('vendor_rate_currency', e.target.value)}
                className={FIELD_INPUT}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="sm:col-span-2 rounded-xl border border-primary-100 bg-primary-50 px-3 py-3 text-sm">
            <p className="font-medium text-primary-900">Live margin</p>
            {liveMargin.margin == null ? (
              <p className="mt-1 text-primary-700">Enter matching proposed + vendor rates (same currency) to preview.</p>
            ) : (
              <p className="mt-1 text-primary-800">
                Margin: <span className="font-semibold">{liveMargin.margin}</span> ({liveMargin.margin_percentage}%)
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-tertiary-600">Relevancy (1–10)</label>
            <input
              type="number"
              min={1}
              max={10}
              value={form.relevancy_score}
              onChange={(e) => updateField('relevancy_score', e.target.value)}
              className={FIELD_INPUT}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-tertiary-600">Notes</label>
            <textarea
              rows={3}
              value={form.submission_notes}
              onChange={(e) => updateField('submission_notes', e.target.value)}
              className={FIELD_INPUT}
            />
          </div>
        </div>

        {!asPanel && (
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {saving ? 'Submitting…' : 'Create submission'}
            </button>
            <button type="button" className="btn-secondary" onClick={handleCancel}>
              <X className="h-4 w-4" /> Cancel
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
