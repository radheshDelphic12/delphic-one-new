// HTML of the public careers pages. Every link, stylesheet, script and form target is RELATIVE to the page, so the same
// pages work on one.delphic.in/delphic/career and on delphic.in/career (a rewrite in front of this API).
//   list page   : .../career/           (always with the trailing slash, see careerPages.routes.js)
//   job page    : .../career/<slug>     (no trailing slash)
// Everything that comes from the database is escaped here; nothing is ever put into the page unescaped.

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function layout({ title, description, canonical, body, wide = false }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index, follow">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<link rel="stylesheet" href="assets/career.css">
</head>
<body>
<header class="bar"><div class="bar-in"><img src="assets/logo.svg" alt="Delphic Global"><span>Careers</span></div></header>
<main${wide ? ' class="wide"' : ''}>
${body}
</main>
</body>
</html>`;
}

function meta(job) {
  const parts = [job.department, job.location, job.employment_type].filter(Boolean);
  return parts.length ? `<div class="meta">${parts.map((p) => `<span>${esc(p)}</span>`).join('')}</div>` : '';
}

// A job's location can name several places ("Gurgaon, Haryana & Ahmedabad"): the filter lists each one separately.
// Split on "&", "/", ";" and "and", never on a comma, so "Gurgaon, Haryana" stays one place.
const locationsOf = (job) => String(job.location || '').split(/\s*(?:&|\/|;|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);

/** Checkbox group for one filter: every distinct value with the number of jobs that have it. */
function filterGroup(label, key, counts) {
  const entries = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) return '';
  return `<fieldset><legend>${label}</legend>${entries
    .map(([value, n]) => `<label class="opt"><input type="checkbox" data-filter="${key}" value="${esc(value.toLowerCase())}"> <span>${esc(value)}</span> <em>${n}</em></label>`)
    .join('')}</fieldset>`;
}

/** `slugPrefix` is '' on the list page, where job links are relative to the list's own directory. */
function listPage({ jobs, canonical }) {
  const departments = new Map();
  const places = new Map();
  for (const j of jobs) {
    if (j.department) departments.set(j.department, (departments.get(j.department) || 0) + 1);
    for (const place of new Set(locationsOf(j))) places.set(place, (places.get(place) || 0) + 1);
  }
  const cards = jobs
    .map((j) => `<a class="card job" href="${esc(j.slug)}${j.src ? `?src=${encodeURIComponent(j.src)}` : ''}" data-testid="career-job" data-dept="${esc(String(j.department || '').toLowerCase())}" data-loc="${esc(locationsOf(j).map((p) => p.toLowerCase()).join('|'))}"><strong>${esc(j.title)}</strong>${meta(j)}</a>`)
    .join('\n');
  const body = jobs.length
    ? `<h1>Open positions</h1>
<p class="meta">Pick a role and apply in a few minutes.</p>
<div class="list-layout">
<aside class="filters card" id="job-filters" aria-label="Filter jobs">
<h2>Filter jobs</h2>
${filterGroup('Department', 'dept', departments)}${filterGroup('Location', 'loc', places)}
<p class="note"><button type="button" class="link" id="filters-clear">Clear filters</button></p>
</aside>
<section>
<p class="note" id="job-count" aria-live="polite"></p>
<div id="job-list">
${cards}
</div>
<div class="card empty hidden" id="no-match">No positions match these filters. <button type="button" class="link" id="no-match-clear">Clear filters</button></div>
</section>
</div>
<script src="assets/career.js" defer></script>`
    : '<h1>Open positions</h1>\n<div class="card empty">There are no open positions right now. Please check back soon.</div>';
  return layout({
    title: 'Careers | Delphic Global',
    description: 'Open positions at Delphic Global.',
    canonical,
    wide: true,
    body,
  });
}

function notFoundPage() {
  return layout({
    title: 'Job not found | Delphic Global',
    description: 'This job is no longer open.',
    body: '<div class="card empty"><p><strong>This job is no longer open.</strong></p><p><a href="./">See other open positions</a></p></div>',
  });
}

const NOTICE = [['0', 'Immediate'], ['15', '15 days'], ['30', '30 days'], ['60', '60 days'], ['90', '90 days'], ['other', 'Other']];

function applyForm(slug) {
  const opt = (pairs) => pairs.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  return `<form id="apply-form" data-action="${esc(slug)}/apply" novalidate>
<h2>Apply for this job</h2>
<div id="apply-error" class="error hidden" role="alert"></div>
<div class="grid">
<label>Full name *<input name="name" required maxlength="200" autocomplete="name"></label>
<label>Email *<input name="email" type="email" required maxlength="200" autocomplete="email"></label>
<label>Phone *<input name="phone" type="tel" required inputmode="numeric" maxlength="14" pattern="[6-9][0-9]{9}" title="10-digit mobile number" placeholder="10-digit mobile number" autocomplete="tel-national"></label>
<label>LinkedIn profile link *<input name="linkedin_url" type="url" required maxlength="300" pattern="https?://([a-zA-Z0-9\\-]+[.])?linkedin[.]com/(in|pub)/.+" title="Your LinkedIn profile link, e.g. https://www.linkedin.com/in/yourname" placeholder="https://www.linkedin.com/in/..."></label>
<label>Attach your CV (PDF, DOC or DOCX, up to 2.5 MB)<input name="cv" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></label>
<label>Are you working somewhere? *<select name="currently_working" required><option value="">Choose...</option><option value="yes">Yes</option><option value="no">No</option></select></label>
<label>Immediate joiner? *<select name="joiner_status" required><option value="">Choose...</option><option value="yes">Yes</option><option value="no">No</option><option value="serving_notice">Serving notice</option></select></label>
<label>Notice period *<select name="notice_choice" required><option value="">Choose...</option>${opt(NOTICE)}</select></label>
<label id="notice-other-box" class="hidden">Notice period (days) *<input name="notice_other" type="number" min="0" max="365"></label>
<label id="lwd-box" class="hidden">Last working day *<input name="last_working_day" type="date"></label>
<label>Current CTC (LPA) *<input name="current_ctc_lpa" type="number" min="0" step="0.1" required placeholder="e.g. 8.5"></label>
<label>Expected CTC (LPA) *<input name="expected_ctc_lpa" type="number" min="0" step="0.1" required placeholder="e.g. 12"></label>
<label>How can you join? *<select name="work_mode" required><option value="">Choose...</option><option value="remote">Remote</option><option value="onsite">On-site</option><option value="hybrid">Hybrid</option></select></label>
<label class="wide">Other skills you have experience in, apart from this job<input name="extra_skills" maxlength="500" placeholder="e.g. React, Node.js, AWS"></label>
<label class="wide">Why you are fit for this role<textarea name="message" rows="3" maxlength="2000"></textarea></label>
<div class="hp" aria-hidden="true"><label>Company website<input name="company_website" tabindex="-1" autocomplete="off"></label></div>
</div>
<p style="margin-top:16px"><button type="submit">Submit application</button></p>
<p class="note">Fields marked * are required. We use these details only for hiring.</p>
</form>
<div id="apply-done" class="done hidden" data-testid="apply-done"><div class="tick">&#10003;</div><p><strong>Thank you, your application has been received.</strong></p><p class="note">Our recruitment team will contact you if your profile matches.</p></div>`;
}

function jobPage({ job, canonical }) {
  return layout({
    title: `${job.title} | Delphic Global Careers`,
    description: job.description ? String(job.description).replace(/\s+/g, ' ').slice(0, 160) : `Apply for ${job.title} at Delphic Global.`,
    canonical,
    body: `<article class="card"><h1>${esc(job.title)}</h1>${meta(job)}${job.description ? `<div class="desc">${esc(job.description)}</div>` : ''}<p class="note"><a href="./">&larr; All open positions</a></p></article>
<section class="card">${applyForm(job.slug)}</section>
<script src="assets/career.js" defer></script>`,
  });
}

module.exports = { esc, listPage, jobPage, notFoundPage };
