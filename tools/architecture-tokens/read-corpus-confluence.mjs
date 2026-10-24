#!/usr/bin/env node
/**
 * Corpus reader for content that exists in Confluence but not in the D1 mirror.
 *
 * `read-corpus.mjs` reads `CustomContent` in D1. That table is written only by
 * `functions/forge-custom-content.ts`, which runs on a Forge *save* from the app.
 * Content created through the Confluence REST API never passes through that path,
 * so the D1 reader returns zero sources for it and the index comes out empty with
 * no error. This reads the same content straight from Confluence and emits the
 * identical corpus shape, so `extract-corpus.mjs` and `upload-index.mjs` are
 * unchanged.
 *
 *   FORGE_EMAIL=... FORGE_API_TOKEN=... \
 *   node --experimental-strip-types tools/architecture-tokens/read-corpus-confluence.mjs \
 *     --site lite-stg.atlassian.net --space-keys ATS01,ATS02 \
 *     --cloud-id <uuid> \
 *     --type 'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence' \
 *     --out $ARCHTOK_DIR/raw/corpus-confluence.json
 *
 * The corpus holds raw customer diagram source. Write it only under a
 * git-ignored or private path (see README).
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { isSequenceDiagram, isZenUmlSequenceDiagram } from './extract.ts';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function basicAuth(email, token) {
  return 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
}

/**
 * `_links.next` is root-relative ("/rest/api/..."), so `new URL(next, base)`
 * resolves against the origin and drops the "/wiki" context path, which 404s.
 */
export function resolveNext(site, rel) {
  if (!rel) return null;
  return rel.startsWith('http') ? rel : `https://${site}/wiki${rel}`;
}

export async function resolveSpaceIds({ site, spaceKeys, auth, fetchImpl = fetch }) {
  const url = new URL(`https://${site}/wiki/api/v2/spaces`);
  url.searchParams.set('keys', spaceKeys.join(','));
  url.searchParams.set('limit', '250');
  const res = await fetchImpl(url.toString(), { headers: { Authorization: auth, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} resolving space keys`);
  const body = await res.json();
  const map = new Map((body.results ?? []).map((s) => [s.key, String(s.id)]));
  const missing = spaceKeys.filter((k) => !map.has(k));
  if (missing.length) throw new Error(`space keys not found: ${missing.join(',')}`);
  return map;
}

/**
 * CQL search on /content/search is cursor-paged. A `start` parameter is ignored,
 * so incrementing it re-fetches page one forever; follow `_links.next`, and stop
 * as soon as a page adds no ids we do not already hold.
 */
export async function fetchSpaceContent({ site, spaceKey, type, auth, fetchImpl = fetch, limit = 50, maxPages = 200 }) {
  const rows = [];
  const seen = new Set();
  const first = new URL(`https://${site}/wiki/rest/api/content/search`);
  first.searchParams.set('cql', `space=${spaceKey} and type="${type}"`);
  first.searchParams.set('limit', String(limit));
  first.searchParams.set('expand', 'body.raw,version,container');
  let next = first.toString();
  for (let page = 0; next && page < maxPages; page += 1) {
    const res = await fetchImpl(next, { headers: { Authorization: auth, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} on content search for ${spaceKey}`);
    const body = await res.json();
    let fresh = 0;
    for (const row of body.results ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
      fresh += 1;
    }
    if (fresh === 0) break;
    next = resolveNext(site, body?._links?.next);
  }
  return rows;
}

/**
 * Mirrors toSources() in read-corpus.mjs: same field names, same sha256 over the
 * raw JSON string, same sourceId ordering, same explicit-declaration boundary.
 */
export function toSources(rows, spaceId) {
  const sources = [];
  let notSequence = 0;
  for (const row of rows) {
    const rawValue = row?.body?.raw?.value;
    if (typeof rawValue !== 'string') { notSequence += 1; continue; }
    let parsed;
    try { parsed = JSON.parse(rawValue); } catch { notSequence += 1; continue; }
    const diagramType = parsed?.diagramType;
    const mermaidCode = typeof parsed?.mermaidCode === 'string' ? parsed.mermaidCode : '';
    const code = typeof parsed?.code === 'string' ? parsed.code : '';
    const isMermaidSequence = diagramType === 'mermaid' && isSequenceDiagram(mermaidCode);
    const isZenUmlSequence = diagramType === 'sequence' && isZenUmlSequenceDiagram(code);
    if (!isMermaidSequence && !isZenUmlSequence) { notSequence += 1; continue; }
    sources.push({
      sourceId: String(row.id),
      sourceRevision: Number(row?.version?.number ?? 1),
      sourceHash: createHash('sha256').update(rawValue).digest('hex'),
      spaceId: String(spaceId),
      pageId: String(row?.container?.id ?? ''),
      diagramType,
      ...(diagramType === 'sequence' ? { code } : { mermaidCode }),
    });
  }
  sources.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  return { sources, notSequence };
}

export async function readConfluenceCorpus({ site, spaceKeys, cloudId, type, auth, fetchImpl = fetch }) {
  const idByKey = await resolveSpaceIds({ site, spaceKeys, auth, fetchImpl });
  const allSources = [];
  const perSpace = {};
  let fetched = 0;
  let notSequenceTotal = 0;
  for (const spaceKey of spaceKeys) {
    const spaceId = idByKey.get(spaceKey);
    const rows = await fetchSpaceContent({ site, spaceKey, type, auth, fetchImpl });
    const { sources, notSequence } = toSources(rows, spaceId);
    fetched += rows.length;
    notSequenceTotal += notSequence;
    allSources.push(...sources);
    perSpace[spaceKey] = { spaceId, fetched: rows.length, sources: sources.length };
  }
  allSources.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  return {
    schemaVersion: 1,
    cloudId,
    spaceIds: spaceKeys.map((k) => idByKey.get(k)).sort(),
    appId: null,
    mermaidRows: fetched,
    notSequence: notSequenceTotal,
    sources: allSources,
    perSpace,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const site = arg('site');
  const spaceKeys = (arg('space-keys') ?? arg('space-key') ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  const cloudId = arg('cloud-id');
  const type = arg('type');
  const out = arg('out');
  if (!site || spaceKeys.length === 0 || !cloudId || !type || !out) {
    console.error('usage: read-corpus-confluence.mjs --site <host> --space-keys <K1,K2> --cloud-id <uuid> --type <content-type> --out <file>');
    process.exit(2);
  }
  const email = process.env.FORGE_EMAIL || process.env.ATLASSIAN_EMAIL;
  const token = process.env.FORGE_API_TOKEN || process.env.ATLASSIAN_API_TOKEN;
  if (!email || !token) {
    console.error('missing FORGE_EMAIL / FORGE_API_TOKEN');
    process.exit(2);
  }
  const corpus = await readConfluenceCorpus({ site, spaceKeys, cloudId, type, auth: basicAuth(email, token) });
  const { perSpace, ...payload } = corpus;
  await writeFile(out, JSON.stringify(payload), { mode: 0o600 });
  console.log(JSON.stringify({ spaces: spaceKeys.length, fetched: corpus.mermaidRows, sequenceSources: corpus.sources.length, notSequence: corpus.notSequence, perSpace, out }));
}
