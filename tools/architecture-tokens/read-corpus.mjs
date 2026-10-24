#!/usr/bin/env node
/**
 * Read one space's current Mermaid and ZenUML sequence diagrams from the D1 mirror into a
 * local corpus file. Phase-1 processing is local: nothing is written back.
 *
 *   node --experimental-strip-types tools/architecture-tokens/read-corpus.mjs \
 *     --space-id <numeric spaceId> --app-id <forge app uuid> --out <corpus.json>
 *
 * The corpus holds raw customer diagram source. Write it only under a
 * git-ignored or private path (see README).
 *
 * D1 `CustomContent.body` is the wrapped Confluence body, so the diagram JSON
 * sits at `$.raw.value` (a string) and `diagramType` / `mermaidCode` or `code` inside it.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { isSequenceDiagram, isZenUmlSequenceDiagram } from './extract.ts';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runWrangler(sql, database) {
  if (!database) throw new Error('need an explicit --database; do not default to production');
  const child = spawn('pnpm', ['exec', 'wrangler', 'd1', 'execute', database, '--remote', '--json', '--command', sql], {
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

/**
 * Direct tenant scope, available once CustomContent carries cloudId (migration 0022).
 * Rows saved before that migration and never viewed have a NULL cloudId, so
 * `tenantSpacesSql` stays as the fallback until the column is populated.
 */
export function tenantContentSql(clientDomain) {
  const host = sqlString(`${clientDomain}.atlassian.net`);
  return `SELECT DISTINCT c.spaceId AS spaceId, t.cloudId AS cloudId
    FROM AtlassianInstance t
    JOIN CustomContent c ON c.cloudId = t.cloudId
    WHERE t.clientDomain = ${host} AND c.status = 'current'`;
}

export function tenantSpacesSql(clientDomain) {
  const host = sqlString(`${clientDomain}.atlassian.net`);
  return `SELECT DISTINCT c.spaceId AS spaceId, t.cloudId AS cloudId
    FROM AtlassianInstance t
    JOIN DiagramAudience a ON a.cloudId = t.cloudId
    JOIN CustomContent c ON c.contentId = a.customContentId
    WHERE t.clientDomain = ${host}`;
}

export function corpusSql({ spaceIds, appId }) {
  const ids = spaceIds.map(sqlString).join(',');
  const appFilter = appId ? ` AND appId = ${sqlString(appId)}` : '';
  return `SELECT contentId AS sourceId, latestVersionNumber AS sourceRevision, spaceId, pageId,
      json_extract(body, '$.raw.value') AS rawValue
    FROM CustomContent
    WHERE spaceId IN (${ids})${appFilter} AND status = 'current'
      AND json_extract(json_extract(body, '$.raw.value'), '$.diagramType') IN ('mermaid','sequence')`;
}

function toSources(rows) {
  const sources = [];
  let notSequence = 0;
  for (const row of rows) {
    let parsed;
    try { parsed = JSON.parse(row.rawValue); } catch { notSequence += 1; continue; }
    const diagramType = parsed?.diagramType;
    const mermaidCode = typeof parsed?.mermaidCode === 'string' ? parsed.mermaidCode : '';
    const code = typeof parsed?.code === 'string' ? parsed.code : '';
    const isMermaidSequence = diagramType === 'mermaid' && isSequenceDiagram(mermaidCode);
    // Parsing here is a source boundary check only; occurrences are extracted
    // later from the same AST-only extractor.
    const isZenUmlSequence = diagramType === 'sequence' && isZenUmlSequenceDiagram(code);
    if (!isMermaidSequence && !isZenUmlSequence) { notSequence += 1; continue; }
    sources.push({
      sourceId: String(row.sourceId),
      sourceRevision: Number(row.sourceRevision),
      sourceHash: createHash('sha256').update(row.rawValue).digest('hex'),
      spaceId: String(row.spaceId),
      pageId: String(row.pageId ?? ''),
      diagramType,
      ...(diagramType === 'sequence' ? { code } : { mermaidCode }),
    });
  }
  sources.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  return { sources, notSequence };
}

function latestRowsBySourceId(rows) {
  const latest = new Map();
  for (const row of rows) {
    const sourceId = String(row.sourceId);
    const current = latest.get(sourceId);
    if (!current || Number(row.sourceRevision) > Number(current.sourceRevision)) latest.set(sourceId, row);
  }
  return [...latest.values()];
}

export async function readCorpus({ clientDomain, spaceId, extraSpaceIds, appId, database, runWrangler: run = runWrangler }) {
  let cloudId = null;
  let spaceIds;
  if (clientDomain) {
    const rows = (await run(tenantSpacesSql(clientDomain), database))[0]?.results ?? [];
    if (rows.length === 0) throw new Error('tenant not found in AtlassianInstance/DiagramAudience');
    cloudId = rows[0].cloudId;
    spaceIds = [...new Set(rows.map((r) => String(r.spaceId)))].sort();
  } else {
    if (!spaceId) throw new Error('need --client-domain or --space-id');
    spaceIds = [String(spaceId)];
  }
  // `tenantSpacesSql` reaches spaces through DiagramAudience, so a space nobody has
  // viewed yet contributes nothing — on lite-stg that hid 7 of 9 spaces and the last
  // run indexed 2. Pass the tenant's remaining space ids (Confluence is the source of
  // truth for which spaces the tenant owns) to close that gap.
  if (extraSpaceIds?.length) {
    spaceIds = [...new Set([...spaceIds, ...extraSpaceIds.map(String)])].sort();
  }
  const rows = (await run(corpusSql({ spaceIds, appId }), database))[0]?.results ?? [];
  // `mermaidRows` is the legacy report field; it reports effective current
  // sequence-family diagrams, not duplicate raw D1 rows.
  const latestRows = latestRowsBySourceId(rows);
  const { sources, notSequence } = toSources(latestRows);
  return { schemaVersion: 1, cloudId, spaceIds, appId: appId ?? null, mermaidRows: latestRows.length, notSequence, sources };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const clientDomain = arg('client-domain');
  const spaceId = arg('space-id');
  const extraSpaceIds = (arg('space-ids') ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  const appId = arg('app-id');
  const database = arg('database');
  const out = arg('out');
  if ((!clientDomain && !spaceId) || !database || !out) {
    console.error('usage: read-corpus.mjs (--client-domain <d> [--space-ids <id,id>] | --space-id <id> [--app-id <uuid>]) --database <d1-name> --out <file>');
    process.exit(2);
  }
  const corpus = await readCorpus({ clientDomain, spaceId, extraSpaceIds, appId, database });
  await writeFile(out, JSON.stringify(corpus), { mode: 0o600 });
  console.log(JSON.stringify({ spaces: corpus.spaceIds.length, mermaidRows: corpus.mermaidRows, sequenceSources: corpus.sources.length, notSequence: corpus.notSequence, out }));
}
