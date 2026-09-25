import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Check, Loader2, Plus, X } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import { required, runValidations, fieldErrorClass } from '../../lib/alerts/formValidation.js';
import SkillPicker from '../../components/ui/SkillPicker.jsx';
import SearchableSelect from '../../components/ui/SearchableSelect.jsx';
import FormActionsBar from '../../components/ui/FormActionsBar.jsx';
import { FIELD_INPUT } from '../../components/ui/formLayout.jsx';
import { emptyProfileForm, formToProfileBody, profileToForm } from './profileForm.js';
import { apiErrorMessage, canCreateProfile, canEditProfile, profileKey } from './profileUtils.js';

const INPUT_CLASS = FIELD_INPUT;
const CURRENCIES = ['INR', 'USD', 'AED', 'SAR'];

function Field({ label, children, required = false }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-tertiary-600">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      {children}
    </label>
  );
}

export default function ProfileFormPage({ asPanel = false, onDone, onCancel }) {
  const { id } = useParams();
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const navigate = useNavigate();
  const isEditing = Boolean(id);
  const [form, setForm] = useState(emptyProfileForm());
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [resumeFile, setResumeFile] = useState(null);

  useEffect(() => {
    apiClient
      // No stage filter — a vendor account that is not in the `active` stage must
      // still be selectable, or the profile ends up with no vendor link and the
      // recruiter-vendor-gaps report can't count it.
      .get('/accounts', { params: { type: 'vendor', limit: 100 } })
      .then(({ data }) => setVendors(data.data || []))
      .catch(() => setVendors([]));
  }, []);

  useEffect(() => {
    if (!isEditing) return;
    apiClient
      .get(`/profiles/${id}`)
      .then(({ data }) => setForm(profileToForm(data.data)))
      .catch((requestError) => pushError(apiErrorMessage(requestError, 'Failed to load candidate'), 'Something went wrong'))
      .finally(() => setLoading(false));
  }, [id, isEditing]);

  if (!asPanel && !isEditing && !canCreateProfile(user)) return <Navigate to="/profiles" replace />;
  if (!asPanel && isEditing && !canEditProfile(user)) return <Navigate to={`/profiles/${id}`} replace />;
  if (asPanel && !isEditing && !canCreateProfile(user)) {
    return (
      <div className="rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-700">
        Only recruiters or admins can create candidate profiles.
      </div>
    );
  }

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function uploadResume(profileId) {
    if (!resumeFile) return;
    const body = new FormData();
    body.append('entity_type', 'profile');
    body.append('entity_id', profileId);
    body.append('label', 'Resume');
    body.append('file', resumeFile);
    // No explicit Content-Type — the browser adds the multipart boundary itself.
    await apiClient.post('/documents', body);
  }

  async function saveProfile(event) {
    event.preventDefault();
    const validation = runValidations([
      ['name', required(form.name, 'Name')],
      ['total_experience_years', required(form.total_experience_years, 'Experience years')],
      ['primary_skills', form.primary_skills.length === 0 ? 'Primary skills are required.' : null],
      ['vendor_account_id', form.source === 'vendor' && !form.vendor_account_id ? 'Select a vendor account when source is vendor.' : null],
    ]);
    if (!validation.valid) {
      setFieldErrors(validation.fieldErrors);
      pushError(validation.messages.join(' '), 'Please fix the form');
      return;
    }

    setSaving(true);
    setFieldErrors({});
    try {
      const body = formToProfileBody(form);
      const { data } = isEditing
        ? await apiClient.patch(`/profiles/${id}`, body)
        : await apiClient.post('/profiles', body);
      const profileId = data.data.id;
      if (resumeFile) await uploadResume(profileId);
      if (asPanel && onDone) onDone(profileId);
      else navigate(`/profiles/${profileId}`, { replace: true });
    } catch (requestError) {
      pushError(apiErrorMessage(requestError, `Failed to ${isEditing ? 'update' : 'create'} candidate`), 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm text-tertiary-500">Loading candidate…</div>;

  const backPath = isEditing ? `/profiles/${id}` : '/profiles';

  function handleCancel() {
    if (asPanel && onCancel) onCancel();
    else navigate(backPath);
  }

  return (
    <div className={asPanel ? 'space-y-4' : 'mx-auto max-w-5xl space-y-4'}>
      {!asPanel && (
        <div className="flex items-start justify-between gap-4 border-b pb-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs text-tertiary-500">
              <Link to="/profiles" className="text-primary-700 hover:underline">Profiles</Link>
              <span>/</span>
              <span>{isEditing ? profileKey(id) : 'Create'}</span>
            </div>
            <h1 className="font-heading text-xl font-semibold text-tertiary-900">
              {isEditing ? 'Edit candidate' : 'Add candidate'}
            </h1>
          </div>
          <button type="button" className="btn-secondary" onClick={handleCancel}>
            <X className="h-4 w-4" /> Cancel
          </button>
        </div>
      )}

      <form id="profile-form" onSubmit={saveProfile} className="space-y-4">
        {asPanel && (
          <FormActionsBar>
            <button type="submit" form="profile-form" disabled={saving} className="btn-primary">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isEditing ? (
                <Check className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create candidate'}
            </button>
          </FormActionsBar>
        )}
        <section className="overflow-hidden rounded-xl border border-tertiary-100 bg-white shadow-soft">
          <h2 className="border-b border-tertiary-100 bg-tertiary-50/60 px-4 py-2.5 font-heading text-sm font-semibold text-tertiary-800">
            Personal
          </h2>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Full name" required>
              <input required value={form.name} onChange={(e) => updateField('name', e.target.value)} className={fieldErrorClass(fieldErrors, 'name', INPUT_CLASS)} />
              {fieldErrors.name && <p className="text-xs text-danger-600 mt-1">{fieldErrors.name}</p>}
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={(e) => updateField('email', e.target.value)} className={INPUT_CLASS} />
            </Field>
            <Field label="Phone">
              <input value={form.phone} onChange={(e) => updateField('phone', e.target.value)} className={INPUT_CLASS} />
            </Field>
            <Field label="Date of birth">
              <input type="date" value={form.date_of_birth} onChange={(e) => updateField('date_of_birth', e.target.value)} className={INPUT_CLASS} />
            </Field>
            <Field label="Gender">
              <select value={form.gender} onChange={(e) => updateField('gender', e.target.value)} className={INPUT_CLASS}>
                <option value="">Not specified</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </Field>
            <Field label="Current location">
              <input value={form.current_location} onChange={(e) => updateField('current_location', e.target.value)} className={INPUT_CLASS} />
            </Field>
            <Field label="Willing to relocate">
              <label className="mt-1.5 flex items-center gap-2 text-sm text-tertiary-700">
                <input
                  type="checkbox"
                  checked={form.willing_to_relocate}
                  onChange={(e) => updateField('willing_to_relocate', e.target.checked)}
                />
                Yes
              </label>
            </Field>
            <Field label="Preferred locations (comma separated)">
              <input value={form.preferred_locations} onChange={(e) => updateField('preferred_locations', e.target.value)} className={INPUT_CLASS} />
            </Field>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-tertiary-100 bg-white shadow-soft">
          <h2 className="border-b border-tertiary-100 bg-tertiary-50/60 px-4 py-2.5 font-heading text-sm font-semibold text-tertiary-800">
            Professional
          </h2>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Current company">
              <input value={form.current_company} onChange={(e) => updateField('current_company', e.target.value)} className={INPUT_CLASS} />
            </Field>
            <Field label="Current designation">
              <input value={form.current_designation} onChange={(e) => updateField('current_designation', e.target.value)} className={INPUT_CLASS} />
            </Field>
            <Field label="Total experience (years)" required>
              <input required type="number" min="0" step="0.1" value={form.total_experience_years} onChange={(e) => updateField('total_experience_years', e.target.value)} className={INPUT_CLASS} />
            </Field>
            <Field label="Relevant experience (years)">
              <input type="number" min="0" step="0.1" value={form.relevant_experience_years} onChange={(e) => updateField('relevant_experience_years', e.target.value)} className={INPUT_CLASS} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Primary skills" required>
                <SkillPicker value={form.primary_skills} onChange={(next) => updateField('primary_skills', next)} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Secondary skills">
                <SkillPicker value={form.secondary_skills} onChange={(next) => updateField('secondary_skills', next)} />
              </Field>
            </div>
            <Field label="Certifications (comma separated)">
              <input value={form.certifications} onChange={(e) => updateField('certifications', e.target.value)} className={INPUT_CLASS} />
            </Field>
            <Field label="Domain experience (comma separated)">
              <input value={form.domain_experience} onChange={(e) => updateField('domain_experience', e.target.value)} className={INPUT_CLASS} />
            </Field>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-tertiary-100 bg-white shadow-soft">
          <h2 className="border-b border-tertiary-100 bg-tertiary-50/60 px-4 py-2.5 font-heading text-sm font-semibold text-tertiary-800">
            Compensation & availability
          </h2>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Current CTC">
              <input type="number" min="0" value={form.current_ctc} onChange={(e) => updateField('current_ctc', e.target.value)} className={INPUT_CLASS} />
            </Field>
            <Field label="Current CTC currency">
              <select value={form.current_ctc_currency} onChange={(e) => updateField('current_ctc_currency', e.target.value)} className={INPUT_CLASS}>
                {CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}
              </select>
            </Field>
            <Field label="Expected CTC">
              <input type="number" min="0" value={form.expected_ctc} onChange={(e) => updateField('expected_ctc', e.target.value)} className={INPUT_CLASS} />
            </Field>
            <Field label="Expected CTC currency">
              <select value={form.expected_ctc_currency} onChange={(e) => updateField('expected_ctc_currency', e.target.value)} className={INPUT_CLASS}>
                {CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}
              </select>
            </Field>
            <Field label="CTC negotiable">
              <label className="mt-1.5 flex items-center gap-2 text-sm text-tertiary-700">
                <input
                  type="checkbox"
                  checked={form.ctc_negotiable}
                  onChange={(e) => updateField('ctc_negotiable', e.target.checked)}
                />
                Yes
              </label>
            </Field>
            <Field label="Notice period (days)">
              <input type="number" min="0" value={form.notice_period_days} onChange={(e) => updateField('notice_period_days', e.target.value)} className={INPUT_CLASS} />
            </Field>
            <Field label="Currently serving notice">
              <label className="mt-1.5 flex items-center gap-2 text-sm text-tertiary-700">
                <input
                  type="checkbox"
                  checked={form.is_serving_notice}
                  onChange={(e) => updateField('is_serving_notice', e.target.checked)}
                />
                Yes
              </label>
            </Field>
            <Field label="Preferred work mode">
              <select value={form.preferred_work_mode} onChange={(e) => updateField('preferred_work_mode', e.target.value)} className={INPUT_CLASS}>
                <option value="">Not specified</option>
                <option value="remote">Remote</option>
                <option value="onsite">Onsite</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </Field>
            <Field label="Last working day">
              <input type="date" value={form.last_working_day} onChange={(e) => updateField('last_working_day', e.target.value)} className={INPUT_CLASS} />
            </Field>
            <Field label="Earliest join date">
              <input type="date" value={form.earliest_join_date} onChange={(e) => updateField('earliest_join_date', e.target.value)} className={INPUT_CLASS} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="CTC notes">
                <textarea rows={2} value={form.ctc_notes} onChange={(e) => updateField('ctc_notes', e.target.value)} className={INPUT_CLASS} />
              </Field>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-tertiary-100 bg-white shadow-soft">
          <h2 className="border-b border-tertiary-100 bg-tertiary-50/60 px-4 py-2.5 font-heading text-sm font-semibold text-tertiary-800">
            Education & links
          </h2>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Degree">
              <input value={form.education_degree} onChange={(e) => updateField('education_degree', e.target.value)} className={INPUT_CLASS} />
            </Field>
            <Field label="Institution">
              <input value={form.education_institution} onChange={(e) => updateField('education_institution', e.target.value)} className={INPUT_CLASS} />
            </Field>
            <Field label="Year">
              <input type="number" min="1950" value={form.education_year} onChange={(e) => updateField('education_year', e.target.value)} className={INPUT_CLASS} />
            </Field>
            <Field label="LinkedIn URL">
              <input type="url" value={form.linkedin_url} onChange={(e) => updateField('linkedin_url', e.target.value)} className={INPUT_CLASS} />
            </Field>
            <Field label="Portfolio URL">
              <input type="url" value={form.portfolio_url} onChange={(e) => updateField('portfolio_url', e.target.value)} className={INPUT_CLASS} />
            </Field>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-tertiary-100 bg-white shadow-soft">
          <h2 className="border-b border-tertiary-100 bg-tertiary-50/60 px-4 py-2.5 font-heading text-sm font-semibold text-tertiary-800">
            Sourcing
          </h2>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Source" required>
              <select required value={form.source} onChange={(e) => updateField('source', e.target.value)} className={INPUT_CLASS}>
                <option value="direct">Bench</option>
                <option value="vendor">Vendor</option>
                <option value="linkedin">Market</option>
              </select>
            </Field>
            {form.source === 'vendor' && (
              <>
                <Field label="Vendor account" required>
                  <SearchableSelect
                    required
                    value={form.vendor_account_id}
                    onChange={(v) => updateField('vendor_account_id', v)}
                    placeholder="Select vendor"
                    searchPlaceholder="Search vendors…"
                    options={vendors.map((vendor) => ({ value: vendor.id, label: vendor.name }))}
                  />
                </Field>
                <Field label="Vendor's own profile ID">
                  <input value={form.vendor_profile_id} onChange={(e) => updateField('vendor_profile_id', e.target.value)} className={INPUT_CLASS} />
                </Field>
              </>
            )}
            {form.source === 'direct' && (
              <Field label="On bench">
                <label className="mt-1.5 flex items-center gap-2 text-sm text-tertiary-700">
                  <input
                    type="checkbox"
                    checked={form.on_bench}
                    onChange={(e) => updateField('on_bench', e.target.checked)}
                  />
                  Currently available for a new submission
                </label>
              </Field>
            )}
            <Field label="Resume file">
              <input
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
                className="w-full text-sm"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Recruiter notes">
                <textarea rows={3} value={form.recruiter_notes} onChange={(e) => updateField('recruiter_notes', e.target.value)} className={INPUT_CLASS} />
              </Field>
            </div>
          </div>
        </section>

        {!asPanel && (
          <div className="flex justify-end gap-2 border-t pt-4">
            <button type="button" className="btn-secondary" onClick={handleCancel}>
              <X className="h-4 w-4" /> Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isEditing ? (
                <Check className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create candidate'}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
