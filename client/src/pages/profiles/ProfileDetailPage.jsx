import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import apiClient from '../../lib/apiClient.js';
import { useAuth } from '../../lib/authContext.jsx';
import { useAlerts } from '../../lib/alerts/alertContext.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import DetailSkeleton from '../../components/ui/DetailSkeleton.jsx';
import Breadcrumbs from '../../components/ui/Breadcrumbs.jsx';
import ProgressRing from '../../components/ui/ProgressRing.jsx';
import ClosureStepsBreakdown from '../../components/ui/ClosureStepsBreakdown.jsx';
import NotesPanel from '../../components/NotesPanel.jsx';
import FilesPanel from '../../components/FilesPanel.jsx';
import DeleteRecordButton from '../../components/DeleteRecordButton.jsx';
import { userCan } from '../../lib/permissions.js';
import ProfileFormPage from './ProfileFormPage.jsx';
import { apiErrorMessage, canEditProfile, formatProfileValue, profileKey } from './profileUtils.js';

function DetailField({ label, value, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-tertiary-500">{label}</dt>
      <dd className="mt-1 break-words text-sm capitalize text-tertiary-900">{children || formatProfileValue(value)}</dd>
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <section className="rounded border bg-white">
      <h2 className="border-b bg-tertiary-50 px-4 py-2 text-sm font-semibold text-tertiary-800">{title}</h2>
      <dl className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>
    </section>
  );
}

export default function ProfileDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { pushError } = useAlerts();
  const [searchParams, setSearchParams] = useSearchParams();
  const [profile, setProfile] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(searchParams.get('edit') === '1');

  async function loadProfile() {
    setLoading(true);
    try {
      const [profileResponse, submissionsResponse] = await Promise.all([
        apiClient.get(`/profiles/${id}`),
        apiClient.get(`/profiles/${id}/submissions`),
      ]);
      setProfile(profileResponse.data.data);
      setSubmissions(submissionsResponse.data.data || []);
    } catch (requestError) {
      pushError(apiErrorMessage(requestError, 'Failed to load candidate'), 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfile();
  }, [id]);

  useEffect(() => {
    if (searchParams.get('edit') === '1') setEditOpen(true);
  }, [searchParams]);

  function closeEdit() {
    setEditOpen(false);
    if (searchParams.get('edit')) {
      searchParams.delete('edit');
      setSearchParams(searchParams, { replace: true });
    }
  }

  if (loading) return <DetailSkeleton />;
  if (!profile) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-tertiary-600">Candidate not found or could not be loaded.</p>
        <Link to="/profiles" className="text-sm text-primary-700 hover:underline">Back to profiles</Link>
      </div>
    );
  }

  const canEdit = canEditProfile(user);
  const education = profile.education || {};

  return (
    <div className="space-y-4">
      <div className="border-b pb-3">
        <Breadcrumbs
          items={[
            { label: 'Profiles', to: '/profiles' },
            { label: profileKey(profile.id) },
          ]}
        />
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-medium text-primary-700">{profileKey(profile.id)}</span>
              <Badge value={profile.source} />
              {!profile.is_active && <span className="rounded bg-tertiary-100 px-2 py-0.5 text-xs text-tertiary-600">Inactive</span>}
            </div>
            <h1 className="mt-1 font-heading text-2xl font-semibold text-tertiary-900">{profile.name}</h1>
            <p className="mt-1 text-sm text-tertiary-500">
              {profile.current_designation || '—'} · {profile.current_company || 'No company'} · Added by {profile.added_by?.name || '—'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-center">
              <ProgressRing percent={profile.progress?.percent ?? null} size="md" />
              <span className="mt-1 text-[10px] font-medium uppercase tracking-wide text-tertiary-400">Closure %</span>
            </div>
            {canEdit && (
              <button type="button" className="btn-secondary" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </button>
            )}
            {userCan(user, 'deleteRecords') && (
              <DeleteRecordButton
                entityType="profile"
                entityId={profile.id}
                entityLabel={`${profileKey(profile.id)} · ${profile.name}`}
                onDeleted={() => navigate('/profiles')}
              />
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="space-y-4">
          <DetailSection title="Personal">
            <DetailField label="Email">
              {profile.email ? <a href={`mailto:${profile.email}`} className="normal-case text-primary-700 hover:underline">{profile.email}</a> : '—'}
            </DetailField>
            <DetailField label="Phone" value={profile.phone} />
            <DetailField label="Date of birth" value={profile.date_of_birth} />
            <DetailField label="Gender" value={profile.gender} />
            <DetailField label="Location" value={profile.current_location} />
            <DetailField label="Willing to relocate" value={profile.willing_to_relocate} />
            <DetailField label="Preferred locations" value={(profile.preferred_locations || []).join(', ')} />
          </DetailSection>

          <DetailSection title="Professional">
            <DetailField label="Company" value={profile.current_company} />
            <DetailField label="Designation" value={profile.current_designation} />
            <DetailField label="Total experience" value={`${profile.total_experience_years} years`} />
            <DetailField label="Relevant experience" value={profile.relevant_experience_years != null ? `${profile.relevant_experience_years} years` : null} />
            <DetailField label="Primary skills" value={(profile.primary_skills || []).join(', ')} />
            <DetailField label="Secondary skills" value={(profile.secondary_skills || []).join(', ')} />
            <DetailField label="Certifications" value={(profile.certifications || []).join(', ')} />
            <DetailField label="Domain experience" value={(profile.domain_experience || []).join(', ')} />
          </DetailSection>

          <DetailSection title="Compensation & availability">
            <DetailField label="Current CTC" value={profile.current_ctc != null ? `${profile.current_ctc_currency} ${profile.current_ctc}` : null} />
            <DetailField label="Expected CTC" value={profile.expected_ctc != null ? `${profile.expected_ctc_currency} ${profile.expected_ctc}` : null} />
            <DetailField label="Negotiable" value={profile.ctc_negotiable} />
            <DetailField label="Notice period" value={profile.notice_period_days != null ? `${profile.notice_period_days} days` : null} />
            <DetailField label="Serving notice" value={profile.is_serving_notice} />
            <DetailField label="Work mode" value={profile.preferred_work_mode} />
            <DetailField label="Last working day" value={profile.last_working_day} />
            <DetailField label="Earliest join" value={profile.earliest_join_date} />
            <DetailField label="CTC notes" value={profile.ctc_notes} />
          </DetailSection>

          <DetailSection title="Education & links">
            <DetailField label="Degree" value={education.degree} />
            <DetailField label="Institution" value={education.institution} />
            <DetailField label="Year" value={education.year} />
            <DetailField label="LinkedIn">
              {profile.linkedin_url ? <a href={profile.linkedin_url} target="_blank" rel="noreferrer" className="normal-case text-primary-700 hover:underline">Open</a> : '—'}
            </DetailField>
            <DetailField label="Portfolio">
              {profile.portfolio_url ? <a href={profile.portfolio_url} target="_blank" rel="noreferrer" className="normal-case text-primary-700 hover:underline">Open</a> : '—'}
            </DetailField>
            <DetailField label="Vendor" value={profile.vendor_account?.name} />
            <DetailField label="Recruiter notes" value={profile.recruiter_notes} />
          </DetailSection>

          <DetailSection title="Record">
            <DetailField label="Added by" value={profile.added_by?.name} />
            <DetailField label="Added on">
              {profile.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}
            </DetailField>
            <DetailField label="Last updated">
              {profile.updated_at ? new Date(profile.updated_at).toLocaleDateString() : '—'}
            </DetailField>
          </DetailSection>

          <FilesPanel
            entityType="profile"
            entityId={profile.id}
            canUpload={canEdit}
            defaultLabel="Resume"
            title="Resume & files"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
          />
          <NotesPanel entityType="profile" entityId={profile.id} />
        </div>

        <aside className="space-y-4 self-start xl:sticky xl:top-0">
          <section className="rounded border bg-white">
            <h2 className="border-b bg-tertiary-50 px-4 py-2 text-sm font-semibold text-tertiary-800">Submission history</h2>
            <ul className="divide-y">
              {submissions.map((submission) => (
                <li key={submission.id} className="px-4 py-3 text-sm">
                  <Link to={`/submissions/${submission.id}`} className="font-medium text-primary-700 hover:underline">
                    {submission.requirement?.title || 'Requirement'}
                  </Link>
                  <div className="mt-1 text-xs text-tertiary-500">{submission.requirement?.account_name || '—'}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge value={submission.stage} />
                    <span className="text-xs text-tertiary-400">{new Date(submission.created_at).toLocaleDateString()}</span>
                  </div>
                </li>
              ))}
              {submissions.length === 0 && <li className="px-4 py-5 text-sm text-tertiary-400">Not submitted to any job yet.</li>}
            </ul>
          </section>
          <section className="rounded border bg-white p-4 text-sm text-tertiary-600">
            <div>Active submissions: <span className="font-medium text-tertiary-900">{profile.active_submissions_count || 0}</span></div>
            <div className="mt-1">Total submissions: <span className="font-medium text-tertiary-900">{profile.total_submissions_count || 0}</span></div>
            <div className="mt-3 flex items-center gap-2">
              <ProgressRing percent={profile.progress?.percent ?? null} size="sm" />
              <span>Closure probability (most-advanced active submission)</span>
            </div>
            {profile.progress?.steps && (
              <div className="mt-2 border-t pt-2">
                <ClosureStepsBreakdown steps={profile.progress.steps} />
              </div>
            )}
          </section>
        </aside>
      </div>

      <Drawer open={editOpen} title="Edit candidate" onClose={closeEdit} size="xl" tone="edit">
        {editOpen && (
          <ProfileFormPage
            asPanel
            onCancel={closeEdit}
            onDone={() => {
              closeEdit();
              loadProfile();
            }}
          />
        )}
      </Drawer>
    </div>
  );
}
