const fs = require('fs');
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../../config/env');
const asyncHandler = require('../../utils/asyncHandler');
const { listPage, jobPage, notFoundPage } = require('./careerPages.views');
const publicJobs = require('../publicJobs/publicJobs.service');
const { JOB_CODE } = require('../jobs/jobFields');

// Public careers pages, served by the API as plain HTML:
//   GET  /<org>/career/                list of open jobs            (e.g. /delphic/career/)
//   GET  /<org>/career/jobs.json       the same list as JSON (search box, filters, "Load more")
//   GET  /<org>/career/<slug>          one job and its apply form
//   GET  /<org>/career/<JOB-ID>        goes to the job's own page (e.g. DLP-0001)
//   POST /<org>/career/<slug>/apply    the application (JSON)
//   GET  /<org>/career/assets/<file>   stylesheet, script, logo
// The website (delphic.in/career) can show exactly these pages through a rewrite (a proxy, not a redirect). For that to
// work every URL in the pages is relative, and the apply form posts to the same prefix, so no CORS and no asset paths
// of the website are involved. See docs/guides/CAREER-PAGE-REWRITE.md.

const router = express.Router({ mergeParams: true });
const ASSETS_DIR = path.join(__dirname, 'assets');
const ASSETS = {
  'career.css': 'text/css; charset=utf-8',
  'career.js': 'application/javascript; charset=utf-8',
  'logo.svg': 'image/svg+xml',
};
const assetCache = new Map();

function assetBody(name) {
  if (!assetCache.has(name)) assetCache.set(name, fs.readFileSync(path.join(ASSETS_DIR, name)));
  return assetCache.get(name);
}

/** The visitor's address. Behind the website's proxy our nginx only sees that proxy, so the first X-Forwarded-For entry wins. */
function visitorIp(req) {
  const first = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(first) ? first : req.ip;
}

const canonicalFor = (suffix) => (env.publicCareersBase ? `${env.publicCareersBase}${suffix}` : '');
const search = (req) => {
  const i = req.originalUrl.indexOf('?');
  return i === -1 ? '' : req.originalUrl.slice(i);
};
const pathOf = (req) => req.originalUrl.split('?')[0];
const html = (res, status, body) => {
  res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }).send(body);
};

// Limits apply to the application only: per visitor, plus one overall limit as a backstop. Not active in the Jest suite.
if (env.nodeEnv !== 'test') {
  router.post('/:slug/apply', rateLimit({ windowMs: 60 * 60 * 1000, max: 20, keyGenerator: visitorIp, standardHeaders: true, legacyHeaders: false, validate: false }));
  router.post('/:slug/apply', rateLimit({ windowMs: 60 * 60 * 1000, max: 600, keyGenerator: () => 'all', standardHeaders: true, legacyHeaders: false, validate: false }));
}

router.get('/assets/:file', (req, res) => {
  const type = ASSETS[req.params.file];
  if (!type) return res.status(404).type('text/plain').send('Not found');
  return res.status(200).set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=300' }).send(assetBody(req.params.file));
});

const PAGE_SIZE = 20;
/** The list's query string (?q=&dept=&loc=&sort=&page=) as the search expects it. */
const listQuery = (req) => ({ q: req.query.q, dept: req.query.dept, loc: req.query.loc, sort: req.query.sort, page: req.query.page, limit: Math.min(50, Number(req.query.limit) || PAGE_SIZE) });

// The list always lives at ".../career/" so that its relative links (<slug>, assets/...) resolve inside the same directory.
// The first page of results is part of the HTML (search engines, no-JavaScript); the script loads more through jobs.json.
router.get('/', asyncHandler(async (req, res) => {
  if (!pathOf(req).endsWith('/')) return res.redirect(301, `career/${search(req)}`);
  const src = String(req.query.src || '').slice(0, 40);
  const ref = String(req.query.ref || '').slice(0, 80);
  const query = listQuery(req);
  const r = await publicJobs.search(req.params.orgSlug, query);
  return html(res, 200, listPage({ ...r, query: { ...query, sort: String(req.query.sort || '') }, src, ref, canonical: canonicalFor('/') }));
}));

router.get('/jobs.json', asyncHandler(async (req, res) => {
  const r = await publicJobs.search(req.params.orgSlug, listQuery(req));
  res.set('Cache-Control', 'no-cache');
  return res.json({ success: true, data: r.jobs, pagination: r.pagination, facets: r.facets, sort: r.sort });
}));

// A job page has no trailing slash (same reason); a stray slash is removed with a relative redirect.
router.get('/:slug', asyncHandler(async (req, res) => {
  if (pathOf(req).endsWith('/')) return res.redirect(301, `../${encodeURIComponent(req.params.slug)}${search(req)}`);
  // a Job ID in the address (/career/DLP-0001) goes to that job's page; the query string (src, ref) is kept
  if (JOB_CODE.test(req.params.slug)) {
    const target = await publicJobs.slugForCode(req.params.slug, req.params.orgSlug);
    if (target) return res.redirect(302, `${encodeURIComponent(target)}${search(req)}`);
  }
  const r = await publicJobs.get(req.params.slug, req.params.orgSlug);
  if (r.error) return html(res, 404, notFoundPage());
  return html(res, 200, jobPage({ job: r.job, canonical: canonicalFor(`/${r.job.slug}`) }));
}));

// The CV is a mandatory Google Drive link (cv_url), validated with the rest of the answers. No files are stored on the server.
router.post('/:slug/apply', asyncHandler(async (req, res) => {
  const r = await publicJobs.apply(req.params.slug, req.body, req.params.orgSlug);
  if (r.error === 'already_applied') return res.status(409).json({ success: false, message: 'You have already applied for this job' });
  if (r.error) return res.status(404).json({ success: false, message: 'This job is no longer open' });
  return res.status(201).json({ success: true, data: { applied: true, job_code: r.job_code || null, title: r.title || null } });
}));

module.exports = router;

module.exports.visitorIp = visitorIp;
