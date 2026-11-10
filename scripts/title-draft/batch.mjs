#!/usr/bin/env node
// Title-draft batch job. Run by an operator on a developer machine; never in CI.
//
// Reads pending rows from title_draft (oldest first), asks the `claude` CLI to draft
// a Mermaid diagram from each page title, validates it with mermaid.parse, and writes
// the outcome back. Needs the operator's own `claude` login and `wrangler` auth.
// Titles and diagrams are customer data: only counts are printed.
//
//   node scripts/title-draft/batch.mjs --env staging [--limit 50] [--min-confidence 0.7]
//        [--concurrency 4] [--cloud-ids a,b] [--dry-run]
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { decide } from './decide.mjs';

const execFileP = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const promptFile = path.join(here, 'prompt.txt');
const TARGETS = {
  staging: { db: 'conf-zenuml-stg', config: 'wrangler-stg.toml' },
  production: { db: 'conf-zenuml-prod', config: 'wrangler-prod.toml' },
};

function parseArgs(argv) {
  const o = { limit: 50, minConfidence: 0.7, concurrency: 4, dryRun: false, cloudIds: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--env') o.env = next();
    else if (a === '--limit') o.limit = Number(next());
    else if (a === '--min-confidence') o.minConfidence = Number(next());
    else if (a === '--concurrency') o.concurrency = Number(next());
    else if (a === '--cloud-ids') o.cloudIds = next().split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--dry-run') o.dryRun = true;
    else throw new Error(`Unknown argument ${a}`);
  }
  if (!TARGETS[o.env]) throw new Error('--env staging|production is required');
  if (!Number.isInteger(o.limit) || o.limit < 1) throw new Error('--limit must be a positive integer');
  if (!Number.isInteger(o.concurrency) || o.concurrency < 1) throw new Error('--concurrency must be a positive integer');
  if (!(o.minConfidence >= 0 && o.minConfidence <= 1)) throw new Error('--min-confidence must be between 0 and 1');
  return o;
}

const q = s => `'${String(s).replace(/'/g, "''")}'`;
const sha256 = s => createHash('sha256').update(s).digest('hex');

async function d1(target, sql) {
  const { stdout } = await execFileP('pnpm', ['exec', 'wrangler', 'd1', 'execute', target.db, '--remote', '--env', 'production',
    '--config', target.config, '--json', '--command', sql], { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  return (Array.isArray(parsed) ? parsed[0] : parsed)?.results ?? [];
}

function runClaude(message) {
  return new Promise((resolve, reject) => {
    const p = spawn('claude', ['-p', '--model', 'sonnet', '--output-format', 'json', '--system-prompt-file', promptFile,
      '--tools', '', '--safe-mode', '--setting-sources', '', '--no-session-persistence'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('timeout')); }, 180000);
    p.stdout.on('data', d => { out += d; });
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('claude_exit'));
      try { const r = JSON.parse(out).result; typeof r === 'string' ? resolve(r) : reject(new Error('no_result')); } catch { reject(new Error('bad_cli_output')); }
    });
    p.stdin.end(message);
  });
}

async function makeMermaidParser() {
  const { JSDOM } = createRequire(path.join(repo, 'package.json'))('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  try { globalThis.navigator = dom.window.navigator; } catch { /* read-only on newer Node */ }
  globalThis.DOMParser = dom.window.DOMParser; globalThis.Element = dom.window.Element;
  const { default: mermaid } = await import(path.join(repo, 'node_modules/mermaid/dist/mermaid.core.mjs'));
  mermaid.initialize({ startOnLoad: false });
  return text => mermaid.parse(text);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const target = TARGETS[o.env];
  const scope = o.cloudIds.length ? ` AND cloud_id IN (${o.cloudIds.map(q).join(',')})` : '';
  const rows = await d1(target, `SELECT cloud_id, forge_app_id, page_id, title, title_hash, space_name FROM title_draft WHERE status='pending'${scope} ORDER BY requested_at ASC LIMIT ${o.limit}`);
  const counts = { read: rows.length, ready: 0, no_diagram: 0, errors: 0 };
  if (o.dryRun) { console.log(JSON.stringify({ dryRun: true, ...counts })); return; }
  const parse = await makeMermaidParser();
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const r = rows[next++];
      try {
        const text = await runClaude(`Page title: ${r.title}\nSpace: ${r.space_name ?? ''}`);
        const d = await decide(text, o.minConfidence, parse);
        const set = d.status === 'ready'
          ? `status='ready', mermaid=${q(d.mermaid)}, kind=${q(d.kind)}, confidence=${d.confidence}`
          : `status='no_diagram', mermaid=NULL, kind=NULL, confidence=NULL`;
        // Guarded: a title changed (re-queued) mid-run is never overwritten.
        await d1(target, `UPDATE title_draft SET ${set}, generated_at=${Date.now()} WHERE cloud_id=${q(r.cloud_id)} AND forge_app_id=${q(r.forge_app_id)} AND page_id=${q(r.page_id)} AND status='pending' AND title_hash=${q(r.title_hash)}`);
        counts[d.status]++;
      } catch { counts.errors++; } // row stays pending
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency, rows.length) }, worker));
  console.log(JSON.stringify(counts));
}

main().catch(e => { console.error(`title-draft batch failed: ${e.message}`); process.exit(1); });
