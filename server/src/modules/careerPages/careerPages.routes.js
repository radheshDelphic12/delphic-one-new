const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const env = require('../../config/env');
const asyncHandler = require('../../utils/asyncHandler');
const { listPage, jobPage, notFoundPage } = require('./careerPages.views');
const publicJobs = require('../publicJobs/publicJobs.service');

// Public careers pages, served by the API as plain HTML:
//   GET  /<org>/career/                list of open jobs            (e.g. /delphic/career/)
//   GET  /<org>/career/<slug>          one job and its apply form
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

// The list always lives at ".../career/" so that its relative links (<slug>, assets/...) resolve inside the same directory.
router.get('/', asyncHandler(async (req, res) => {
  if (!pathOf(req).endsWith('/')) return res.redirect(301, `career/${search(req)}`);
  const src = String(req.query.src || '').slice(0, 40);
  const jobs = (await publicJobs.list(req.params.orgSlug)).map((j) => ({ ...j, src }));
  return html(res, 200, listPage({ jobs, canonical: canonicalFor('/') }));
}));

// A job page has no trailing slash (same reason); a stray slash is removed with a relative redirect.
router.get('/:slug', asyncHandler(async (req, res) => {
  if (pathOf(req).endsWith('/')) return res.redirect(301, `../${encodeURIComponent(req.params.slug)}${search(req)}`);
  const r = await publicJobs.get(req.params.slug, req.params.orgSlug);
  if (r.error) return html(res, 404, notFoundPage());
  return html(res, 200, jobPage({ job: r.job, canonical: canonicalFor(`/${r.job.slug}`) }));
}));

// The CV is optional: PDF / DOC / DOCX up to 5 MB. The form sends multipart; plain JSON (no file) still works.
fs.mkdirSync(env.uploadDir, { recursive: true });
const CV_EXT = ['.pdf', '.doc', '.docx'];
const cvUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, env.uploadDir),
    filename: (req, file, cb) => cb(null, `cv-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (CV_EXT.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('cv_type'))),
}).single('cv');
const takeCv = (req, res, next) => cvUpload(req, res, (err) => {
  if (!err) return next();
  const tooBig = err.code === 'LIMIT_FILE_SIZE';
  return res.status(422).json({ success: false, message: tooBig ? 'Your CV is larger than 5 MB' : 'Attach your CV as a PDF, DOC or DOCX file', errors: [{ path: 'cv', message: tooBig ? 'Your CV is larger than 5 MB' : 'Attach your CV as a PDF, DOC or DOCX file' }] });
});

/** A file really is what its extension says (PDF, old Word, or docx = zip), not a renamed script. */
function looksLikeCv(file) {
  const head = Buffer.alloc(8);
  const fd = fs.openSync(file.path, 'r');
  try { fs.readSync(fd, head, 0, 8, 0); } finally { fs.closeSync(fd); }
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.pdf') return head.slice(0, 4).toString() === '%PDF';
  if (ext === '.docx') return head[0] === 0x50 && head[1] === 0x4b;
  return head[0] === 0xd0 && head[1] === 0xcf;
}

router.post('/:slug/apply', takeCv, asyncHandler(async (req, res) => {
  const file = req.file;
  const drop = () => { if (file) fs.rmSync(file.path, { force: true }); };
  if (file && !looksLikeCv(file)) {
    drop();
    return res.status(422).json({ success: false, message: 'Attach your CV as a PDF, DOC or DOCX file' });
  }
  let r;
  try {
    r = await publicJobs.apply(req.params.slug, req.body, req.params.orgSlug, file ? { filename: file.filename, name: path.basename(file.originalname).slice(0, 150) } : null);
  } catch (err) { drop(); throw err; }
  if (r.error || r.stored === false) drop();
  if (r.error === 'already_applied') return res.status(409).json({ success: false, message: 'You have already applied for this job' });
  if (r.error) return res.status(404).json({ success: false, message: 'This job is no longer open' });
  return res.status(201).json({ success: true, data: { applied: true } });
}));

module.exports = router;

module.exports.visitorIp = visitorIp;
