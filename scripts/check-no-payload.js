#!/usr/bin/env node
/**
 * Supply-chain tripwire: fails CI (before anything is installed or built) if the tree carries the payload pattern seen in
 * the repeated "lookalike commit" incidents: a root-level `init` file wired into npm scripts as `node init && ...`,
 * or JS/config files with obfuscated (`_0x...`) code or an absurdly long line.
 * Uses only Node built-ins and git, so it is safe to run before `npm ci`.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
const problems = [];

for (const f of files) {
  if (/(^|\/)init$/.test(f)) problems.push(`${f}: a file named "init" (not part of this repo)`);
  if (!fs.existsSync(f) || !/\.(js|cjs|mjs|json|ts|jsx|sh)$/.test(f) && !/(^|\/)init$/.test(f)) continue;
  const text = fs.readFileSync(f, 'utf8');
  if (/\bnode\s+(\.\/)?init\b/.test(text)) problems.push(`${f}: runs "node init"`);
  if (/_0x[0-9a-f]{4,}/.test(text)) problems.push(`${f}: obfuscated code (_0x...)`);
  if (text.split('\n').some((line) => line.length > 5000) && !/package-lock\.json$/.test(f) && !/(^|\/)public\//.test(f)) problems.push(`${f}: has a line over 5000 characters`);
}

if (problems.length) {
  console.error('Payload check FAILED - do not install, build or deploy this commit:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Payload check passed (${files.length} tracked files).`);
