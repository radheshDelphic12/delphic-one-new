// Build info for the page <head>: which commit this build is, when that commit was made, its message and when the build ran (a deploy
// builds the site, so "built at" is when it went on the server). Only visible by inspecting the page source: no UI.
//
// Sources, in order: BUILD_COMMIT_SHA / _DATE / _MESSAGE (passed by the deploy: scripts/build-info.sh, docker build args), Render's own
// RENDER_GIT_COMMIT (+ the GitHub API for the message and date, a Render build has no .git), else the local git checkout.
import { execSync } from 'node:child_process';

const clean = (value, max = 300) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function git(args) {
  try { return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; }
}

export async function resolveBuildInfo(env = process.env, { fetchFn = globalThis.fetch, now = new Date(), readGit = git } = {}) {
  let sha = clean(env.BUILD_COMMIT_SHA || env.RENDER_GIT_COMMIT);
  let date = clean(env.BUILD_COMMIT_DATE);
  let message = clean(env.BUILD_COMMIT_MESSAGE);
  let branch = clean(env.BUILD_BRANCH || env.RENDER_GIT_BRANCH);
  if (!sha) {
    sha = clean(readGit('rev-parse HEAD'));
    date = date || clean(readGit('log -1 --format=%cI'));
    message = message || clean(readGit('log -1 --format=%s'));
    branch = branch || clean(readGit('rev-parse --abbrev-ref HEAD'));
  }
  // A Render build has the commit id but no git history: ask GitHub (public repo) for the message and date; never fail the build over it.
  if (sha && (!date || !message) && env.RENDER_GIT_REPO_SLUG && fetchFn) {
    try {
      const res = await fetchFn(`https://api.github.com/repos/${env.RENDER_GIT_REPO_SLUG}/commits/${sha}`, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'delphic-build-info', Accept: 'application/vnd.github+json' } });
      if (res.ok) {
        const body = await res.json();
        message = message || clean(String(body.commit?.message || '').split('\n')[0]);
        date = date || clean(body.commit?.committer?.date);
      }
    } catch { /* offline or rate limited: the id alone is still useful */ }
  }
  return {
    sha: sha || 'unknown',
    short: sha ? sha.slice(0, 7) : 'unknown',
    date: date || 'unknown',
    message: message || 'unknown',
    branch,
    builtAt: now.toISOString(),
  };
}

const ist = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })} IST`;
};

/** The <meta> tags (one per line) to put in the page head. */
export function buildInfoTags(info) {
  const tag = (name, content) => `    <meta name="${name}" content="${esc(content)}" />`;
  return [
    '    <!-- Build info: which commit is live (inspect the page source to read it) -->',
    tag('build-commit', info.sha),
    tag('build-commit-short', info.short),
    tag('build-commit-message', info.message),
    tag('build-commit-date', info.date),
    tag('build-commit-date-ist', info.date === 'unknown' ? 'unknown' : ist(info.date)),
    tag('build-deployed-at', info.builtAt),
    tag('build-deployed-at-ist', ist(info.builtAt)),
    ...(info.branch ? [tag('build-branch', info.branch)] : []),
  ].join('\n');
}

/** Vite plugin: adds the tags to index.html. */
export function buildInfoPlugin() {
  let tags = '';
  return {
    name: 'delphic-build-info',
    async buildStart() { tags = buildInfoTags(await resolveBuildInfo()); },
    transformIndexHtml(html) { return html.replace('</head>', `${tags}\n  </head>`); },
  };
}
