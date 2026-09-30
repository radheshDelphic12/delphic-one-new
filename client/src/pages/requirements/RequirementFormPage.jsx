import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, Loader2, Plus, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';
import SkillPicker from '../../components/ui/SkillPicker.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import FormActionsBar from '../../components/ui/FormActionsBar.jsx';
import { FIELD_INPUT } from '../../components/ui/formLayout.jsx';
import { canCreateRequirement, canMutateRequirement } from '../../lib/requirementStages.js';

const OWNER_ROLES = ['sales', 'bda', 'admin'];

const emptyForm = {
  account_id: '',
  title: '',
  req_type: 'managed_services',
  sales_owner_id: '',
  seats_total: 1,
  description: '',
  job_description: '',
  designation: '',
  department: '',
  primary_tech_stack: [],
  secondary_tech_stack: [],
  domain_experience: '',
  experience_min: '',
  experience_max: '',
  certifications_required: [],
  work_mode: '',
  work_location: '',
  time_zone_preference: '',
  engagement_type: '',
  contract_duration_months: '',
  priority: 'medium',
  budget_min: '',
  budget_max: '',
  budget_currency: 'INR',
  budget_type: '',
  billing_notes: '',
  sla_days: '',
  start_date_target: '',
  notice_period_max_days: '',
};

function toOptionalNumber(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function buildPayload(form, { isCreate }) {
  const payload = {
    title: form.title.trim(),
    req_type: form.req_type,
    description: form.description.trim() || undefined,
    job_description: form.job_description.trim() || undefined,
    designation: form.designation.trim() || undefined,
    department: form.department.trim() || undefined,
    primary_tech_stack: form.primary_tech_stack,
    secondary_tech_stack: form.secondary_tech_stack,
    domain_experience: form.domain_experience.trim() || undefined,
    experience_min: toOptionalNumber(form.experience_min),
    experience_max: toOptionalNumber(form.experience_max),
    certifications_required: form.certifications_required,
    work_mode: form.work_mode || undefined,
    work_location: form.work_location.trim() || undefined,
    time_zone_preference: form.time_zone_preference.trim() || undefined,
    engagement_type: form.engagement_type || undefined,
    contract_duration_months: toOptionalNumber(form.contract_duration_months),
    priority: form.priority || undefined,
    budget_min: toOptionalNumber(form.budget_min),
    budget_max: toOptionalNumber(form.budget_max),
    budget_currency: form.budget_currency || undefined,
    budget_type: form.budget_type || undefined,
    billing_notes: form.billing_notes.trim() || undefined,
    sla_days: toOptionalNumber(form.sla_days),
    start_date_target: form.start_date_target || undefined,
    notice_period_max_days: toOptionalNumber(form.notice_period_max_days),
  };

  if (isCreate) {
    payload.account_id = form.account_id;
    payload.seats_total = Number(form.seats_total) || 1;
  } else {
    payload.sales_owner_id = form.sales_owner_id || undefined;
  }

  return payload;
}

function hydrateForm(req) {
  return {
    ...emptyForm,
    account_id: req.account?.id || '',
    title: req.title || '',
    req_type: req.req_type || 'recruitment',
    sales_owner_id: req.sales_owner?.id || '',
    seats_total: req.seats_total || 1,
    description: req.description || '',
    job_description: req.job_description || '',
    designation: req.designation || '',
    department: req.department || '',
    primary_tech_stack: req.primary_tech_stack || [],
    secondary_tech_stack: req.secondary_tech_stack || [],
    domain_experience: req.domain_experience || '',
    experience_min: req.experience_min ?? '',
    experience_max: req.experience_max ?? '',
    certifications_required: req.certifications_required || [],
    work_mode: req.work_mode || '',
    work_location: req.work_location || '',
    time_zone_preference: req.time_zone_preference || '',
    engagement_type: req.engagement_type || '',
    contract_duration_months: req.contract_duration_months ?? '',
    priority: req.priority || 'medium',
    budget_min: req.budget_min ?? '',
    budget_max: req.budget_max ?? '',
    budget_currency: req.budget_currency || 'INR',
    budget_type: req.budget_type || '',
    billing_notes: req.billing_notes || '',
    sla_days: req.sla_days ?? '',
    start_date_target: req.start_date_target ? String(req.start_date_target).slice(0, 10) : '',
    notice_period_max_days: req.notice_period_max_days ?? '',
  };
}

export default function RequirementFormPage({ asPanel = false, onDone, onCancel, initialAccountId = '' }) {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const [form, setForm] = useState(() => ({
    ...emptyForm,
    account_id: initialAccountId || '',
  }));
  const [accounts, setAccounts] = useState([]);
  const [ownerOptions, setOwnerOptions] = useState([]);
  const canEditOwner = isEdit && user?.role === 'admin';
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState(null);
  const accountLocked = Boolean(initialAccountId) && !isEdit;

  useEffect(() => {
    if (!canCreateRequirement(user) && !isEdit) {
      pushError('Only sales or admin can create requirements.', 'Validation');
      return;
    }

    apiClient
      .get('/accounts', { params: { type: 'client', stage: 'active', limit: 100 } })
      .then(({ data }) => setAccounts(data.data || []))
      .catch(() => setAccounts([]));

    if (isEdit && user?.role === 'admin') {
      apiClient
        .get('/users/directory')
        .then(({ data }) => setOwnerOptions((data.data || []).filter((u) => OWNER_ROLES.includes(u.role))))
        .catch(() => setOwnerOptions([]));
    }

    if (!isEdit) {
      if (initialAccountId) {
        setForm((prev) => ({ ...prev, account_id: initialAccountId }));
      }
      return;
    }

    setLoading(true);
    apiClient
      .get(`/requirements/${id}`)
      .then(({ data }) => {
        const req = data.data;
        setExisting(req);
        setForm(hydrateForm(req));
        if (!canMutateRequirement(req, user)) {
          pushError('You do not own this requirement.', 'Validation');
        }
      })
      .catch((err) => pushError(apiErrorMessage(err, 'Failed to load requirement'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [id, isEdit, user, initialAccountId]);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = buildPayload(form, { isCreate: !isEdit });
      if (isEdit) {
        await apiClient.patch(`/requirements/${id}`, payload);
        if (asPanel && onDone) onDone(id);
        else navigate(`/requirements/${id}`);
      } else {
        const { data } = await apiClient.post('/requirements', payload);
        if (asPanel && onDone) onDone(data.data.id);
        else navigate(`/requirements/${data.data.id}`);
      }
    } catch (err) {
      pushError(apiErrorMessage(err, 'Failed to save requirement'), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-tertiary-500">Loading…</div>;
  }

  if (!isEdit && !canCreateRequirement(user)) {
    return (
      <div className="rounded-lg border border-tertiary-200 bg-tertiary-50 px-3 py-2 text-sm text-tertiary-700">
        Only sales or admin can create requirements.
      </div>
    );
  }

  const blocked = isEdit && existing && !canMutateRequirement(existing, user);

  function handleCancel() {
    if (asPanel && onCancel) onCancel();
    else navigate(isEdit ? `/requirements/${id}` : '/requirements');
  }

  return (
    <div className={asPanel ? 'space-y-4' : 'mx-auto max-w-3xl space-y-4'}>
      {!asPanel && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <Link to={isEdit ? `/requirements/${id}` : '/requirements'} className="text-xs text-primary-600 hover:underline">
              ← Back
            </Link>
            <h1 className="mt-1 font-heading text-xl font-semibold text-tertiary-900">
              {isEdit ? 'Edit requirement' : 'Add job requirement'}
            </h1>
          </div>
        </div>
      )}

      <form id="requirement-form" onSubmit={handleSubmit} className={asPanel ? 'space-y-4' : 'space-y-4 rounded-lg border bg-white p-4'}>
        {asPanel && (
          <FormActionsBar>
            <button type="submit" form="requirement-form" disabled={blocked || saving} className="btn-primary">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isEdit ? (
                <Check className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create requirement'}
            </button>
          </FormActionsBar>
        )}
        <fieldset disabled={blocked || saving} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <p className="sm:col-span-2 font-heading text-xs font-semibold uppercase tracking-wide text-tertiary-500">
              Basics
            </p>
            {!isEdit && (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-tertiary-600">Client account *</label>
                <SearchableSelect
                  required
                  value={form.account_id}
                  disabled={accountLocked}
                  onChange={(v) => updateField('account_id', v)}
                  placeholder="Select active client…"
                  searchPlaceholder="Search clients…"
                  options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                />
                {accountLocked && (
                  <p className="mt-1 text-xs text-tertiary-500">Locked to this pipeline account.</p>
                )}
                {accounts.length === 0 && (
                  <p className="mt-1 text-xs text-amber-700">No active client accounts found. Activate a client first.</p>
                )}
              </div>
            )}

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Title *</label>
              <input
                required
                value={form.title}
                onChange={(e) => updateField('title', e.target.value)}
                className={FIELD_INPUT}
              />
            </div>

            {canEditOwner && (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-tertiary-600">Sales owner</label>
                <SearchableSelect
                  value={form.sales_owner_id}
                  onChange={(v) => updateField('sales_owner_id', v)}
                  placeholder="Select owner…"
                  searchPlaceholder="Search users…"
                  options={[
                    ...ownerOptions.map((u) => ({ value: u.id, label: `${u.name} · ${u.role}` })),
                    ...(existing?.sales_owner && !ownerOptions.some((u) => u.id === existing.sales_owner.id)
                      ? [{ value: existing.sales_owner.id, label: `${existing.sales_owner.name} (current)` }]
                      : []),
                  ]}
                />
                <p className="mt-1 text-xs text-tertiary-500">
                  Admin only. Reassigns the &ldquo;Sales&rdquo; owner shown on pipeline cards and reports.
                </p>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Type *</label>
              <select
                value={form.req_type}
                onChange={(e) => updateField('req_type', e.target.value)}
                className={FIELD_INPUT}
              >
                <option value="managed_services">Manage Services</option>
                <option value="project">Projects</option>
                <option value="recruitment">Recruitment</option>
              </select>
            </div>

            {!isEdit && (
              <div>
                <label className="mb-1 block text-xs font-medium text-tertiary-600">Seats *</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={form.seats_total}
                  onChange={(e) => updateField('seats_total', e.target.value)}
                  className={FIELD_INPUT}
                />
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => updateField('priority', e.target.value)}
                className={FIELD_INPUT}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <p className="sm:col-span-2 mt-3 border-t border-tertiary-100 pt-3 font-heading text-xs font-semibold uppercase tracking-wide text-tertiary-500">
              Role details
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Designation</label>
              <input
                value={form.designation}
                onChange={(e) => updateField('designation', e.target.value)}
                className={FIELD_INPUT}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Department</label>
              <input
                value={form.department}
                onChange={(e) => updateField('department', e.target.value)}
                className={FIELD_INPUT}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Short summary</label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                className={FIELD_INPUT}
                placeholder="One or two lines shown on lists and cards"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Job description</label>
              <textarea
                rows={6}
                value={form.job_description}
                onChange={(e) => updateField('job_description', e.target.value)}
                className={FIELD_INPUT}
                placeholder="Full job description - responsibilities, requirements, etc."
              />
            </div>

            <p className="sm:col-span-2 mt-3 border-t border-tertiary-100 pt-3 font-heading text-xs font-semibold uppercase tracking-wide text-tertiary-500">
              Skills &amp; experience
            </p>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Primary tech stack</label>
              <SkillPicker
                value={form.primary_tech_stack}
                onChange={(next) => updateField('primary_tech_stack', next)}
                placeholder="Search or type a technology…"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Secondary tech stack</label>
              <SkillPicker
                value={form.secondary_tech_stack}
                onChange={(next) => updateField('secondary_tech_stack', next)}
                placeholder="Search or type a technology…"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Certifications required</label>
              <SkillPicker
                value={form.certifications_required}
                onChange={(next) => updateField('certifications_required', next)}
                placeholder="Add a required certification…"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Experience min (years)</label>
              <input
                type="number"
                min={0}
                value={form.experience_min}
                onChange={(e) => updateField('experience_min', e.target.value)}
                className={FIELD_INPUT}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Experience max (years)</label>
              <input
                type="number"
                min={0}
                value={form.experience_max}
                onChange={(e) => updateField('experience_max', e.target.value)}
                className={FIELD_INPUT}
              />
            </div>

            <p className="sm:col-span-2 mt-3 border-t border-tertiary-100 pt-3 font-heading text-xs font-semibold uppercase tracking-wide text-tertiary-500">
              Engagement
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Work mode</label>
              <select
                value={form.work_mode}
                onChange={(e) => updateField('work_mode', e.target.value)}
                className={FIELD_INPUT}
              >
                <option value="">—</option>
                <option value="remote">Remote</option>
                <option value="onsite">Onsite</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Work location</label>
              <input
                value={form.work_location}
                onChange={(e) => updateField('work_location', e.target.value)}
                className={FIELD_INPUT}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Time zone preference</label>
              <input
                value={form.time_zone_preference}
                onChange={(e) => updateField('time_zone_preference', e.target.value)}
                className={FIELD_INPUT}
                placeholder="e.g. IST ±2 hours"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Engagement</label>
              <select
                value={form.engagement_type}
                onChange={(e) => updateField('engagement_type', e.target.value)}
                className={FIELD_INPUT}
              >
                <option value="">—</option>
                <option value="full_time">Full time</option>
                <option value="part_time">Part time</option>
                <option value="contract">Contract</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Contract duration (months)</label>
              <input
                type="number"
                min={0}
                value={form.contract_duration_months}
                onChange={(e) => updateField('contract_duration_months', e.target.value)}
                className={FIELD_INPUT}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Start date target</label>
              <input
                type="date"
                value={form.start_date_target}
                onChange={(e) => updateField('start_date_target', e.target.value)}
                className={FIELD_INPUT}
              />
            </div>

            <p className="sm:col-span-2 mt-3 border-t border-tertiary-100 pt-3 font-heading text-xs font-semibold uppercase tracking-wide text-tertiary-500">
              Budget &amp; billing
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Budget min</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.budget_min}
                onChange={(e) => updateField('budget_min', e.target.value)}
                className={FIELD_INPUT}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Budget max</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.budget_max}
                onChange={(e) => updateField('budget_max', e.target.value)}
                className={FIELD_INPUT}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Currency</label>
              <SearchableSelect
                value={form.budget_currency}
                onChange={(v) => updateField('budget_currency', v)}
                options={['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP'].map((c) => ({ value: c, label: c }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Budget type</label>
              <select
                value={form.budget_type}
                onChange={(e) => updateField('budget_type', e.target.value)}
                className={FIELD_INPUT}
              >
                <option value="">—</option>
                <option value="monthly">Monthly</option>
                <option value="hourly">Hourly</option>
                <option value="annual">Annual</option>
                <option value="fixed_project">Fixed project</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">SLA days</label>
              <input
                type="number"
                min={0}
                value={form.sla_days}
                onChange={(e) => updateField('sla_days', e.target.value)}
                className={FIELD_INPUT}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Notice period max (days)</label>
              <input
                type="number"
                min={0}
                value={form.notice_period_max_days}
                onChange={(e) => updateField('notice_period_max_days', e.target.value)}
                className={FIELD_INPUT}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Domain experience</label>
              <input
                value={form.domain_experience}
                onChange={(e) => updateField('domain_experience', e.target.value)}
                className={FIELD_INPUT}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-tertiary-600">Billing notes</label>
              <textarea
                rows={2}
                value={form.billing_notes}
                onChange={(e) => updateField('billing_notes', e.target.value)}
                className={FIELD_INPUT}
              />
            </div>
          </div>
        </fieldset>

        {!asPanel && (
          <div className="flex gap-2">
            <button type="submit" disabled={blocked || saving} className="btn-primary">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isEdit ? (
                <Check className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create requirement'}
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
