import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const base = `${process.env.ARCHTOK_DIR ?? process.cwd()}/`;
const space = (await readFile(`${base}space-id`, 'utf8')).trim().replaceAll("'", "''");
const app = (await readFile(`${base}app-id`, 'utf8')).trim().replaceAll("'", "''");
const sql = `SELECT contentId AS sourceId, latestVersionNumber AS sourceRevision, json_extract(body, '$.raw.value') AS rawValue FROM CustomContent WHERE spaceId = '${space}' AND appId = '${app}' AND status = 'current' AND json_extract(json_extract(body, '$.raw.value'), '$.diagramType') = 'mermaid'`;
const query = spawnSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'conf-zenuml-prod', '--config', 'wrangler-prod.toml', '--env', 'production', '--remote', '--json', '--command', sql], { encoding: 'utf8' });
if (query.status !== 0) throw new Error('D1 full-bundle read failed');
const sources = (JSON.parse(query.stdout)[0]?.results ?? []).flatMap((row) => {
  const raw = JSON.parse(row.rawValue);
  let mermaidCode = typeof raw.mermaidCode === 'string' ? raw.mermaidCode.trimStart() : '';
  while (mermaidCode.startsWith('%%')) {
    const newline = mermaidCode.indexOf('\n');
    if (newline < 0) return [];
    mermaidCode = mermaidCode.slice(newline + 1).trimStart();
  }
  if (!/^sequenceDiagram(?:\s|$)/.test(mermaidCode)) return [];
  return [{
    sourceId: String(row.sourceId), sourceRevision: Number(row.sourceRevision),
    sourceHash: createHash('sha256').update(row.rawValue).digest('hex'), mermaidCode,
  }];
});
if (sources.length !== 117) throw new Error('Approved full cohort no longer contains 117 current sequence sources');
await writeFile(`${base}luna-full-input.json`, JSON.stringify({ schemaVersion: 1, instructionsVersion: 'architecture-token-luna-v1', cohortSourceCount: sources.length, sources }), { mode: 0o600 });
console.log('full-local-bundle-written');
