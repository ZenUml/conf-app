#!/usr/bin/env node
// Deterministic E2E selection for a PR run (ADR-0007 §5).
//
//   node scripts/e2e-select.mjs --base <sha> --head <sha>     # git diff, prints JSON
//   node scripts/e2e-select.mjs path/one.ts path/two.vue      # explicit file list
//   node scripts/e2e-select.mjs --stdin < changed-files.txt    # one path per line
//   node scripts/e2e-select.mjs --github-output --stdin        # also appends mode=/grep= to $GITHUB_OUTPUT
//
// The map lives in tests/e2e-tests/config/impact-map.mjs. Every changed file
// must match a mapped glob; a file that matches none, or matches a
// RUN_EVERYTHING glob, makes the run unselective (`mode: all`, empty grep).
// `@smoke` is always part of a selection.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { IMPACT, NO_E2E_IMPACT, RUN_EVERYTHING } from '../tests/e2e-tests/config/impact-map.mjs';

export function globToRegExp(glob) {
  // Supports `**` (any depth, including none), `*` (within a segment) and
  // `{a,b}` alternation. Anchored to the whole path.
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else { re += '.*'; }
      } else re += '[^/]*';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      re += '(?:' + glob.slice(i + 1, end).split(',').map(s => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')';
      i = end;
    } else if ('.+^$()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}

/** @returns {{ mode: 'all'|'selected', tags: string[], grep: string, reasons: string[] }} */
export function select(files) {
  const reasons = [];
  const tags = new Set(['@smoke']);
  let all = false;
  for (const file of files) {
    const shared = RUN_EVERYTHING.find(g => globToRegExp(g).test(file));
    if (shared) { reasons.push(`${file}: runs everything (${shared})`); all = true; continue; }
    const none = NO_E2E_IMPACT.find(g => globToRegExp(g).test(file));
    if (none) { reasons.push(`${file}: no E2E impact (${none})`); continue; }
    const hits = IMPACT.filter(({ glob }) => globToRegExp(glob).test(file));
    if (hits.length > 0) {
      const t = [...new Set(hits.flatMap(h => h.tags))];
      t.forEach(x => tags.add(x));
      reasons.push(`${file}: ${t.join(' ')}`);
      continue;
    }
    reasons.push(`${file}: unmapped → runs everything`); all = true;
  }
  if (files.length === 0) { reasons.push('no changed files → runs everything'); all = true; }
  const sorted = [...tags].sort();
  return all
    ? { mode: 'all', tags: [], grep: '', reasons }
    : { mode: 'selected', tags: sorted, grep: sorted.join('|'), reasons };
}

function changedFiles(base, head) {
  return execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const flag = (k) => { const i = args.indexOf(k); if (i >= 0) args.splice(i, 1); return i >= 0; };
  const githubOutput = flag('--github-output');
  const stdin = flag('--stdin');
  const base = opt('--base'), head = opt('--head');
  const files = base && head ? changedFiles(base, head)
    : stdin ? readFileSync(0, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
    : args;
  const result = select(files);
  console.log(JSON.stringify(result, null, 2));
  if (githubOutput && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.mode}\ngrep=${result.grep}\n`);
  }
}
