import api, { invokeRemote, route } from '@forge/api';

/**
 * Lite -> Full macro conversion executor (phase 1, vendor-operated queue).
 *
 * Runs as the FULL app's hourly scheduled function. Claims at most one
 * ConversionJob for this installation from the authenticated `connect`
 * Remote, converts the job's pages, reports a terminal status, and exits.
 * Installations with an empty queue cost one claim round-trip.
 *
 * Per page: read the ADF, find Lite ecosystem extension nodes, fetch the
 * referenced Lite diagram bodies from the Remote's D1 mirror (custom-content
 * types are app-namespaced, so the Full app cannot read Lite's content from
 * Confluence), create Full-owned custom content, rewrite the extension nodes
 * in place, and publish one new page version.
 *
 * v1 scope: sequence / mermaid / plantuml / openapi / graph. Embed macros and
 * unrecognised keys are counted as skips, never touched. Lite content is left
 * in place — no deletes.
 *
 * Design: docs/superpowers/specs/2026-08-11-lite-to-full-conversion.md
 */

export const LITE_APP_ID = '8ad26115-211f-4216-971b-0540f606303d';
export const FULL_CONTENT_TYPE_PREFIX = 'ac:com.zenuml.confluence-addon:';
const LITE_TITLE_INFIX = ' Lite';
const PAGE_BATCH_LIMIT = 25; // pages per invocation; larger jobs finish over several ticks
const CQL_PAGE_LIMIT = 100;

// ---------------------------------------------------------------------------
// Pure ADF helpers (unit-tested against a live lite-stg capture)
// ---------------------------------------------------------------------------

export interface AdfExtensionNode {
  type: string;
  attrs: {
    extensionType?: string;
    extensionKey?: string;
    text?: string;
    localId?: string;
    parameters?: {
      guestParams?: { customContentId?: string; [k: string]: unknown };
      extensionId?: string;
      extensionTitle?: string;
      forgeEnvironment?: string;
      localId?: string;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/** `<appId>/<envId>/static/<macroKey>` -> parts, or null when not ours. */
export function parseExtensionKey(
  extensionKey: string | undefined,
): { appId: string; environmentId: string; macroKey: string } | null {
  if (!extensionKey) return null;
  const m = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/static\/([A-Za-z0-9-]+)$/.exec(extensionKey);
  if (!m) return null;
  return { appId: m[1], environmentId: m[2], macroKey: m[3] };
}

/** zenuml-sequence-macro-lite -> zenuml-sequence-macro; null when not convertible. */
export function mapLiteMacroKey(liteKey: string): string | null {
  if (!liteKey.startsWith('zenuml-') || !liteKey.endsWith('-lite')) return null;
  const fullKey = liteKey.slice(0, -'-lite'.length);
  // Embed macros reference other diagrams' ids and need an old->new mapping
  // built after everything they point at is converted — phase 2.
  if (fullKey === 'zenuml-embed-macro') return null;
  // Lite ships the AsyncAPI macro (ADR-0005 Option A); Full does NOT — the
  // full/diagramly manifestEdits strip it via test("zenuml-asyncapi"). The
  // custom content would migrate fine (Lite files AsyncAPI under the shared
  // zenuml-content-sequence type, which fullContentTypeForLiteType maps
  // cleanly), but rewriting the ADF to a module Full has no manifest entry for
  // republishes the page with a BROKEN macro where a working diagram was.
  // Leaving it as a Lite macro is strictly better than that.
  //
  // TO LIFT: when Full ships zenuml-asyncapi-macro, delete these two lines.
  // Nothing else here needs to change — the key mapping and content-type
  // mapping above are already generic.
  if (fullKey === 'zenuml-asyncapi-macro') return null;
  return fullKey;
}

export const LITE_CONTENT_TYPE_PREFIX = 'ac:com.zenuml.confluence-addon-lite:';

/**
 * Converted content keeps the SAME custom-content key Lite stored it under —
 * only the app prefix changes. Deriving the key from the macro type looked
 * right and was wrong: `ApWrapper2.getContentKey()` writes every diagram type
 * under `zenuml-content-sequence`, so 2103 of 2104 mirrored graph bodies live
 * there, and a converted graph filed under `zenuml-content-graph` would be
 * content the app itself never creates. Returns null for anything that is not
 * a Lite type — an unrecognised source type skips the macro.
 */
export function fullContentTypeForLiteType(liteType: string | null | undefined): string | null {
  if (!liteType || !liteType.startsWith(LITE_CONTENT_TYPE_PREFIX)) return null;
  return FULL_CONTENT_TYPE_PREFIX + liteType.slice(LITE_CONTENT_TYPE_PREFIX.length);
}

/** Depth-first walk yielding every ecosystem extension node owned by the Lite app. */
export function collectLiteExtensions(adf: unknown): AdfExtensionNode[] {
  const found: AdfExtensionNode[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const n = node as AdfExtensionNode;
    if (
      typeof n.type === 'string' &&
      ['extension', 'bodiedExtension', 'inlineExtension'].includes(n.type) &&
      n.attrs?.extensionType === 'com.atlassian.ecosystem' &&
      parseExtensionKey(n.attrs.extensionKey)?.appId === LITE_APP_ID
    ) {
      found.push(n);
    }
    Object.values(n).forEach(walk);
  };
  walk(adf);
  return found;
}

export interface RewriteIdentity {
  appId: string;
  environmentId: string;
  environmentType: string | null;
}

/**
 * The FIT carries `environmentId` as a full ARI
 * (`ari:cloud:ecosystem::environment/<appId>/<envUuid>`), while an
 * `extensionKey` needs only the trailing UUID. Concatenating the ARI
 * produced a malformed key on the first live staging conversion
 * (2026-08-11, job c5a6d954) — the macro rendered as an unknown extension.
 * Both shapes are accepted so this survives a future FIT change.
 */
export function normalizeEnvironmentId(value: string): string {
  const last = value.split('/').pop() ?? '';
  return /^[0-9a-f-]{36}$/.test(last) ? last : '';
}

/**
 * Rewrite one Lite extension node to Full, in place. Only the app-identity
 * fields, the content pointer, and the visible title change; localId (macro
 * identity — survives page copy) and everything else are preserved.
 */
export function rewriteExtensionNode(
  node: AdfExtensionNode,
  identity: RewriteIdentity,
  fullMacroKey: string,
  newCustomContentId: string,
): void {
  const path = `${identity.appId}/${identity.environmentId}/static/${fullMacroKey}`;
  node.attrs.extensionKey = path;
  if (typeof node.attrs.text === 'string') {
    node.attrs.text = node.attrs.text.replace(LITE_TITLE_INFIX, '');
  }
  const params = node.attrs.parameters;
  if (params) {
    params.extensionId = `ari:cloud:ecosystem::extension/${path}`;
    if (typeof params.extensionTitle === 'string') {
      params.extensionTitle = params.extensionTitle.replace(LITE_TITLE_INFIX, '');
    }
    if (identity.environmentType) params.forgeEnvironment = identity.environmentType;
    if (params.guestParams && typeof params.guestParams === 'object') {
      params.guestParams.customContentId = newCustomContentId;
      params.guestParams.updatedAt = new Date().toISOString();
    }
  }
}

// ---------------------------------------------------------------------------
// Remote + Confluence plumbing
// ---------------------------------------------------------------------------

interface ClaimedJob {
  id: string;
  spaceKey: string | null;
  pageIds: string[] | null;
  dryRun: boolean;
  requestSource: string;
  /** How many pages of an explicit list earlier ticks already processed. */
  pageOffset?: number;
  /** Per-job override of PAGE_BATCH_LIMIT (staging uses it to exercise multi-batch). */
  pageBatchLimit?: number | null;
}

interface JobStats {
  pagesTotal: number;
  pagesSucceeded: number;
  pagesFailed: number;
  macrosConverted: number;
  macrosSkippedEmbed: number;
  // Counted separately from macrosSkippedUnknownKey: these are a deliberate,
  // known skip (Full ships no AsyncAPI macro — see mapLiteMacroKey), not an
  // unrecognised key. A non-zero value here tells the operator exactly what
  // was left behind on Lite rather than burying it in an "unknown" bucket.
  macrosSkippedAsyncApi: number;
  macrosSkippedUnknownKey: number;
  macrosSkippedBodyMissing: number;
  dryRun: boolean;
}

async function remoteJson(path: string, body: Record<string, unknown>): Promise<any> {
  const response = await invokeRemote('connect', {
    path,
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`remote ${path} -> ${response.status}`);
  }
  return response.json();
}

interface ConfluenceInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

async function confluenceJson(path: ReturnType<typeof route>, init?: ConfluenceInit): Promise<any> {
  const response = await api.asApp().requestConfluence(path, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    throw new Error(`confluence ${response.status}`);
  }
  return response.json();
}

/** Effective batch size for this job. */
/**
 * Macro keys the space sweep searches for. Exported so a test can pin the
 * invariant that makes the cursorless sweep terminate: EVERY key here must be
 * convertible by mapLiteMacroKey. See resolvePageIds for what breaks otherwise.
 */
export const LITE_DISCOVERY_MACRO_KEYS = [
  'zenuml-sequence-macro-lite',
  'zenuml-openapi-macro-lite',
  'zenuml-graph-macro-lite',
] as const;

export function batchLimitFor(job: { pageBatchLimit?: number | null }): number {
  const override = job.pageBatchLimit;
  return typeof override === 'number' && override > 0 && override <= PAGE_BATCH_LIMIT
    ? override
    : PAGE_BATCH_LIMIT;
}

/**
 * Resolve THIS TICK's pages: the next slice of an explicit list, or a CQL
 * sweep of the space. A space sweep needs no cursor — a converted page holds
 * no Lite macro and drops out of the query on the next tick.
 */
async function resolvePageIds(job: ClaimedJob): Promise<string[]> {
  const limit = batchLimitFor(job);
  if (job.pageIds && job.pageIds.length > 0) {
    const offset = job.pageOffset ?? 0;
    return job.pageIds.slice(offset, offset + limit);
  }
  if (!job.spaceKey) return [];
  // ONLY keys mapLiteMacroKey can actually convert belong here. The no-cursor
  // sweep above depends on a page dropping out of this query once converted;
  // a key that never converts would match forever, re-reading the same pages
  // every tick and holding slots in the batch. Worse, a batch made entirely of
  // such pages yields macrosConverted === 0, which shouldRequeue reads as
  // "nothing left to do" — the job would report `done` with convertible pages
  // still unmigrated. So `zenuml-asyncapi-macro-lite` is deliberately NOT
  // listed while mapLiteMacroKey skips it.
  //
  // Consequence, accepted: a page whose ONLY Lite macro is AsyncAPI is never
  // visited, so it contributes nothing to macrosSkippedAsyncApi. That stat
  // counts AsyncAPI macros on pages that also carry a convertible macro —
  // a floor on what stayed behind, not a total.
  //
  // TO LIFT: add the key here in the same change that stops mapLiteMacroKey
  // returning null for asyncapi — never before it.
  const cql = `space = "${job.spaceKey}" and macro in (${LITE_DISCOVERY_MACRO_KEYS
    .map((k) => `"${k}"`)
    .join(', ')})`;
  const ids: string[] = [];
  let next: string | undefined;
  do {
    const page = next
      ? await confluenceJson(route`/wiki/rest/api/content/search?cql=${cql}&limit=${String(CQL_PAGE_LIMIT)}&cursor=${next}`)
      : await confluenceJson(route`/wiki/rest/api/content/search?cql=${cql}&limit=${String(CQL_PAGE_LIMIT)}`);
    for (const result of page.results ?? []) {
      if (result?.id) ids.push(String(result.id));
    }
    next = page._links?.next ? new URL(`https://x${page._links.next}`).searchParams.get('cursor') ?? undefined : undefined;
  } while (next && ids.length < limit);
  return ids.slice(0, limit);
}

interface PageDoc {
  id: string;
  title: string;
  status: string;
  version: { number: number };
  spaceId: string;
  adf: unknown;
}

async function readPage(pageId: string): Promise<PageDoc> {
  const p = await confluenceJson(route`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`);
  return {
    id: String(p.id),
    title: p.title,
    status: p.status,
    version: { number: p.version.number },
    spaceId: String(p.spaceId),
    adf: JSON.parse(p.body.atlas_doc_format.value),
  };
}

async function createFullCustomContent(
  type: string,
  title: string | null,
  bodyValue: string,
  pageId: string,
): Promise<string> {
  const created = await confluenceJson(route`/wiki/api/v2/custom-content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      title: title || `Untitled ${new Date().toISOString()}`,
      body: { value: bodyValue, representation: 'raw' },
      pageId,
    }),
  });
  if (!created?.id) throw new Error('custom-content create returned no id');
  return String(created.id);
}

async function publishPage(page: PageDoc, adf: unknown): Promise<void> {
  await confluenceJson(route`/wiki/api/v2/pages/${page.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: page.id,
      status: 'current',
      title: page.title,
      body: { representation: 'atlas_doc_format', value: JSON.stringify(adf) },
      version: {
        number: page.version.number + 1,
        message: 'ZenUML: convert Lite macros to Full',
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// Job execution
// ---------------------------------------------------------------------------

async function convertPage(
  pageId: string,
  identity: RewriteIdentity,
  jobId: string,
  dryRun: boolean,
  stats: JobStats,
): Promise<void> {
  const page = await readPage(pageId);
  const nodes = collectLiteExtensions(page.adf);
  if (nodes.length === 0) {
    stats.pagesSucceeded += 1; // idempotent: nothing Lite left on this page
    return;
  }

  const plans: { node: AdfExtensionNode; fullKey: string; liteContentId: string }[] = [];
  for (const node of nodes) {
    const parsed = parseExtensionKey(node.attrs.extensionKey)!;
    const fullKey = mapLiteMacroKey(parsed.macroKey);
    const liteContentId = node.attrs.parameters?.guestParams?.customContentId;
    if (!fullKey) {
      if (parsed.macroKey === 'zenuml-embed-macro-lite') stats.macrosSkippedEmbed += 1;
      else if (parsed.macroKey === 'zenuml-asyncapi-macro-lite') stats.macrosSkippedAsyncApi += 1;
      else stats.macrosSkippedUnknownKey += 1;
      continue;
    }
    if (typeof liteContentId !== 'string' || !liteContentId) {
      stats.macrosSkippedBodyMissing += 1;
      continue;
    }
    plans.push({ node, fullKey, liteContentId });
  }

  if (plans.length === 0) {
    stats.pagesSucceeded += 1;
    return;
  }

  const bodies = await remoteJson('/conversion/bodies', {
    // jobId is the backend's tenant scope for this read — see handleBodies.
    jobId,
    contentIds: plans.map((p) => p.liteContentId),
  });

  let rewrote = 0;
  for (const plan of plans) {
    const content = bodies.contents?.[plan.liteContentId];
    if (!content) {
      stats.macrosSkippedBodyMissing += 1;
      continue;
    }
    if (dryRun) {
      rewrote += 1;
      continue;
    }
    const fullType = fullContentTypeForLiteType(content.contentType);
    if (!fullType) {
      stats.macrosSkippedUnknownKey += 1;
      continue;
    }
    const newId = await createFullCustomContent(
      fullType,
      content.title ?? null,
      content.body,
      page.id,
    );
    rewriteExtensionNode(plan.node, identity, plan.fullKey, newId);
    rewrote += 1;
  }

  if (!dryRun && rewrote > 0) {
    await publishPage(page, page.adf);
  }
  stats.macrosConverted += rewrote;
  stats.pagesSucceeded += 1;
}

/** A tick that filled its batch AND converted something may have more to do. */
export function shouldRequeue(
  stats: { pagesTotal: number; macrosConverted: number },
  batchLimit: number,
): boolean {
  return stats.pagesTotal >= batchLimit && stats.macrosConverted > 0;
}

export async function runConversionTick(): Promise<void> {
  const claim = await remoteJson('/conversion/claim', {});
  if (!claim.job) return;

  const job: ClaimedJob = claim.job;
  const identity: RewriteIdentity = {
    appId: normalizeEnvironmentId(claim.app?.appId ?? '') || (claim.app?.appId ?? ''),
    environmentId: normalizeEnvironmentId(claim.app?.environmentId ?? ''),
    environmentType: claim.app?.environmentType ?? null,
  };
  // Deliberate: one line per claimed job. The first staging conversions
  // produced a malformed extensionKey and nothing in the logs distinguished
  // "old bundle still deployed" from "normalisation not applied", because the
  // happy path was silent. Identity is app/environment metadata, not tenant
  // content, so it is safe to log.
  console.log('[lite2full] claimed', {
    jobId: job.id,
    rawAppId: claim.app?.appId,
    rawEnvironmentId: claim.app?.environmentId,
    derivedAppId: identity.appId,
    derivedEnvironmentId: identity.environmentId,
    dryRun: job.dryRun,
  });

  if (!identity.appId || !identity.environmentId) {
    await remoteJson('/conversion/report', {
      jobId: job.id,
      status: 'failed',
      failureStage: 'claim',
      stats: { dryRun: job.dryRun },
    });
    return;
  }

  const stats: JobStats = {
    pagesTotal: 0,
    pagesSucceeded: 0,
    pagesFailed: 0,
    macrosConverted: 0,
    macrosSkippedEmbed: 0,
    macrosSkippedAsyncApi: 0,
    macrosSkippedUnknownKey: 0,
    macrosSkippedBodyMissing: 0,
    dryRun: job.dryRun,
  };
  let failureStage: string | null = null;

  try {
    const pageIds = await resolvePageIds(job);
    stats.pagesTotal = pageIds.length;
    for (const pageId of pageIds) {
      try {
        await convertPage(pageId, identity, job.id, job.dryRun, stats);
      } catch (e) {
        stats.pagesFailed += 1;
        console.error('[lite2full] page failed', { pageId, reason: (e as Error).message });
      }
    }
  } catch (e) {
    failureStage = 'page_read';
    console.error('[lite2full] job failed', { jobId: job.id, reason: (e as Error).message });
  }

  const everyPageFailed = stats.pagesTotal > 0 && stats.pagesFailed === stats.pagesTotal;
  const failed = Boolean(failureStage) || everyPageFailed;
  // A full batch means there may be more pages. Ask for another tick rather
  // than reporting a complete migration after 25 pages — but only when this
  // tick actually converted something, so a batch that can make no further
  // progress terminates instead of looping.
  const more = !failed && shouldRequeue(stats, batchLimitFor(job));
  await remoteJson('/conversion/report', {
    jobId: job.id,
    status: failed ? 'failed' : more ? 'requeue' : 'done',
    failureStage: failureStage ?? undefined,
    pagesProcessed: stats.pagesTotal,
    stats,
  });
}

export const scheduledHandler = () => runConversionTick();
