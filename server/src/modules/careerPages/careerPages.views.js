// HTML of the public careers pages. Every link, stylesheet, script and form target is RELATIVE to the page, so the same
// pages work on one.delphic.in/delphic/career and on delphic.in/career (a rewrite in front of this API).
//   list page   : .../career/           (always with the trailing slash, see careerPages.routes.js)
//   job page    : .../career/<slug>     (no trailing slash)
// Everything that comes from the database is escaped here; nothing is ever put into the page unescaped.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { placesOf, modeOf } = require('../jobs/jobSearch');

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

// Whose careers pages these are. Delphic Global keeps its own logo; any other company shows its name (and its logo, when it has one
// that can be reached from the public pages).
const DELPHIC_BRAND = { name: 'Delphic Global', short: 'Delphic', logo: 'assets/logo.svg' };
const safeLogo = (url) => (/^https?:\/\//i.test(String(url || '')) ? url : null);
function brandOf(org) {
  if (!org || org.slug === 'delphic') return DELPHIC_BRAND;
  return { name: org.name, short: org.name, logo: safeLogo(org.logo_url) };
}
const barOf = (brand) => `<header class="bar"><div class="bar-in">${brand.logo ? `<img src="${esc(brand.logo)}" alt="${esc(brand.name)}">` : `<strong class="brand-name">${esc(brand.name)}</strong>`}<span>Careers</span></div></header>`;

function layout({ title, description, canonical, body, wide = false, brand = DELPHIC_BRAND }) {
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
${barOf(brand)}
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

/** One filter group as a collapsible dropdown: every distinct value with the number of jobs that have it (ticked = in the address). */
function filterGroup(label, key, entries, picked) {
  if (!entries.length) return '';
  return `<details class="fgroup" open><summary><span>${label}</span><b class="sel" data-sel="${key}"></b></summary>
<div class="opts">${entries
    .map(({ value, count }) => `<label class="opt"><input type="checkbox" data-filter="${key}" value="${esc(value.toLowerCase())}" data-label="${esc(value)}"${picked.has(value.toLowerCase()) ? ' checked' : ''}><span>${esc(value)}</span><em>${count}</em></label>`)
    .join('')}</div></details>`;
}

const chip = (text, cls = '') => (text ? `<span class="chip ${cls}">${esc(text)}</span>` : '');

/** The query string a job link carries on from the list: where the visitor came from (src) and who referred them (ref). */
function carry({ src, ref }) {
  const q = [src && `src=${encodeURIComponent(src)}`, ref && `ref=${encodeURIComponent(ref)}`].filter(Boolean).join('&');
  return q ? `?${q}` : '';
}

function jobCard(j, link) {
  const where = placesOf(j);
  return `<a class="job" href="${esc(j.slug)}${link}" data-testid="career-job">
<span class="job-main"><span class="jid">${esc(j.job_code)}</span><strong>${esc(j.title)}</strong><span class="chips">${chip(j.department, 'dept')}${chip(where.join(', '), 'place')}${chip(modeOf(j))}${chip(j.employment_type)}</span></span>
<span class="go">View &amp; apply <i aria-hidden="true">&rarr;</i></span></a>`;
}

const SORT_LABEL = [['', 'Best match / newest'], ['newest', 'Newest first'], ['oldest', 'Oldest first'], ['title', 'Title A-Z']];
const csvSet = (v) => new Set(String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));

/** The first page of the (searched) list is in the HTML; career.js asks jobs.json for the rest. */
function listPage({ jobs, pagination, facets, query, src, ref, canonical, brand = DELPHIC_BRAND }) {
  const link = carry({ src, ref });
  const filtered = Boolean(query.q || query.dept || query.loc);
  const count = filtered ? `Showing ${pagination.total} of ${pagination.open_total} roles` : `${pagination.total} open ${pagination.total === 1 ? 'role' : 'roles'}`;
  const body = pagination.open_total
    ? `<section class="hero"><div><p class="eyebrow">Careers at ${esc(brand.short)}</p><h1>Open positions</h1><p class="lead">Pick a role and apply in a few minutes.</p></div><div class="stat"><span class="num">${pagination.open_total}</span><span>open ${pagination.open_total === 1 ? 'role' : 'roles'}</span></div></section>
<div class="list-layout">
<aside class="filters" id="job-filters" aria-label="Filter jobs">
<div class="fhead"><h2>Filters</h2><button type="button" class="link" id="filters-clear">Clear all</button></div>
<label class="search"><span class="sr">Search roles</span><input type="search" id="job-search" name="q" value="${esc(query.q || '')}" placeholder="Search Job ID, title, skill, location" autocomplete="off" maxlength="100"></label>
${filterGroup('Department', 'dept', facets.departments, csvSet(query.dept))}${filterGroup('Location', 'loc', facets.locations, csvSet(query.loc))}
</aside>
<section class="results">
<div class="toolbar"><p class="count" id="job-count" aria-live="polite">${esc(count)}</p><label class="sortby"><span class="sr">Sort roles</span><select id="job-sort">${SORT_LABEL.map(([v, l]) => `<option value="${v}"${(query.sort || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label><div class="pills" id="job-pills"></div></div>
<div id="job-list" data-link="${esc(link)}" data-page="${pagination.page}" data-pages="${pagination.totalPages}" data-open="${pagination.open_total}">
${jobs.map((j) => jobCard(j, link)).join('\n')}
</div>
<div class="empty${pagination.total ? ' hidden' : ''}" id="no-match"><p><strong>No roles match your search.</strong></p><p><button type="button" class="link" id="no-match-clear">Clear search and filters</button></p></div>
<p class="more-wrap"><button type="button" class="more${pagination.page >= pagination.totalPages ? ' hidden' : ''}" id="load-more">Load more roles</button></p>
</section>
</div>
<script src="assets/career.js?v=${ASSET_VERSION}" defer></script>`
    : '<section class="hero"><div><p class="eyebrow">Careers at ${esc(brand.short)}</p><h1>Open positions</h1></div></section>\n<div class="card empty">There are no open positions right now. Please check back soon.</div>';
  return layout({
    title: `Careers | ${brand.name}`,
    description: `Open positions at ${brand.name}.`,
    brand,
    canonical,
    wide: true,
    body,
  });
}

function notFoundPage(brand = DELPHIC_BRAND) {
  return layout({
    brand,
    title: `Job not found | ${brand.name}`,
    description: 'This job is no longer open.',
    body: '<div class="card empty"><p><strong>This job is no longer open.</strong></p><p><a href="./">See other open positions</a></p></div>',
  });
}

const NOTICE = [['0', 'Immediate'], ['15', '15 days'], ['30', '30 days'], ['60', '60 days'], ['90', '90 days'], ['other', 'Other']];

function applyForm(job) {
  const opt = (pairs) => pairs.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  return `<form id="apply-form" data-action="${esc(job.slug)}/apply" novalidate>
<h2>Apply for this job</h2>
<p class="note">Job ID <strong>${esc(job.job_code)}</strong></p>
<div id="apply-error" class="error hidden" role="alert"></div>
<div class="grid">
<label>Full name *<input name="name" required maxlength="200" autocomplete="name"></label>
<label>Email *<input name="email" type="email" required maxlength="200" autocomplete="email"></label>
<label>Phone *<input name="phone" type="tel" required inputmode="numeric" maxlength="14" pattern="[6-9][0-9]{9}" title="10-digit mobile number" placeholder="10-digit mobile number" autocomplete="tel-national"></label>
<label>LinkedIn profile link *<input name="linkedin_url" type="url" required maxlength="300" pattern="https?://([a-zA-Z0-9\\-]+[.])?linkedin[.]com/(in|pub)/.+" title="Your LinkedIn profile link, e.g. https://www.linkedin.com/in/yourname" placeholder="https://www.linkedin.com/in/..."></label>
<label class="wide">Google Drive link to your CV *<input name="cv_url" type="url" required maxlength="500" pattern="https://(drive|docs)[.]google[.]com/.+" title="A Google Drive link to your CV, e.g. https://drive.google.com/file/d/..." placeholder="https://drive.google.com/..."><span class="note">Upload your CV to Google Drive and set sharing to "Anyone with the link can view".</span></label>
<label>Total experience (years) *<input name="experience_years" type="number" required min="0" max="70" step="0.1" inputmode="decimal" placeholder="e.g. 4.5"></label>
<label>Are you working somewhere? *<select name="currently_working" required><option value="">Choose...</option><option value="yes">Yes</option><option value="no">No</option></select></label>
<label>Immediate joiner? *<select name="joiner_status" required><option value="">Choose...</option><option value="yes">Yes</option><option value="no">No</option><option value="serving_notice">Serving notice</option></select></label>
<label>Notice period *<select name="notice_choice" required><option value="">Choose...</option>${opt(NOTICE)}</select></label>
<label id="notice-other-box" class="hidden">Notice period (days) *<input name="notice_other" type="number" min="0" max="365"></label>
<label id="lwd-box" class="hidden">Last working day *<input name="last_working_day" type="date"></label>
<label>Current CTC (LPA) *<input name="current_ctc_lpa" type="number" min="0" step="0.1" required placeholder="e.g. 8.5"></label>
<label>Expected CTC (LPA) *<input name="expected_ctc_lpa" type="number" min="0" step="0.1" required placeholder="e.g. 12"></label>
<label>How can you join? *<select name="work_mode" required><option value="">Choose...</option><option value="remote">Remote</option><option value="onsite">On-site</option><option value="hybrid">Hybrid</option></select></label>
<label class="wide">Referred by (employee name or email, optional)<input name="referred_by" maxlength="200" placeholder="Did an employee refer you?"></label>
<label class="wide">Other skills you have experience in, apart from this job<input name="extra_skills" maxlength="500" placeholder="e.g. React, Node.js, AWS"></label>
<label class="wide">Why you are fit for this role<textarea name="message" rows="3" maxlength="2000"></textarea></label>
<div class="hp" aria-hidden="true"><label>Company website<input name="company_website" tabindex="-1" autocomplete="off"></label></div>
</div>
<p style="margin-top:16px"><button type="submit">Submit application</button></p>
<p class="note">Fields marked * are required. We use these details only for hiring.</p>
</form>
<div id="apply-done" class="done hidden" data-testid="apply-done"><div class="tick">&#10003;</div><p><strong>Thank you, your application has been received.</strong></p><p class="note" data-testid="apply-done-ref">Job ID <strong>${esc(job.job_code)}</strong> &middot; ${esc(job.title)}</p><p class="note">Our recruitment team will contact you if your profile matches.</p></div>`;
}

function jobPage({ job, canonical, brand = DELPHIC_BRAND }) {
  return layout({
    brand,
    title: `${job.title} | ${brand.name} Careers`,
    description: job.description ? String(job.description).replace(/\s+/g, ' ').slice(0, 160) : `Apply for ${job.title} at ${brand.name}.`,
    canonical,
    body: `<article class="card"><p class="jid" data-testid="job-code">Job ID: ${esc(job.job_code)}</p><h1>${esc(job.title)}</h1>${meta(job)}${job.description ? `<div class="desc">${esc(job.description)}</div>` : ''}<p class="note"><a href="./">&larr; All open positions</a></p></article>
<section class="card">${applyForm(job)}</section>
<script src="assets/career.js?v=${ASSET_VERSION}" defer></script>`,
  });
}

module.exports = { esc, listPage, jobPage, notFoundPage, brandOf };
