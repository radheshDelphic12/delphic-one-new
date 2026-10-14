// The screening questions a candidate answers when applying (also used when a recruiter adds someone or an employee refers
// someone). One component so the public page, the referral form and "Add applicant" ask exactly the same things.

export const emptyScreening = {
  linkedin_url: '', cv_url: '', currently_working: '', joiner_status: '', notice_choice: '', notice_other: '',
  last_working_day: '', current_ctc_lpa: '', expected_ctc_lpa: '', work_mode: '', extra_skills: '',
};

export const NOTICE_CHOICES = [['0', 'Immediate'], ['15', '15 days'], ['30', '30 days'], ['60', '60 days'], ['90', '90 days'], ['other', 'Other']];
export const JOINER_LABEL = { yes: 'Immediate joiner', no: 'Not immediate', serving_notice: 'Serving notice' };
export const WORK_MODE_LABEL = { remote: 'Remote', onsite: 'On-site', hybrid: 'Hybrid' };

/** The request fields for the answers; blanks are left out. */
export function screeningPayload(s) {
  const notice = s.notice_choice === 'other' ? s.notice_other : s.notice_choice;
  const out = {
    linkedin_url: s.linkedin_url, cv_url: s.cv_url, currently_working: s.currently_working, joiner_status: s.joiner_status,
    notice_period_days: notice, last_working_day: s.joiner_status === 'serving_notice' ? s.last_working_day : '',
    current_ctc_lpa: s.current_ctc_lpa, expected_ctc_lpa: s.expected_ctc_lpa, work_mode: s.work_mode, extra_skills: s.extra_skills,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== '' && v !== undefined && v !== null));
}

/** First thing missing among the required answers, or '' when complete. */
export function missingScreening(s) {
  if (!s.linkedin_url.trim()) return 'Please add your LinkedIn profile link';
  if (!s.currently_working) return 'Please say whether you are working somewhere';
  if (!s.joiner_status) return 'Please choose a joiner status';
  if (!s.notice_choice || (s.notice_choice === 'other' && s.notice_other === '')) return 'Please choose your notice period';
  if (s.joiner_status === 'serving_notice' && !s.last_working_day) return 'Please add your last working day';
  if (s.current_ctc_lpa === '') return 'Please add your current CTC';
  if (s.expected_ctc_lpa === '') return 'Please add your expected CTC';
  if (!s.work_mode) return 'Please choose how you can join';
  return '';
}

/**
 * `required` marks the questions the public form insists on. `inputCls` / `labelCls` let each page keep its own look.
 */
export default function ScreeningFields({ value, onChange, required = false, inputCls, labelCls }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const star = required ? ' *' : '';
  return (
    <div className="space-y-3" data-testid="screening-fields">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>LinkedIn profile link{star}<input className={inputCls} type="url" inputMode="url" placeholder="https://www.linkedin.com/in/…" required={required} maxLength={300} value={value.linkedin_url} onChange={set('linkedin_url')} /></label>
        <label className={labelCls}>Link to your CV (Drive, Dropbox …)<input className={inputCls} type="url" inputMode="url" placeholder="https://…" maxLength={500} value={value.cv_url} onChange={set('cv_url')} /></label>
        <label className={labelCls}>Are you working somewhere?{star}
          <select className={inputCls} required={required} value={value.currently_working} onChange={set('currently_working')}>
            <option value="">Choose…</option><option value="yes">Yes</option><option value="no">No</option>
          </select>
        </label>
        <label className={labelCls}>Immediate joiner?{star}
          <select className={inputCls} required={required} value={value.joiner_status} onChange={set('joiner_status')}>
            <option value="">Choose…</option><option value="yes">Yes</option><option value="no">No</option><option value="serving_notice">Serving notice</option>
          </select>
        </label>
        <label className={labelCls}>Notice period{star}
          <select className={inputCls} required={required} value={value.notice_choice} onChange={set('notice_choice')}>
            <option value="">Choose…</option>
            {NOTICE_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {value.notice_choice === 'other' && (
          <label className={labelCls}>Notice period (days){star}<input className={inputCls} type="number" min="0" max="365" required={required} value={value.notice_other} onChange={set('notice_other')} /></label>
        )}
        {value.joiner_status === 'serving_notice' && (
          <label className={labelCls}>Last working day *<input className={inputCls} type="date" required value={value.last_working_day} onChange={set('last_working_day')} /></label>
        )}
        <label className={labelCls}>Current CTC (LPA){star}<input className={inputCls} type="number" min="0" step="0.1" required={required} placeholder="e.g. 8.5" value={value.current_ctc_lpa} onChange={set('current_ctc_lpa')} /></label>
        <label className={labelCls}>Expected CTC (LPA){star}<input className={inputCls} type="number" min="0" step="0.1" required={required} placeholder="e.g. 12" value={value.expected_ctc_lpa} onChange={set('expected_ctc_lpa')} /></label>
        <label className={labelCls}>How can you join?{star}
          <select className={inputCls} required={required} value={value.work_mode} onChange={set('work_mode')}>
            <option value="">Choose…</option>
            {Object.entries(WORK_MODE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <label className={`block ${labelCls}`}>Other skills you have experience in, apart from this job<input className={inputCls} placeholder="e.g. React, Node.js, AWS" maxLength={500} value={value.extra_skills} onChange={set('extra_skills')} /></label>
    </div>
  );
}
