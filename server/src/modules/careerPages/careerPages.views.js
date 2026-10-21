// HTML of the public careers pages. Every link, stylesheet, script and form target is RELATIVE to the page, so the same
// pages work on one.delphic.in/delphic/career and on delphic.in/career (a rewrite in front of this API).
//   list page   : .../career/           (always with the trailing slash, see careerPages.routes.js)
//   job page    : .../career/<slug>     (no trailing slash)
// Everything that comes from the database is escaped here; nothing is ever put into the page unescaped.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Changes whenever career.css / career.js change, so a browser never keeps an old copy of them.
const ASSET_VERSION = (() => {
  try {
    const h = crypto.createHash('md5');
    for (const f of ['career.css', 'career.js']) h.update(fs.readFileSync(path.join(__dirname, 'assets', f)));
    return h.digest('hex').slice(0, 8);
  } catch (_err) {
    return '1';
  }
})();

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
<link rel="stylesheet" href="assets/career.css?v=${ASSET_VERSION}">
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

// A job's location is free text such as "Indore · On-site", "Remote · Remote" or "Gurgaon, Haryana & Ahmedabad".
// Everything after the "·" is how people work there (On-site / Remote / Hybrid), not a place, so the Location filter
// looks only at the part before it, splits it into separate places, and leaves out state names ("Haryana").
const STATES = new Set(['andhra pradesh', 'assam', 'bihar', 'chhattisgarh', 'delhi', 'goa', 'gujarat', 'haryana', 'himachal pradesh', 'jharkhand', 'karnataka', 'kerala', 'madhya pradesh', 'maharashtra', 'odisha', 'punjab', 'rajasthan', 'tamil nadu', 'telangana', 'uttar pradesh', 'uttarakhand', 'west bengal']);

function placesOf(job) {
  const base = String(job.location || '').split(/[·|]/)[0];
  const seen = new Set();
  const out = [];
  for (const part of base.split(/\s*(?:&|\/|;|,|\band\b)\s*/i)) {
    const name = part.trim();
    const key = name.toLowerCase();
    if (!name || STATES.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** How the job is worked, when the location says so ("On-site" in "Indore · On-site"); empty when it only repeats the place. */
function modeOf(job) {
  const rest = String(job.location || '').split(/[·|]/).slice(1).map((s) => s.trim()).filter(Boolean);
  const place = placesOf(job).map((p) => p.toLowerCase());
  return rest.find((m) => !place.includes(m.toLowerCase())) || '';
}

/** One filter group as a collapsible dropdown: every distinct value with the number of jobs that have it. */
function filterGroup(label, key, counts) {
  const entries = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) return '';
  return `<details class="fgroup" open><summary><span>${label}</span><b class="sel" data-sel="${key}"></b></summary>
<div class="opts">${entries
    .map(([value, n]) => `<label class="opt"><input type="checkbox" data-filter="${key}" value="${esc(value.toLowerCase())}" data-label="${esc(value)}"><span>${esc(value)}</span><em>${n}</em></label>`)
    .join('')}</div></details>`;
}

const chip = (text, cls = '') => (text ? `<span class="chip ${cls}">${esc(text)}</span>` : '');

/** `slugPrefix` is '' on the list page, where job links are relative to the list's own directory. */
function listPage({ jobs, canonical }) {
  const departments = new Map();
  const places = new Map();
  for (const j of jobs) {
    if (j.department) departments.set(j.department, (departments.get(j.department) || 0) + 1);
    for (const place of placesOf(j)) places.set(place, (places.get(place) || 0) + 1);
  }
  const cards = jobs
    .map((j) => {
      const where = placesOf(j);
      return `<a class="job" href="${esc(j.slug)}${j.src ? `?src=${encodeURIComponent(j.src)}` : ''}" data-testid="career-job" data-title="${esc(String(j.title).toLowerCase())}" data-dept="${esc(String(j.department || '').toLowerCase())}" data-loc="${esc(where.map((p) => p.toLowerCase()).join('|'))}">
<span class="job-main"><strong>${esc(j.title)}</strong><span class="chips">${chip(j.department, 'dept')}${chip(where.join(', '), 'place')}${chip(modeOf(j))}${chip(j.employment_type)}</span></span>
<span class="go">View &amp; apply <i aria-hidden="true">&rarr;</i></span></a>`;
    })
    .join('\n');
  const body = jobs.length
    ? `<section class="hero"><div><p class="eyebrow">Careers at Delphic</p><h1>Open positions</h1><p class="lead">Pick a role and apply in a few minutes.</p></div><div class="stat"><span class="num">${jobs.length}</span><span>open ${jobs.length === 1 ? 'role' : 'roles'}</span></div></section>
<div class="list-layout">
<aside class="filters" id="job-filters" aria-label="Filter jobs">
<div class="fhead"><h2>Filters</h2><button type="button" class="link" id="filters-clear">Clear all</button></div>
<label class="search"><span class="sr">Search roles</span><input type="search" id="job-search" placeholder="Search roles" autocomplete="off"></label>
${filterGroup('Department', 'dept', departments)}${filterGroup('Location', 'loc', places)}
</aside>
<section class="results">
<div class="toolbar"><p class="count" id="job-count" aria-live="polite"></p><div class="pills" id="job-pills"></div></div>
<div id="job-list">
${cards}
</div>
<div class="empty hidden" id="no-match"><p><strong>No positions match these filters.</strong></p><p><button type="button" class="link" id="no-match-clear">Clear filters</button></p></div>
</section>
</div>
<script src="assets/career.js?v=${ASSET_VERSION}" defer></script>`
    : '<section class="hero"><div><p class="eyebrow">Careers at Delphic</p><h1>Open positions</h1></div></section>\n<div class="card empty">There are no open positions right now. Please check back soon.</div>';
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
<label>Google Drive link to your CV<input name="cv_url" type="url" maxlength="500" pattern="https://(drive|docs)[.]google[.]com/.+" title="A Google Drive link to your CV, e.g. https://drive.google.com/file/d/..." placeholder="https://drive.google.com/..."><span class="note">Upload your CV to Google Drive and set sharing to "Anyone with the link can view".</span></label>
<label>Total experience (years) *<input name="experience_years" type="number" required min="0" max="70" step="0.1" inputmode="decimal" placeholder="e.g. 4.5"></label>
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
<script src="assets/career.js?v=${ASSET_VERSION}" defer></script>`,
  });
}

module.exports = { esc, listPage, jobPage, notFoundPage };
