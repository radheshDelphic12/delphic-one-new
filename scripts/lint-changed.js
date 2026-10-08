// Lint only the client/server source files changed vs HEAD (staged + unstaged
// + untracked). Full `npm run lint` stays the CI gate.
const { execSync } = require('child_process');

const run = (cmd) => execSync(cmd, { encoding: 'utf8' }).split('\n').filter(Boolean);
const files = [
  ...run('git diff --name-only --diff-filter=d HEAD'),
  ...run('git ls-files --others --exclude-standard'),
].filter((f) => /^(server|client)\/src\/.*\.(js|jsx|mjs)$/.test(f));

if (!files.length) {
  console.log('lint:changed - no changed source files');
} else {
  execSync(`npx eslint ${files.join(' ')}`, { stdio: 'inherit' });
}
