import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintComments, sourceFiles } from './lint.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dryRun = process.argv.includes('--dry-run');
const targets = process.argv.slice(2).filter((a) => a !== '--dry-run');
if (!targets.length) {
  console.error('Usage: node scripts/comments/strip.mjs [--dry-run] <file-or-directory>...');
  process.exit(1);
}

function list(file, text, comments) {
  const lines = text.split('\n');
  for (const c of comments) {
    const body = lines.slice(c.line - 1, c.endLine).join('\n');
    console.log(`--- ${file}:${c.line}\n${body}`);
  }
}

function strip(text, comments) {
  const lineStarts = [0];
  for (const m of text.matchAll(/\r\n|[\r\n\u2028\u2029]/g)) lineStarts.push(m.index + m[0].length);
  const bom = text.startsWith('\uFEFF') ? 1 : 0;
  const offset = (line, column) => lineStarts[line - 1] + column - 1 + (line === 1 ? bom : 0);
  const drop = new Array(text.length).fill(false);
  for (const c of comments) {
    let start = offset(c.line, c.column);
    let end = offset(c.endLine, c.endColumn);
    const lineEnd = text.indexOf('\n', end) === -1 ? text.length : text.indexOf('\n', end);
    if (text.slice(end, lineEnd).trim() === '') {
      while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--;
    } else {
      while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++;
    }
    drop.fill(true, start, end);
  }

  const before = text.split('\n');
  let pos = 0;
  const after = before.map((line) => {
    let kept = '';
    for (let i = 0; i < line.length; i++) if (!drop[pos + i]) kept += line[i];
    pos += line.length + 1;
    return kept;
  });

  const out = [];
  for (let i = 0; i < before.length; i++) {
    const emptied = before[i].trim() !== '' && after[i].trim() === '';
    if (emptied) {
      let j = i;
      while (j + 1 < before.length && before[j + 1].trim() !== '' && after[j + 1].trim() === '') j++;
      const prevBlank = out.length === 0 || out[out.length - 1].trim() === '';
      const nextBlank = j + 1 < before.length && before[j + 1].trim() === '';
      i = prevBlank && nextBlank ? j + 1 : j;
      continue;
    }
    out.push(after[i]);
  }
  return out.join('\n');
}

const files = sourceFiles(root, targets);
let removed = 0;
for (const result of await lintComments(root, files)) {
  if (result.fatal) {
    console.warn(`skipped ${result.file}: ${result.fatal}`);
    continue;
  }
  if (!result.comments.length) continue;
  const file = path.join(root, result.file);
  const text = readFileSync(file, 'utf8');
  removed += result.comments.length;
  if (dryRun) {
    list(result.file, text, result.comments);
    continue;
  }
  writeFileSync(file, strip(text, result.comments));
  console.log(`${result.file}: removed ${result.comments.length}`);
}
console.log(`${dryRun ? 'Found' : 'Removed'} ${removed} comments in ${files.length} files.`);
