import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintComments, sourceFiles } from './lint.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baselinePath = path.join(root, 'scripts/comments/baseline.json');
const update = process.argv.includes('--update');

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};
const results = await lintComments(root, sourceFiles(root));

const current = {};
const unparsed = [];
for (const r of results) {
  if (r.fatal) unparsed.push(`${r.file}: ${r.fatal}`);
  else if (r.comments.length) current[r.file] = r.comments.length;
}

const grown = [];
const shrunk = [];
for (const file of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
  const now = current[file] ?? 0;
  const allowed = baseline[file] ?? 0;
  if (now > allowed) grown.push(`${file}: ${now} comments, baseline allows ${allowed}`);
  else if (now < allowed) shrunk.push(file);
}

const total = (counts) => Object.values(counts).reduce((a, n) => a + n, 0);

if (update) {
  const next = {};
  for (const file of Object.keys(current).sort()) next[file] = Math.min(current[file], baseline[file] ?? current[file]);
  if (existsSync(baselinePath) && grown.length) {
    console.error(`Refusing to raise the baseline. Delete these comments instead:\n${grown.join('\n')}`);
    process.exit(1);
  }
  writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Baseline: ${total(next)} comments in ${Object.keys(next).length} files (was ${total(baseline)}).`);
  process.exit(0);
}

if (unparsed.length) console.warn(`Not checked, parse failed:\n${unparsed.join('\n')}`);
if (grown.length) {
  console.error(
    `Comment ratchet: these files gained comments. Code comments are banned (see .claude/skills/delete-comment);\n` +
      `move decisions to docs/adr and file issues for workarounds.\n${grown.join('\n')}`,
  );
}
if (shrunk.length) {
  console.error(
    `Comment ratchet: ${shrunk.length} files now have fewer comments than the baseline. Lock that in with\n` +
      `  pnpm lint:comments:update\n${shrunk.join('\n')}`,
  );
}
if (grown.length || shrunk.length) process.exit(1);
console.log(`Comment ratchet: ${total(current)} comments remain in ${Object.keys(current).length} files, none added.`);
