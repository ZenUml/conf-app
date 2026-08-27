#!/usr/bin/env node
/**
 * Occurrence artifact -> D1 ArchitectureTokenOccurrence. Replace per tenant
 * per run: DELETE the tenant's rows, then batched INSERTs, one transaction.
 *
 *   node --experimental-strip-types tools/architecture-tokens/upload-index.mjs \
 *     --artifact $ARCHTOK_DIR/participant-occurrences.json --cloud-id-file $ARCHTOK_DIR/cloud-id
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const D1_DATABASE = 'conf-zenuml-prod';
const COLUMNS = [
  'cloudId',
  'spaceId',
  'contentId',
  'pageId',
  'contentVersion',
  'actorId',
  'rawLabel',
  'comparisonKey',
  'declKind',
  'lineNumber',
  'runId',
  'indexedAt',
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const q = (value) => `'${String(value).replaceAll("'", "''")}'`;

export function buildUploadStatements(artifact, { cloudId, runId, indexedAt, chunkSize = 400 }) {
  if (artifact.cloudId && artifact.cloudId !== cloudId) {
    throw new Error('cloudId mismatch between artifact and request');
  }
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error('chunkSize must be a positive integer');
  }

  const rows = [];
  for (const source of artifact.sources) {
    if (!source.pageId) throw new Error(`source ${source.sourceId} has no pageId`);
    if (!source.spaceId) throw new Error(`source ${source.sourceId} has no spaceId`);
    for (const participant of source.participants) {
      rows.push([
        q(cloudId),
        q(source.spaceId),
        q(source.sourceId),
        q(source.pageId),
        Number(source.sourceRevision),
        q(participant.actorId),
        q(participant.rawLabel),
        q(participant.comparisonKey),
        q(participant.declKind),
        Number(participant.lineNumber),
        q(runId),
        q(indexedAt),
      ]);
    }
  }

  const statements = [`DELETE FROM ArchitectureTokenOccurrence WHERE cloudId = ${q(cloudId)}`];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const values = rows.slice(i, i + chunkSize)
      .map((row) => `(${row.join(',')})`)
      .join(',');
    statements.push(`INSERT INTO ArchitectureTokenOccurrence (${COLUMNS.join(', ')}) VALUES ${values}`);
  }
  return statements;
}

function runWranglerFile(file) {
  const child = spawn('pnpm', [
    'exec',
    'wrangler',
    'd1',
    'execute',
    D1_DATABASE,
    '--remote',
    '--json',
    '--file',
    file,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => child.on('close', (code) => {
    if (code !== 0) return reject(new Error(`wrangler exited ${code}: ${stderr.slice(-400)}`));
    resolve(stdout);
  }));
}

export async function uploadIndex({ artifact, cloudId, runId, indexedAt, runWrangler = runWranglerFile }) {
  const statements = buildUploadStatements(artifact, { cloudId, runId, indexedAt });
  const dir = await mkdtemp(join(tmpdir(), 'archtok-upload-'));
  const file = join(dir, 'upload.sql');
  try {
    // D1 executes a multi-statement import file atomically; explicit BEGIN/COMMIT
    // are rejected by wrangler, so the statements themselves form the batch.
    await writeFile(file, statements.map((statement) => `${statement};`).join('\n'), { mode: 0o600 });
    await runWrangler(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return {
    statements: statements.length,
    rows: artifact.sources.reduce((count, source) => count + source.participants.length, 0),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const artifactPath = arg('artifact');
  const cloudIdFile = arg('cloud-id-file');
  if (!artifactPath || !cloudIdFile) {
    console.error('usage: upload-index.mjs --artifact <json> --cloud-id-file <file>');
    process.exit(2);
  }
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
  const cloudId = (await readFile(cloudIdFile, 'utf8')).trim();
  const indexedAt = new Date().toISOString();
  const runId = indexedAt.slice(0, 10);
  const result = await uploadIndex({ artifact, cloudId, runId, indexedAt });
  console.log(JSON.stringify({ ...result, runId, indexedAt }));
}
