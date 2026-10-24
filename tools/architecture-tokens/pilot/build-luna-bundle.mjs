import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const base = `${process.env.ARCHTOK_DIR ?? process.cwd()}/`;
const manifest = JSON.parse(await readFile(`${base}manifest.json`, 'utf8'));
const space = (await readFile(`${base}space-id`, 'utf8')).trim().replaceAll("'", "''");
const app = (await readFile(`${base}app-id`, 'utf8')).trim().replaceAll("'", "''");
const ids = manifest.sources.map((source) => `'${source.sourceId.replaceAll("'", "''")}'`).join(',');
const sql = `SELECT contentId AS sourceId, latestVersionNumber AS sourceRevision, json_extract(body, '$.raw.value') AS rawValue FROM CustomContent WHERE spaceId = '${space}' AND appId = '${app}' AND status = 'current' AND contentId IN (${ids}) AND json_extract(json_extract(body, '$.raw.value'), '$.diagramType') = 'mermaid'`;
const query = spawnSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'conf-zenuml-prod', '--config', 'wrangler-prod.toml', '--env', 'production', '--remote', '--json', '--command', sql], { encoding: 'utf8' });
if (query.status !== 0) throw new Error('D1 source bundle read failed');
const rows = JSON.parse(query.stdout)[0]?.results ?? [];
const parsed = new Map(rows.map((row) => {
  const raw = JSON.parse(row.rawValue);
  let mermaidCode = String(raw.mermaidCode ?? '').trimStart();
  while (mermaidCode.startsWith('%%')) {
    const newline = mermaidCode.indexOf('\n');
    if (newline < 0) break;
    mermaidCode = mermaidCode.slice(newline + 1).trimStart();
  }
  return [`${row.sourceId}\u0000${row.sourceRevision}`, {
    sourceId: String(row.sourceId), sourceRevision: Number(row.sourceRevision),
    sourceHash: createHash('sha256').update(row.rawValue).digest('hex'), mermaidCode,
  }];
}));
const sources = manifest.sources.map((expected) => {
  const source = parsed.get(`${expected.sourceId}\u0000${expected.sourceRevision}`);
  if (!source || !/^sequenceDiagram(?:\s|$)/.test(source.mermaidCode)) throw new Error('Pinned source bundle is no longer current');
  return { ...source, expectedCandidates: expected.candidates };
});
if (sources.length !== 10) throw new Error('Source bundle count mismatch');
await writeFile(`${base}luna-input.json`, JSON.stringify({ schemaVersion: 1, instructionsVersion: 'architecture-token-openrouter-v1', sources }), { mode: 0o600 });
console.log('pinned-local-bundle-written');
