#!/usr/bin/env node
// Pull a corpus of real sequence diagrams from prod D1 into diagrams.json.
//
// The output is CUSTOMER CONTENT and is gitignored. Do not commit it, and do
// not paste diagram bodies into issues or PRs — see docs/policies/client-privacy.md.
//
// Usage:  node fetch-corpus.mjs [limit]        (default 100)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const limit = Number(process.argv[2] || 100);
const sql =
  `SELECT contentId, body FROM CustomContent ` +
  `WHERE diagramType='sequence' AND status='current' ` +
  `ORDER BY createdAt DESC LIMIT ${Math.ceil(limit * 1.2)}`;

const raw = execFileSync('npx', [
  'wrangler', 'd1', 'execute', 'conf-zenuml-prod',
  '--remote', '--json', '--command', sql,
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const rows = JSON.parse(raw.slice(raw.indexOf('[')))[0].results;
const out = {};
for (const r of rows) {
  if (Object.keys(out).length >= limit) break;
  try {
    // D1 mirrors the Confluence API envelope: body -> {raw:{value:"<json>"}}
    const inner = JSON.parse(JSON.parse(r.body).raw.value);
    const code = inner.code || '';
    if (code.trim()) out[r.contentId] = code;
  } catch { /* unparseable row — skip */ }
}
writeFileSync('diagrams.json', JSON.stringify(out));
const sizes = Object.values(out).map((c) => c.length).sort((a, b) => a - b);
console.log(`wrote diagrams.json: ${sizes.length} diagrams`);
console.log(`chars min=${sizes[0]} median=${sizes[sizes.length >> 1]} max=${sizes.at(-1)}`);
