#!/usr/bin/env node
/**
 * Read one space's current Mermaid sequence diagrams from the D1 mirror into a
 * local corpus file. Phase-1 processing is local: nothing is written back.
 *
 *   node --experimental-strip-types tools/architecture-tokens/read-corpus.mjs \
 *     --space-id <numeric spaceId> --app-id <forge app uuid> --out <corpus.json>
 *
 * The corpus holds raw customer diagram source. Write it only under a
 * git-ignored or private path (see README).
 *
 * D1 `CustomContent.body` is the wrapped Confluence body, so the diagram JSON
 * sits at `$.raw.value` (a string) and `diagramType` / `mermaidCode` inside it.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { isSequenceDiagram } from './extract.ts';

const D1_DATABASE = 'conf-zenuml-prod';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runWrangler(sql) {
  const child = spawn('pnpm', ['exec', 'wrangler', 'd1', 'execute', D1_DATABASE, '--remote', '--json', '--command', sql], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`wrangler exited ${code}: ${stderr.slice(-400)}`));
      // wrangler prints a banner before the JSON payload.
      const start = stdout.indexOf('[');
      try { resolve(JSON.parse(stdout.slice(start))); } catch (e) { reject(new Error(`unparseable wrangler output: ${e.message}`)); }
    });
  });
}

export async function readCorpus({ spaceId, appId }) {
  const sql = `SELECT contentId AS sourceId, latestVersionNumber AS sourceRevision, json_extract(body, '$.raw.value') AS rawValue
    FROM CustomContent
    WHERE spaceId = ${sqlString(spaceId)} AND appId = ${sqlString(appId)} AND status = 'current'
      AND json_extract(json_extract(body, '$.raw.value'), '$.diagramType') = 'mermaid'`;
  const response = await runWrangler(sql);
  const rows = response[0]?.results ?? [];
  const sources = [];
  let notSequence = 0;
  for (const row of rows) {
    let parsed;
    try { parsed = JSON.parse(row.rawValue); } catch { notSequence += 1; continue; }
    const mermaidCode = typeof parsed?.mermaidCode === 'string' ? parsed.mermaidCode : '';
    if (!isSequenceDiagram(mermaidCode)) { notSequence += 1; continue; }
    sources.push({
      sourceId: String(row.sourceId),
      sourceRevision: Number(row.sourceRevision),
      sourceHash: createHash('sha256').update(row.rawValue).digest('hex'),
      mermaidCode,
    });
  }
  sources.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  return { schemaVersion: 1, spaceId: String(spaceId), appId: String(appId), mermaidRows: rows.length, notSequence, sources };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const spaceId = arg('space-id');
  const appId = arg('app-id');
  const out = arg('out');
  if (!spaceId || !appId || !out) {
    console.error('usage: read-corpus.mjs --space-id <id> --app-id <uuid> --out <file>');
    process.exit(2);
  }
  const corpus = await readCorpus({ spaceId, appId });
  await writeFile(out, JSON.stringify(corpus), { mode: 0o600 });
  console.log(JSON.stringify({ mermaidRows: corpus.mermaidRows, sequenceSources: corpus.sources.length, notSequence: corpus.notSequence, out }));
}
