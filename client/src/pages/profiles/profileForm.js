export function emptyProfileForm() {
  return {
    name: '',
    email: '',
    phone: '',
    date_of_birth: '',
    gender: '',
    current_location: '',
    willing_to_relocate: false,
    preferred_locations: '',
    current_company: '',
    current_designation: '',
    total_experience_years: '',
    relevant_experience_years: '',
    primary_skills: [],
    secondary_skills: [],
    certifications: '',
    domain_experience: '',
    education_degree: '',
    education_institution: '',
    education_year: '',
    current_ctc: '',
    current_ctc_currency: 'INR',
    expected_ctc: '',
    expected_ctc_currency: 'INR',
    ctc_negotiable: false,
    ctc_notes: '',
    notice_period_days: '',
    is_serving_notice: false,
    last_working_day: '',
    earliest_join_date: '',
    preferred_work_mode: '',
    linkedin_url: '',
    portfolio_url: '',
    source: 'direct',
    on_bench: false,
    vendor_account_id: '',
    vendor_profile_id: '',
    recruiter_notes: '',
  };
}

export function profileToForm(profile) {
  const education = profile.education || {};
  return {
    ...emptyProfileForm(),
    name: profile.name || '',
    email: profile.email || '',
    phone: profile.phone || '',
    date_of_birth: profile.date_of_birth ? String(profile.date_of_birth).slice(0, 10) : '',
    gender: profile.gender || '',
    current_location: profile.current_location || '',
    willing_to_relocate: Boolean(profile.willing_to_relocate),
    preferred_locations: (profile.preferred_locations || []).join(', '),
    current_company: profile.current_company || '',
    current_designation: profile.current_designation || '',
    total_experience_years: profile.total_experience_years ?? '',
    relevant_experience_years: profile.relevant_experience_years ?? '',
    primary_skills: profile.primary_skills || [],
    secondary_skills: profile.secondary_skills || [],
    certifications: (profile.certifications || []).join(', '),
    domain_experience: (profile.domain_experience || []).join(', '),
    education_degree: education.degree || '',
    education_institution: education.institution || '',
    education_year: education.year ?? '',
    current_ctc: profile.current_ctc ?? '',
    current_ctc_currency: profile.current_ctc_currency || 'INR',
    expected_ctc: profile.expected_ctc ?? '',
    expected_ctc_currency: profile.expected_ctc_currency || 'INR',
    ctc_negotiable: Boolean(profile.ctc_negotiable),
    ctc_notes: profile.ctc_notes || '',
    notice_period_days: profile.notice_period_days ?? '',
    is_serving_notice: Boolean(profile.is_serving_notice),
    last_working_day: profile.last_working_day ? String(profile.last_working_day).slice(0, 10) : '',
    earliest_join_date: profile.earliest_join_date ? String(profile.earliest_join_date).slice(0, 10) : '',
    preferred_work_mode: profile.preferred_work_mode || '',
    linkedin_url: profile.linkedin_url || '',
    portfolio_url: profile.portfolio_url || '',
    source: profile.source || 'direct',
    on_bench: Boolean(profile.on_bench),
    vendor_account_id: profile.vendor_account?.id || profile.vendor_account_id || '',
    vendor_profile_id: profile.vendor_profile_id || '',
    recruiter_notes: profile.recruiter_notes || '',
  };
}

function optionalNumber(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  const number = Number(value);
  return Number.isNaN(number) ? undefined : number;
}

function optionalText(value) {
  const text = String(value || '').trim();
  return text === '' ? undefined : text;
}

function optionalEnum(value) {
  return value || undefined;
}

/** HTML date inputs give YYYY-MM-DD; Prisma DateTime needs a full ISO string. */
function optionalDate(value) {
  const text = optionalText(value);
  if (!text) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00.000Z`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function formToProfileBody(form) {
  const body = {
    name: form.name.trim(),
    total_experience_years: Number(form.total_experience_years),
    primary_skills: form.primary_skills,
    source: form.source,
    email: optionalText(form.email) || '',
    phone: optionalText(form.phone),
    date_of_birth: optionalDate(form.date_of_birth),
    gender: optionalEnum(form.gender),
    current_location: optionalText(form.current_location),
    willing_to_relocate: Boolean(form.willing_to_relocate),
    preferred_locations: splitCsv(form.preferred_locations),
    current_company: optionalText(form.current_company),
    current_designation: optionalText(form.current_designation),
    relevant_experience_years: optionalNumber(form.relevant_experience_years),
    secondary_skills: form.secondary_skills,
    certifications: splitCsv(form.certifications),
    domain_experience: splitCsv(form.domain_experience),
    current_ctc: optionalNumber(form.current_ctc),
    current_ctc_currency: form.current_ctc_currency || 'INR',
    expected_ctc: optionalNumber(form.expected_ctc),
    expected_ctc_currency: form.expected_ctc_currency || 'INR',
    ctc_negotiable: Boolean(form.ctc_negotiable),
    ctc_notes: optionalText(form.ctc_notes),
    notice_period_days: optionalNumber(form.notice_period_days),
    is_serving_notice: Boolean(form.is_serving_notice),
    last_working_day: optionalDate(form.last_working_day),
    earliest_join_date: optionalDate(form.earliest_join_date),
    preferred_work_mode: optionalEnum(form.preferred_work_mode),
    linkedin_url: optionalText(form.linkedin_url),
    portfolio_url: optionalText(form.portfolio_url),
    vendor_profile_id: optionalText(form.vendor_profile_id),
    recruiter_notes: optionalText(form.recruiter_notes),
  };

  if (form.source === 'vendor') {
    body.vendor_account_id = form.vendor_account_id || undefined;
  }
  if (form.source === 'direct') {
    body.on_bench = Boolean(form.on_bench);
  }

  const degree = optionalText(form.education_degree);
  const institution = optionalText(form.education_institution);
  const year = optionalNumber(form.education_year);
  if (degree || institution || year !== undefined) {
    body.education = {
      ...(degree ? { degree } : {}),
      ...(institution ? { institution } : {}),
      ...(year !== undefined ? { year } : {}),
    };
  }

  return body;
}
