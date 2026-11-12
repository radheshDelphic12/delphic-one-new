// Run with: node --test client/build-info.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBuildInfo, buildInfoTags } from './build-info.js';

const now = new Date('2026-10-22T12:00:00Z');
const noGit = () => '';

test('values passed by the deploy are used as they are', async () => {
  const info = await resolveBuildInfo({ BUILD_COMMIT_SHA: 'a'.repeat(40), BUILD_COMMIT_DATE: '2026-10-22T17:40:00+05:30', BUILD_COMMIT_MESSAGE: 'fix: a "quoted" <b> message', BUILD_BRANCH: 'main' }, { now, readGit: noGit, fetchFn: null });
  assert.equal(info.short, 'aaaaaaa');
  assert.equal(info.builtAt, '2026-10-22T12:00:00.000Z');
  const tags = buildInfoTags(info);
  assert.match(tags, /name="build-commit" content="a{40}"/);
  assert.match(tags, /name="build-commit-message" content="fix: a &quot;quoted&quot; &lt;b&gt; message"/); // safe inside the attribute
  assert.match(tags, /name="build-deployed-at" content="2026-10-22T12:00:00.000Z"/);
  assert.match(tags, /name="build-deployed-at-ist" content="[^"]*IST"/);
  assert.match(tags, /name="build-branch" content="main"/);
});

test('a Render build (commit id only) asks GitHub for the message and date', async () => {
  let asked = '';
  const fetchFn = async (url) => { asked = url; return { ok: true, json: async () => ({ commit: { message: 'feat: thing\n\nlong body', committer: { date: '2026-10-22T11:00:00Z' } } }) }; };
  const info = await resolveBuildInfo({ RENDER_GIT_COMMIT: 'b'.repeat(40), RENDER_GIT_REPO_SLUG: 'owner/repo', RENDER_GIT_BRANCH: 'staging' }, { now, readGit: noGit, fetchFn });
  assert.equal(asked, `https://api.github.com/repos/owner/repo/commits/${'b'.repeat(40)}`);
  assert.deepEqual([info.message, info.date, info.branch], ['feat: thing', '2026-10-22T11:00:00Z', 'staging']);
});

test('no information at all never breaks the build: everything says unknown', async () => {
  const info = await resolveBuildInfo({}, { now, readGit: noGit, fetchFn: async () => { throw new Error('offline'); } });
  assert.deepEqual([info.sha, info.message, info.date], ['unknown', 'unknown', 'unknown']);
  assert.ok(buildInfoTags(info).includes('name="build-commit" content="unknown"'));
  const failing = await resolveBuildInfo({ RENDER_GIT_COMMIT: 'c'.repeat(40), RENDER_GIT_REPO_SLUG: 'o/r' }, { now, readGit: noGit, fetchFn: async () => { throw new Error('rate limited'); } });
  assert.equal(failing.short, 'ccccccc'); // the id is still shown when GitHub cannot be reached
});

test('a local build falls back to the git checkout', async () => {
  const answers = { 'rev-parse HEAD': 'd'.repeat(40), 'log -1 --format=%cI': '2026-10-22T09:00:00+05:30', 'log -1 --format=%s': 'local subject', 'rev-parse --abbrev-ref HEAD': 'feature' };
  const info = await resolveBuildInfo({}, { now, readGit: (args) => answers[args] || '', fetchFn: null });
  assert.deepEqual([info.short, info.message, info.branch], ['ddddddd', 'local subject', 'feature']);
});
