import { json } from '../../OkResponse';
import type { ForgeRequestData } from '../../utils/authenticate';
import {
  COUNT_FIELDS,
  KV_EXPIRATION_TTL_SECONDS,
  SNAPSHOT_SCHEMA_VERSION,
  HttpError,
  addCounts,
  assertCounts,
  authenticateMetricsRequest,
  countBucket,
  countsEqual,
  emptyCounts,
  errorResponse,
  findActiveClaim,
  initialRunManifest,
  isSnapshotEnrolled,
  latestPointerKey,
  metricsKvKey,
  nowIso,
  NO_STORE_HEADERS,
  normalizeCounts,
  parseBody,
  putJson,
  readJsonObject,
  requirePost,
  runPrefix,
  safeDuration,
  safeRowCount,
  scheduleAnalytics,
  sha256Hex,
  type AuthenticatedMetricsContext,
  type ChunkReference,
  type DailyClaim,
  type DomainMetrics,
  type LatestPointer,
  type MacroCounts,
  type RunManifest,
  type SnapshotEnv,
  type SpaceMetrics,
} from './common';
import {
  assertAggregateChunk,
  assertChunkReference,
  assertContentRow,
  assertStoredSpaceManifest,
  type AggregateChunk,
  type AggregateRow,
  type ContentChunk,
  type SpaceManifest,
} from './chunk';
import {
  changedSpaceEvent,
  completedSnapshotEvent,
} from '../../service/macroCountSnapshotAnalytics';

// R2 operations are Cloudflare subrequests and at most six may wait for
// response headers concurrently. Use that exact bound to keep a tenant with
// many discovered spaces inside Forge Remote's response window without
// creating a seventh queued connection.
const R2_VERIFY_CONCURRENCY = 6;

interface CommitBody extends Record<string, unknown> {
  runId: string;
  expectedTypes: string[];
  completedTypes: string[];
  spaceCount: number;
  contentCount: number;
  chunkCount: number;
  aggregateMetrics: MacroCounts;
  aggregateChunks: ChunkReference[];
  durationMs?: number;
}

interface ChangedSpace {
  spaceKey: string;
  previous?: SpaceMetrics;
  current: SpaceMetrics;
  reason: 'new' | 'changed' | 'zeroed';
}

interface CommitCounts {
  spaceCount: number;
  contentCount: number;
  chunkCount: number;
}

async function verifyStoredReference(env: SnapshotEnv, ref: ChunkReference): Promise<string> {
  const object = await env.MACRO_COUNT_SNAPSHOT_BUCKET.get(ref.key);
  if (!object) throw new HttpError(409, 'Referenced snapshot chunk is missing');
  const text = await object.text();
  if (await sha256Hex(text) !== ref.sha256) throw new HttpError(409, 'Referenced snapshot hash mismatch');
  return text;
}

async function loadAndVerifyAggregateRows(
  env: SnapshotEnv,
  claim: DailyClaim,
  refs: ChunkReference[],
): Promise<AggregateRow[]> {
  const expectedPrefix = `${runPrefix(claim)}/spaces-`;
  const rows: AggregateRow[] = [];
  for (const ref of refs) {
    assertChunkReference(ref, expectedPrefix);
    const parsed = JSON.parse(await verifyStoredReference(env, ref)) as AggregateChunk;
    assertAggregateChunk(parsed, claim);
    if (parsed.rows.length !== ref.rowCount) throw new HttpError(409, 'Aggregate reference row count mismatch');
    rows.push(...parsed.rows);
  }
  return rows;
}

async function verifySpace(
  env: SnapshotEnv,
  claim: DailyClaim,
  aggregate: AggregateRow,
): Promise<SpaceManifest> {
  const key = `${runPrefix(claim)}/${aggregate.spaceId}.json`;
  const manifest = await readJsonObject<SpaceManifest>(env.MACRO_COUNT_SNAPSHOT_BUCKET, key);
  if (!manifest) throw new HttpError(409, 'Space manifest is missing');
  assertStoredSpaceManifest(manifest, claim, aggregate.spaceId);
  if (manifest.spaceKey !== aggregate.spaceKey || !countsEqual(manifest.metrics, aggregate.metrics)) {
    throw new HttpError(409, 'Aggregate and space manifest disagree');
  }
  for (const ref of manifest.contentChunks) {
    const parsed = JSON.parse(await verifyStoredReference(env, ref)) as ContentChunk;
    if (
      parsed.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
      || parsed.runId !== claim.runId
      || parsed.spaceId !== aggregate.spaceId
      || !Array.isArray(parsed.rows)
      || parsed.rows.length !== ref.rowCount
    ) throw new HttpError(409, 'Stored content chunk is inconsistent');
    for (const row of parsed.rows) assertContentRow(row);
  }
  return manifest;
}

function changedMetrics(previous: SpaceMetrics | undefined, current: MacroCounts): boolean {
  if (!previous) return true;
  return previous.total !== current.total
    || COUNT_FIELDS.some((field) => (previous[field] ?? 0) !== countBucket(current, field));
}

function compatibleSpace(spaceKey: string, counts: MacroCounts, capturedAt: string): SpaceMetrics {
  return {
    space: spaceKey,
    // normalizeCounts, not `...counts`: this object is PERSISTED (not re-hashed),
    // so an old client's absent bucket becomes an explicit 0 rather than a
    // missing key downstream consumers must guard.
    ...normalizeCounts(counts),
    isLite: true,
    lastUpdated: capturedAt,
  };
}

async function replayCompletedCommit(
  env: SnapshotEnv,
  context: AuthenticatedMetricsContext,
  claim: DailyClaim,
): Promise<Response> {
  const latest = await readJsonObject<LatestPointer>(
    env.MACRO_COUNT_SNAPSHOT_BUCKET,
    latestPointerKey(context.productType, context.cloudId),
  );
  if (latest?.runId !== claim.runId || latest.state !== 'completed') {
    throw new HttpError(409, 'Completed claim has no completed latest pointer');
  }
  return json({ success: true, runId: claim.runId, idempotent: true }, { headers: NO_STORE_HEADERS });
}

function validateCommitBody(body: CommitBody): CommitCounts {
  if (!Array.isArray(body.expectedTypes) || !Array.isArray(body.completedTypes)) {
    throw new HttpError(400, 'Invalid completed type list');
  }
  if (
    body.expectedTypes.length === 0
    || body.completedTypes.length !== body.expectedTypes.length
    || body.expectedTypes.some((type) => !body.completedTypes.includes(type))
  ) throw new HttpError(400, 'The tenant scan is incomplete');
  for (const type of body.expectedTypes) {
    if (typeof type !== 'string' || type.length > 300) throw new HttpError(400, 'Invalid content type');
  }
  const spaceCount = safeRowCount(body.spaceCount);
  const contentCount = safeRowCount(body.contentCount);
  const chunkCount = safeRowCount(body.chunkCount);
  assertCounts(body.aggregateMetrics);
  if (body.aggregateMetrics.total !== contentCount) throw new HttpError(400, 'Aggregate content count mismatch');
  if (!Array.isArray(body.aggregateChunks)) throw new HttpError(400, 'Invalid aggregate chunk list');
  return { spaceCount, contentCount, chunkCount };
}

// Verify every stored chunk the commit references and that it agrees with the
// counts the client claims. Returns the verified aggregate rows.
async function verifyChunks(
  env: SnapshotEnv,
  claim: DailyClaim,
  body: CommitBody,
  { spaceCount, chunkCount }: CommitCounts,
): Promise<AggregateRow[]> {
  const rows = await loadAndVerifyAggregateRows(env, claim, body.aggregateChunks);
  if (rows.length !== spaceCount) throw new HttpError(409, 'Aggregate space count mismatch');
  const seenSpaceIds = new Set<string>();
  const seenSpaceKeys = new Set<string>();
  const verifiedCounts = emptyCounts();
  let verifiedContentChunks = 0;
  for (const row of rows) {
    if (seenSpaceIds.has(row.spaceId) || seenSpaceKeys.has(row.spaceKey)) {
      throw new HttpError(409, 'Duplicate space in aggregate');
    }
    seenSpaceIds.add(row.spaceId);
    seenSpaceKeys.add(row.spaceKey);
  }
  for (let offset = 0; offset < rows.length; offset += R2_VERIFY_CONCURRENCY) {
    const manifests = await Promise.all(
      rows
        .slice(offset, offset + R2_VERIFY_CONCURRENCY)
        .map((row) => verifySpace(env, claim, row)),
    );
    for (const manifest of manifests) {
      addCounts(verifiedCounts, manifest.metrics);
      verifiedContentChunks += manifest.contentChunks.length;
    }
  }
  if (!countsEqual(verifiedCounts, body.aggregateMetrics)) {
    throw new HttpError(409, 'Verified aggregate counts disagree with commit');
  }
  const verifiedChunkCount = verifiedContentChunks + rows.length + body.aggregateChunks.length;
  if (verifiedChunkCount !== chunkCount) throw new HttpError(409, 'Verified chunk count mismatch');
  return rows;
}

// Publish the run manifest as `snapshots_complete`, re-check claim ownership,
// then fence the latest pointer and manifest in `committing`.
async function enterCommitting(
  env: SnapshotEnv,
  context: AuthenticatedMetricsContext,
  body: CommitBody,
  claim: DailyClaim,
  counts: CommitCounts,
): Promise<{ runManifest: RunManifest; committingPointer: LatestPointer }> {
  const manifestKey = `${runPrefix(claim)}/manifest.json`;
  const runManifest: RunManifest = {
    ...initialRunManifest(claim),
    state: 'snapshots_complete',
    expectedTypes: [...body.expectedTypes],
    completedTypes: [...body.completedTypes],
    spaceCount: counts.spaceCount,
    contentCount: counts.contentCount,
    chunkCount: counts.chunkCount,
    aggregateMetrics: body.aggregateMetrics,
    spaceAggregateChunks: body.aggregateChunks,
    updatedAt: nowIso(),
  };
  await putJson(env.MACRO_COUNT_SNAPSHOT_BUCKET, manifestKey, runManifest);

  // Re-check claim ownership immediately before entering managed mode.
  await findActiveClaim(env, context, body.runId);
  const latestKey = latestPointerKey(context.productType, context.cloudId);
  const committingPointer: LatestPointer = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    runId: claim.runId,
    capturedAt: claim.capturedAt,
    state: 'committing',
    cloudId: claim.cloudId,
    productType: claim.productType,
    updatedAt: nowIso(),
  };
  await putJson(env.MACRO_COUNT_SNAPSHOT_BUCKET, latestKey, committingPointer);
  await putJson(env.MACRO_COUNT_SNAPSHOT_BUCKET, manifestKey, {
    ...runManifest,
    state: 'committing',
    updatedAt: committingPointer.updatedAt,
  });
  return { runManifest, committingPointer };
}

// Pure: build the next KV object and the list of spaces that changed, zeroing
// any previously known space that is missing from this run.
function aggregateSpaces(
  previous: DomainMetrics | null,
  rows: AggregateRow[],
  clientDomain: string,
  capturedAt: string,
): { next: DomainMetrics; changedSpaces: ChangedSpace[] } {
  const next: DomainMetrics = { domain: clientDomain, spaces: {} };
  const changedSpaces: ChangedSpace[] = [];
  for (const row of rows) {
    const current = compatibleSpace(row.spaceKey, row.metrics, capturedAt);
    next.spaces[row.spaceKey] = current;
    const before = previous?.spaces?.[row.spaceKey];
    if (changedMetrics(before, row.metrics)) {
      changedSpaces.push({
        spaceKey: row.spaceKey,
        previous: before,
        current,
        reason: before ? 'changed' : 'new',
      });
    }
  }
  for (const [spaceKey, before] of Object.entries(previous?.spaces || {})) {
    if (next.spaces[spaceKey]) continue;
    const zero = compatibleSpace(spaceKey, emptyCounts(), capturedAt);
    next.spaces[spaceKey] = zero;
    if (changedMetrics(before, zero)) {
      changedSpaces.push({ spaceKey, previous: before, current: zero, reason: 'zeroed' });
    }
  }
  return { next, changedSpaces };
}

async function writeMetrics(
  env: SnapshotEnv,
  kvKey: string,
  next: DomainMetrics,
): Promise<void> {
  try {
    await env.confluence_plugin_features.put(kvKey, JSON.stringify(next), {
      expirationTtl: KV_EXPIRATION_TTL_SECONDS,
    });
  } catch (error) {
    // Keep latest.json in `committing`: legacy writes stay fenced and the
    // same complete commit is safe to retry without publishing partial data.
    throw new HttpError(503, 'KV commit failed');
  }
}

// Move latest pointer, run manifest and daily claim to `completed`.
async function advancePointer(
  env: SnapshotEnv,
  context: AuthenticatedMetricsContext,
  active: { claim: DailyClaim; object: R2ObjectBody; key: string },
  runManifest: RunManifest,
  committingPointer: LatestPointer,
): Promise<void> {
  const { claim } = active;
  const latestKey = latestPointerKey(context.productType, context.cloudId);
  const manifestKey = `${runPrefix(claim)}/manifest.json`;
  const completedAt = nowIso();
  await putJson(env.MACRO_COUNT_SNAPSHOT_BUCKET, latestKey, {
    ...committingPointer,
    state: 'completed',
    updatedAt: completedAt,
  } satisfies LatestPointer);
  await putJson(env.MACRO_COUNT_SNAPSHOT_BUCKET, manifestKey, {
    ...runManifest,
    state: 'completed',
    updatedAt: completedAt,
  } satisfies RunManifest);
  const completedClaim: DailyClaim = {
    ...claim,
    state: 'completed',
    updatedAt: completedAt,
  };
  const claimWritten = await putJson(
    env.MACRO_COUNT_SNAPSHOT_BUCKET,
    active.key,
    completedClaim,
    { etagMatches: active.object.etag },
  );
  if (!claimWritten) throw new HttpError(409, 'Daily claim changed before completion');
}

function scheduleCommitAnalytics(
  env: SnapshotEnv,
  waitUntil: ((promise: Promise<unknown>) => void) | undefined,
  context: AuthenticatedMetricsContext,
  claim: DailyClaim,
  body: CommitBody,
  counts: CommitCounts,
  changedSpaces: ChangedSpace[],
): void {
  const analyticsContext = {
    runId: claim.runId,
    capturedAt: claim.capturedAt,
    installationId: claim.installationId,
    productType: claim.productType,
    environmentType: claim.environment || context.environment,
  };
  scheduleAnalytics(env, waitUntil, [
    completedSnapshotEvent({
      ...analyticsContext,
      durationMs: safeDuration(body.durationMs, claim.capturedAt),
      spaceCount: counts.spaceCount,
      contentCount: counts.contentCount,
      changedSpaceCount: changedSpaces.length,
      zeroedSpaceCount: changedSpaces.filter((space) => space.reason === 'zeroed').length,
      counts: body.aggregateMetrics,
      typeRequestCount: body.expectedTypes.length,
      chunkCount: counts.chunkCount,
    }),
    ...changedSpaces.map((space) => changedSpaceEvent({
      ...analyticsContext,
      spaceKey: space.spaceKey,
      reason: space.reason,
      previous: space.previous,
      current: space.current,
    })),
  ]);
}

export async function handleCommit(
  request: Request,
  env: SnapshotEnv,
  data?: ForgeRequestData,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Response> {
  try {
    requirePost(request);
    const body = await parseBody<CommitBody>(request);
    const context = await authenticateMetricsRequest(request, env, {
      backendOnly: true,
      body,
      forgeContext: data?.forgeContext,
    });
    if (!(await isSnapshotEnrolled(env, context))) throw new HttpError(403, 'Snapshot enrollment is disabled');
    const active = await findActiveClaim(env, context, body.runId, ['running', 'completed']);
    const { claim } = active;
    if (claim.state === 'completed') return await replayCompletedCommit(env, context, claim);

    const counts = validateCommitBody(body);
    const rows = await verifyChunks(env, claim, body, counts);
    const { runManifest, committingPointer } = await enterCommitting(env, context, body, claim, counts);

    const kvKey = metricsKvKey(context);
    const previous = await env.confluence_plugin_features.get(kvKey, 'json') as DomainMetrics | null;
    const { next, changedSpaces } = aggregateSpaces(previous, rows, context.clientDomain, claim.capturedAt);
    await writeMetrics(env, kvKey, next);
    await advancePointer(env, context, active, runManifest, committingPointer);

    scheduleCommitAnalytics(env, waitUntil, context, claim, body, counts, changedSpaces);
    return json({
      success: true,
      runId: claim.runId,
      spaceCount: counts.spaceCount,
      contentCount: counts.contentCount,
      changedSpaceCount: changedSpaces.length,
      zeroedSpaceCount: changedSpaces.filter((space) => space.reason === 'zeroed').length,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

export const onRequest: PagesFunction<SnapshotEnv, string, ForgeRequestData> =
  ({ request, env, data, waitUntil }) => handleCommit(request, env, data, waitUntil);
