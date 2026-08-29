import {
  CLAIM_STALE_MS,
  COUNT_FIELDS,
  KV_EXPIRATION_TTL_SECONDS,
  SNAPSHOT_SCHEMA_VERSION,
  HttpError,
  assertCounts,
  authenticateMetricsRequest,
  claimKey,
  countBucket,
  countsEqual,
  errorResponse,
  isSnapshotEnrolled,
  jsonResponse,
  latestPointerKey,
  metricsKvKey,
  readJsonObject,
  runPrefix,
  sha256Hex,
  type AuthenticatedMetricsContext,
  type DailyClaim,
  type DomainMetrics,
  type LatestPointer,
  type MacroCounts,
  type SnapshotEnv,
  type SpaceMetrics,
} from './common';
import type { ForgeRequestData } from '../../utils/authenticate';
import { mixpanelImportServiceEvents } from '../../service/mixpanelService';
import {
  changedSpaceEvent,
  completedSnapshotEvent,
  failedSnapshotEvent,
} from '../../service/macroCountSnapshotAnalytics';

const JSON_METADATA = { contentType: 'application/json' };
const MAX_CHUNK_BODY_BYTES = 450 * 1024;
// R2 operations are Cloudflare subrequests and at most six may wait for
// response headers concurrently. Use that exact bound to keep a tenant with
// many discovered spaces inside Forge Remote's response window without
// creating a seventh queued connection.
const R2_VERIFY_CONCURRENCY = 6;
const FAILURE_STAGES = [
  'claim', 'scan', 'pagination', 'space_map', 'chunk_upload', 'commit', 'unknown',
] as const;
const FAILURE_REASONS = [
  'confluence_429', 'confluence_4xx', 'confluence_5xx', 'confluence_network',
  'invalid_pagination', 'missing_space_id', 'unresolved_space_id',
  'invalid_chunk', 'r2_write_failed', 'kv_write_failed', 'timeout', 'unknown',
] as const;

type FailureStage = typeof FAILURE_STAGES[number];
type FailureReason = typeof FAILURE_REASONS[number];

interface ContentSnapshotRow {
  contentId: string;
  pageId: string | null;
  type: string;
  status: string;
  versionNumber: number | null;
  versionCreatedAt: string | null;
  diagramType: string;
  logicalIdHash: string;
  parseStatus: 'parsed' | 'missing_body' | 'invalid_json' | 'unknown_diagram_type';
}

interface ContentChunk {
  schemaVersion: 1;
  runId: string;
  spaceId: string;
  rows: ContentSnapshotRow[];
}

interface ChunkReference {
  key: string;
  rowCount: number;
  sha256: string;
}

interface SpaceManifest {
  schemaVersion: 1;
  runId: string;
  capturedAt: string;
  cloudId: string;
  productType: 'lite';
  spaceId: string;
  spaceKey: string;
  metrics: MacroCounts;
  contentChunks: ChunkReference[];
}

type SpaceManifestUpload = Omit<SpaceManifest, 'cloudId' | 'productType'>;

interface AggregateRow {
  spaceId: string;
  spaceKey: string;
  metrics: MacroCounts;
}

interface AggregateChunk {
  schemaVersion: 1;
  runId: string;
  rows: AggregateRow[];
}

interface RunManifest {
  schemaVersion: 1;
  runId: string;
  capturedAt: string;
  state: 'running' | 'snapshots_complete' | 'committing' | 'completed' | 'failed';
  appId: string;
  installationId: string;
  cloudId: string;
  productType: 'lite';
  expectedTypes: string[];
  completedTypes: string[];
  spaceCount: number;
  contentCount: number;
  chunkCount: number;
  aggregateMetrics: MacroCounts;
  spaceAggregateChunks: ChunkReference[];
  failureStage?: FailureStage;
  failureReason?: FailureReason;
  updatedAt: string;
}

interface ClaimResponse {
  eligible: boolean;
  claimed?: boolean;
  duplicate?: boolean;
  completed?: boolean;
  runId?: string;
  capturedAt?: string;
}

interface UploadBody extends Record<string, unknown> {
  runId: string;
  kind: 'content' | 'space' | 'aggregate';
  spaceId?: string;
  index?: number;
  sha256: string;
  rowCount: number;
  payload: unknown;
}

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

interface FailBody extends Record<string, unknown> {
  runId: string;
  failureStage?: FailureStage;
  failureReason?: FailureReason;
  completedTypes?: string[];
  processedContents?: number;
  processedSpaces?: number;
  chunkCount?: number;
  durationMs?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeDuration(value: unknown, capturedAt: string): number {
  if (Number.isFinite(value) && (value as number) >= 0) return Math.round(value as number);
  return Math.max(0, Date.now() - Date.parse(capturedAt));
}

function scheduleAnalytics(
  env: SnapshotEnv,
  waitUntil: ((promise: Promise<unknown>) => void) | undefined,
  events: Parameters<typeof mixpanelImportServiceEvents>[0],
): void {
  if (!env.MIXPANEL_TOKEN || events.length === 0) return;
  const delivery = mixpanelImportServiceEvents(events, env.MIXPANEL_TOKEN).catch((error) => {
    console.warn('[macro-count:snapshot] Mixpanel delivery failed', {
      reason: error instanceof Error ? error.name : 'unknown_error',
      eventCount: events.length,
    });
  });
  if (waitUntil) waitUntil(delivery);
  else void delivery;
}

function emptyCounts(): MacroCounts {
  return {
    total: 0,
    sequence: 0,
    graph: 0,
    openapi: 0,
    mermaid: 0,
    plantuml: 0,
    asyncapi: 0,
    unknown: 0,
  };
}

function addCounts(target: MacroCounts, source: MacroCounts): void {
  target.total += source.total;
  // countBucket, not source[field]: a client predating a bucket omits it, and
  // `+= undefined` would poison the whole aggregate with NaN.
  for (const field of COUNT_FIELDS) target[field] += countBucket(source, field);
}

function indexSuffix(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index > 999_999) {
    throw new HttpError(400, 'Invalid chunk index');
  }
  return String(index).padStart(6, '0');
}

function safeIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._~-]{1,200}$/.test(value)) {
    throw new HttpError(400, `Invalid ${field}`);
  }
  return value;
}

function safeHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new HttpError(400, 'Invalid SHA-256 hash');
  }
  return value;
}

function safeRowCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new HttpError(400, 'Invalid row count');
  }
  return value as number;
}

async function parseBody<T extends Record<string, unknown>>(request: Request): Promise<T> {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_CHUNK_BODY_BYTES) {
    throw new HttpError(413, 'Snapshot request body is too large');
  }
  try {
    return await request.json<T>();
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function requirePost(request: Request): void {
  if (request.method !== 'POST') throw new HttpError(405, 'Method Not Allowed');
}

function initialRunManifest(claim: DailyClaim): RunManifest {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    runId: claim.runId,
    capturedAt: claim.capturedAt,
    state: 'running',
    appId: claim.appId,
    installationId: claim.installationId,
    cloudId: claim.cloudId,
    productType: 'lite',
    expectedTypes: [],
    completedTypes: [],
    spaceCount: 0,
    contentCount: 0,
    chunkCount: 0,
    aggregateMetrics: emptyCounts(),
    spaceAggregateChunks: [],
    updatedAt: claim.updatedAt,
  };
}

async function putJson(
  bucket: R2Bucket,
  key: string,
  value: unknown,
  onlyIf?: R2Conditional,
): Promise<R2Object | null> {
  return bucket.put(key, JSON.stringify(value), {
    ...(onlyIf ? { onlyIf } : {}),
    httpMetadata: JSON_METADATA,
  });
}

async function loadClaimObject(
  env: SnapshotEnv,
  context: AuthenticatedMetricsContext,
  capturedAt: string,
): Promise<{ claim: DailyClaim; object: R2ObjectBody } | null> {
  const object = await env.MACRO_COUNT_SNAPSHOT_BUCKET.get(
    claimKey(context.productType, context.cloudId, capturedAt),
  );
  if (!object) return null;
  let claim: DailyClaim;
  try {
    claim = await object.json<DailyClaim>();
  } catch {
    throw new HttpError(409, 'Daily claim is malformed');
  }
  return { claim, object };
}

async function findActiveClaim(
  env: SnapshotEnv,
  context: AuthenticatedMetricsContext,
  runId: unknown,
  allowedStates: DailyClaim['state'][] = ['running'],
): Promise<{ claim: DailyClaim; object: R2ObjectBody; key: string }> {
  const id = safeIdentifier(runId, 'runId');
  // A run is always claimed for the current UTC date. A Forge invocation is
  // at most 15 minutes, so crossing midnight is handled by checking today and
  // yesterday without accepting an arbitrary body-supplied R2 prefix.
  const dates = [new Date(), new Date(Date.now() - 24 * 60 * 60 * 1000)];
  for (const date of dates) {
    const capturedAt = date.toISOString();
    const key = claimKey(context.productType, context.cloudId, capturedAt);
    const object = await env.MACRO_COUNT_SNAPSHOT_BUCKET.get(key);
    if (!object) continue;
    let claim: DailyClaim;
    try {
      claim = await object.json<DailyClaim>();
    } catch {
      throw new HttpError(409, 'Daily claim is malformed');
    }
    if (claim.runId === id) {
      if (!allowedStates.includes(claim.state)) {
        throw new HttpError(409, 'Run no longer owns the daily claim');
      }
      if (
        claim.cloudId !== context.cloudId
        || claim.installationId !== context.installationId
        || claim.appId !== context.appId
        || claim.productType !== context.productType
      ) {
        throw new HttpError(403, 'Run claim identity mismatch');
      }
      return { claim, object, key };
    }
  }
  throw new HttpError(409, 'Active run claim not found');
}

function isStale(claim: DailyClaim): boolean {
  const updated = Date.parse(claim.updatedAt || claim.capturedAt);
  return !Number.isFinite(updated) || Date.now() - updated >= CLAIM_STALE_MS;
}

export async function handleClaim(
  request: Request,
  env: SnapshotEnv,
  data?: ForgeRequestData,
): Promise<Response> {
  try {
    requirePost(request);
    const body = await parseBody<Record<string, unknown>>(request);
    const context = await authenticateMetricsRequest(request, env, {
      backendOnly: true,
      body,
      forgeContext: data?.forgeContext,
    });
    if (!(await isSnapshotEnrolled(env, context))) {
      return jsonResponse({ eligible: false } satisfies ClaimResponse);
    }

    const capturedAt = nowIso();
    const key = claimKey(context.productType, context.cloudId, capturedAt);
    const runId = crypto.randomUUID();
    const claim: DailyClaim = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      runId,
      capturedAt,
      state: 'running',
      appId: context.appId,
      installationId: context.installationId,
      cloudId: context.cloudId,
      productType: context.productType,
      environment: context.environment,
      updatedAt: capturedAt,
    };

    let written = await putJson(
      env.MACRO_COUNT_SNAPSHOT_BUCKET,
      key,
      claim,
      { etagDoesNotMatch: '*' },
    );
    if (!written) {
      const existing = await loadClaimObject(env, context, capturedAt);
      if (!existing) throw new HttpError(409, 'Daily claim changed concurrently');
      if (existing.claim.state === 'completed') {
        return jsonResponse({
          eligible: true,
          duplicate: true,
          completed: true,
          runId: existing.claim.runId,
          capturedAt: existing.claim.capturedAt,
        } satisfies ClaimResponse);
      }
      if (existing.claim.state === 'running' && !isStale(existing.claim)) {
        return jsonResponse({
          eligible: true,
          duplicate: true,
          runId: existing.claim.runId,
          capturedAt: existing.claim.capturedAt,
        } satisfies ClaimResponse);
      }
      if (existing.claim.state !== 'failed' && !isStale(existing.claim)) {
        throw new HttpError(409, 'Daily claim cannot be replaced');
      }
      written = await putJson(
        env.MACRO_COUNT_SNAPSHOT_BUCKET,
        key,
        claim,
        { etagMatches: existing.object.etag },
      );
      if (!written) throw new HttpError(409, 'Daily claim changed concurrently');
    }

    await putJson(
      env.MACRO_COUNT_SNAPSHOT_BUCKET,
      `${runPrefix(claim)}/manifest.json`,
      initialRunManifest(claim),
    );
    return jsonResponse({
      eligible: true,
      claimed: true,
      runId,
      capturedAt,
    } satisfies ClaimResponse, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

function assertContentRow(row: unknown): asserts row is ContentSnapshotRow {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new HttpError(400, 'Invalid content row');
  }
  const record = row as Record<string, unknown>;
  const allowedKeys = new Set([
    'contentId', 'pageId', 'type', 'status', 'versionNumber', 'versionCreatedAt',
    'diagramType', 'logicalIdHash', 'parseStatus',
  ]);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) throw new HttpError(400, `Forbidden content row field: ${key}`);
  }
  safeIdentifier(record.contentId, 'contentId');
  if (record.pageId != null) safeIdentifier(record.pageId, 'pageId');
  if (typeof record.type !== 'string' || record.type.length > 300) throw new HttpError(400, 'Invalid content type');
  if (typeof record.status !== 'string' || record.status.length > 50) throw new HttpError(400, 'Invalid content status');
  if (record.versionNumber != null && (!Number.isSafeInteger(record.versionNumber) || (record.versionNumber as number) < 0)) {
    throw new HttpError(400, 'Invalid version number');
  }
  if (record.versionCreatedAt != null && (typeof record.versionCreatedAt !== 'string' || record.versionCreatedAt.length > 50)) {
    throw new HttpError(400, 'Invalid version timestamp');
  }
  if (typeof record.diagramType !== 'string' || record.diagramType.length > 30) throw new HttpError(400, 'Invalid diagram type');
  safeHash(record.logicalIdHash);
  if (!['parsed', 'missing_body', 'invalid_json', 'unknown_diagram_type'].includes(String(record.parseStatus))) {
    throw new HttpError(400, 'Invalid parse status');
  }
}

function assertChunkReference(reference: unknown, prefix: string): asserts reference is ChunkReference {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    throw new HttpError(400, 'Invalid chunk reference');
  }
  const ref = reference as Record<string, unknown>;
  if (typeof ref.key !== 'string' || !ref.key.startsWith(prefix)) {
    throw new HttpError(400, 'Chunk reference is outside the active run');
  }
  safeHash(ref.sha256);
  safeRowCount(ref.rowCount);
}

function assertSpaceManifestUpload(
  payload: unknown,
  claim: DailyClaim,
  spaceId: string,
): asserts payload is SpaceManifestUpload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, 'Invalid space manifest');
  }
  const value = payload as SpaceManifestUpload & Record<string, unknown>;
  if (value.cloudId != null || value.productType != null) {
    throw new HttpError(400, 'Space manifest identity must be derived from FIT');
  }
  if (
    value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
    || value.runId !== claim.runId
    || value.capturedAt !== claim.capturedAt
    || value.spaceId !== spaceId
  ) throw new HttpError(400, 'Space manifest identity mismatch');
  safeIdentifier(value.spaceKey, 'spaceKey');
  assertCounts(value.metrics);
  if (!Array.isArray(value.contentChunks)) throw new HttpError(400, 'Invalid content chunk list');
  const prefix = `${runPrefix(claim)}/${spaceId}/contents-`;
  for (const ref of value.contentChunks) assertChunkReference(ref, prefix);
  const rowTotal = value.contentChunks.reduce((sum, ref) => sum + ref.rowCount, 0);
  if (rowTotal !== value.metrics.total) throw new HttpError(400, 'Space manifest row count mismatch');
}

function assertStoredSpaceManifest(
  payload: unknown,
  claim: DailyClaim,
  spaceId: string,
): asserts payload is SpaceManifest {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(409, 'Stored space manifest is invalid');
  }
  const stored = payload as SpaceManifest;
  const {
    cloudId: _storedCloudId,
    productType: _storedProductType,
    ...uploadShape
  } = stored;
  assertSpaceManifestUpload(uploadShape, claim, spaceId);
  if (stored.cloudId !== claim.cloudId || stored.productType !== 'lite') {
    throw new HttpError(409, 'Stored space manifest identity mismatch');
  }
}

function assertAggregateChunk(payload: unknown, claim: DailyClaim): asserts payload is AggregateChunk {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, 'Invalid aggregate chunk');
  }
  const value = payload as AggregateChunk;
  if (value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || value.runId !== claim.runId || !Array.isArray(value.rows)) {
    throw new HttpError(400, 'Aggregate chunk identity mismatch');
  }
  for (const row of value.rows) {
    if (!row || typeof row !== 'object') throw new HttpError(400, 'Invalid aggregate row');
    safeIdentifier(row.spaceId, 'spaceId');
    safeIdentifier(row.spaceKey, 'spaceKey');
    assertCounts(row.metrics);
  }
}

function chunkKey(body: UploadBody, claim: DailyClaim): string {
  const prefix = runPrefix(claim);
  if (body.kind === 'content') {
    const spaceId = safeIdentifier(body.spaceId, 'spaceId');
    return `${prefix}/${spaceId}/contents-${indexSuffix(body.index as number)}.json`;
  }
  if (body.kind === 'space') {
    const spaceId = safeIdentifier(body.spaceId, 'spaceId');
    return `${prefix}/${spaceId}.json`;
  }
  if (body.kind === 'aggregate') {
    return `${prefix}/spaces-${indexSuffix(body.index as number)}.json`;
  }
  throw new HttpError(400, 'Invalid chunk kind');
}

async function putImmutableVerified(
  env: SnapshotEnv,
  key: string,
  serialized: string,
  expectedHash: string,
): Promise<void> {
  const written = await env.MACRO_COUNT_SNAPSHOT_BUCKET.put(key, serialized, {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: JSON_METADATA,
    customMetadata: { sha256: expectedHash },
  });
  if (written) return;
  const existing = await env.MACRO_COUNT_SNAPSHOT_BUCKET.get(key);
  if (!existing || await sha256Hex(await existing.text()) !== expectedHash) {
    throw new HttpError(409, 'Immutable chunk already exists with different content');
  }
}

export async function handleChunk(
  request: Request,
  env: SnapshotEnv,
  data?: ForgeRequestData,
): Promise<Response> {
  try {
    requirePost(request);
    const body = await parseBody<UploadBody>(request);
    const context = await authenticateMetricsRequest(request, env, {
      backendOnly: true,
      body,
      forgeContext: data?.forgeContext,
    });
    if (!(await isSnapshotEnrolled(env, context))) throw new HttpError(403, 'Snapshot enrollment is disabled');
    const { claim } = await findActiveClaim(env, context, body.runId);
    if (context.productType !== 'lite') throw new HttpError(403, 'Only Lite snapshots are supported');

    safeHash(body.sha256);
    const rowCount = safeRowCount(body.rowCount);
    let payloadToStore = body.payload;
    if (body.kind === 'content') {
      const payload = body.payload as ContentChunk;
      const spaceId = safeIdentifier(body.spaceId, 'spaceId');
      if (
        !payload || payload.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
        || payload.runId !== claim.runId || payload.spaceId !== spaceId
        || !Array.isArray(payload.rows)
      ) throw new HttpError(400, 'Content chunk identity mismatch');
      for (const row of payload.rows) assertContentRow(row);
      if (payload.rows.length !== rowCount) throw new HttpError(400, 'Content chunk row count mismatch');
    } else if (body.kind === 'space') {
      const spaceId = safeIdentifier(body.spaceId, 'spaceId');
      assertSpaceManifestUpload(body.payload, claim, spaceId);
      if (rowCount !== 1) throw new HttpError(400, 'Space manifest row count must be one');
      payloadToStore = {
        ...(body.payload as SpaceManifestUpload),
        cloudId: claim.cloudId,
        productType: 'lite',
      } satisfies SpaceManifest;
    } else if (body.kind === 'aggregate') {
      assertAggregateChunk(body.payload, claim);
      if ((body.payload as AggregateChunk).rows.length !== rowCount) {
        throw new HttpError(400, 'Aggregate chunk row count mismatch');
      }
    } else {
      throw new HttpError(400, 'Invalid chunk kind');
    }

    const requestSerialized = JSON.stringify(body.payload);
    if (new TextEncoder().encode(requestSerialized).byteLength > MAX_CHUNK_BODY_BYTES) {
      throw new HttpError(413, 'Snapshot chunk is too large');
    }
    const requestHash = await sha256Hex(requestSerialized);
    if (requestHash !== body.sha256) throw new HttpError(400, 'Snapshot chunk hash mismatch');
    const serialized = JSON.stringify(payloadToStore);
    const actualHash = await sha256Hex(serialized);
    const key = chunkKey(body, claim);
    await putImmutableVerified(env, key, serialized, actualHash);
    return jsonResponse({ success: true, key, sha256: actualHash, rowCount }, 201);
  } catch (error) {
    return errorResponse(error);
  }
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
    ...counts,
    // Normalize AFTER integrity verification: this object is persisted, not
    // re-hashed, so an old client's missing bucket becomes an explicit 0 here
    // rather than an absent key downstream consumers must guard.
    ...Object.fromEntries(COUNT_FIELDS.map((field) => [field, countBucket(counts, field)])),
    isLite: true,
    lastUpdated: capturedAt,
  };
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

    if (claim.state === 'completed') {
      const latest = await readJsonObject<LatestPointer>(
        env.MACRO_COUNT_SNAPSHOT_BUCKET,
        latestPointerKey(context.productType, context.cloudId),
      );
      if (latest?.runId !== claim.runId || latest.state !== 'completed') {
        throw new HttpError(409, 'Completed claim has no completed latest pointer');
      }
      return jsonResponse({ success: true, runId: claim.runId, idempotent: true });
    }

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

    const manifestKey = `${runPrefix(claim)}/manifest.json`;
    const runManifest: RunManifest = {
      ...initialRunManifest(claim),
      state: 'snapshots_complete',
      expectedTypes: [...body.expectedTypes],
      completedTypes: [...body.completedTypes],
      spaceCount,
      contentCount,
      chunkCount,
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

    const kvKey = metricsKvKey(context);
    const previous = await env.confluence_plugin_features.get(kvKey, 'json') as DomainMetrics | null;
    const next: DomainMetrics = { domain: context.clientDomain, spaces: {} };
    const changedSpaces: Array<{
      spaceKey: string;
      previous?: SpaceMetrics;
      current: SpaceMetrics;
      reason: 'new' | 'changed' | 'zeroed';
    }> = [];
    for (const row of rows) {
      const current = compatibleSpace(row.spaceKey, row.metrics, claim.capturedAt);
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
      const zero = compatibleSpace(spaceKey, emptyCounts(), claim.capturedAt);
      next.spaces[spaceKey] = zero;
      if (changedMetrics(before, zero)) {
        changedSpaces.push({ spaceKey, previous: before, current: zero, reason: 'zeroed' });
      }
    }

    try {
      await env.confluence_plugin_features.put(kvKey, JSON.stringify(next), {
        expirationTtl: KV_EXPIRATION_TTL_SECONDS,
      });
    } catch (error) {
      // Keep latest.json in `committing`: legacy writes stay fenced and the
      // same complete commit is safe to retry without publishing partial data.
      throw new HttpError(503, 'KV commit failed');
    }

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
      {
      etagMatches: active.object.etag,
      },
    );
    if (!claimWritten) throw new HttpError(409, 'Daily claim changed before completion');

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
        spaceCount,
        contentCount,
        changedSpaceCount: changedSpaces.length,
        zeroedSpaceCount: changedSpaces.filter((space) => space.reason === 'zeroed').length,
        counts: body.aggregateMetrics,
        typeRequestCount: body.expectedTypes.length,
        chunkCount,
      }),
      ...changedSpaces.map((space) => changedSpaceEvent({
        ...analyticsContext,
        spaceKey: space.spaceKey,
        reason: space.reason,
        previous: space.previous,
        current: space.current,
      })),
    ]);

    return jsonResponse({
      success: true,
      runId: claim.runId,
      spaceCount,
      contentCount,
      changedSpaceCount: changedSpaces.length,
      zeroedSpaceCount: changedSpaces.filter((space) => space.reason === 'zeroed').length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function boundedFailureValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? value as T : fallback;
}

export async function handleFail(
  request: Request,
  env: SnapshotEnv,
  data?: ForgeRequestData,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Response> {
  try {
    requirePost(request);
    const body = await parseBody<FailBody>(request);
    const context = await authenticateMetricsRequest(request, env, {
      backendOnly: true,
      body,
      forgeContext: data?.forgeContext,
    });
    const active = await findActiveClaim(env, context, body.runId);
    const failureStage = boundedFailureValue(body.failureStage, FAILURE_STAGES, 'unknown');
    const failureReason = boundedFailureValue(body.failureReason, FAILURE_REASONS, 'unknown');
    const updatedAt = nowIso();
    const failedClaim: DailyClaim = {
      ...active.claim,
      state: 'failed',
      failureStage,
      failureReason,
      updatedAt,
    };
    const written = await putJson(
      env.MACRO_COUNT_SNAPSHOT_BUCKET,
      active.key,
      failedClaim,
      {
      etagMatches: active.object.etag,
      },
    );
    if (!written) throw new HttpError(409, 'Daily claim changed before failure was recorded');

    const existingManifest = await readJsonObject<RunManifest>(
      env.MACRO_COUNT_SNAPSHOT_BUCKET,
      `${runPrefix(active.claim)}/manifest.json`,
    ) || initialRunManifest(active.claim);
    await putJson(env.MACRO_COUNT_SNAPSHOT_BUCKET, `${runPrefix(active.claim)}/manifest.json`, {
      ...existingManifest,
      state: 'failed',
      completedTypes: Array.isArray(body.completedTypes)
        ? body.completedTypes.filter((value): value is string => typeof value === 'string').slice(0, 10)
        : existingManifest.completedTypes,
      contentCount: safeRowCount(body.processedContents ?? existingManifest.contentCount),
      spaceCount: safeRowCount(body.processedSpaces ?? existingManifest.spaceCount),
      chunkCount: safeRowCount(body.chunkCount ?? existingManifest.chunkCount),
      failureStage,
      failureReason,
      updatedAt,
    } satisfies RunManifest);
    const completedTypes = Array.isArray(body.completedTypes)
      ? body.completedTypes.filter((value): value is string => typeof value === 'string').slice(0, 10)
      : [];
    scheduleAnalytics(env, waitUntil, [failedSnapshotEvent({
      runId: active.claim.runId,
      capturedAt: active.claim.capturedAt,
      installationId: active.claim.installationId,
      productType: active.claim.productType,
      environmentType: active.claim.environment || context.environment,
      durationMs: safeDuration(body.durationMs, active.claim.capturedAt),
      failureStage,
      failureReason,
      completedTypes,
      processedContents: safeRowCount(body.processedContents ?? 0),
      processedSpaces: safeRowCount(body.processedSpaces ?? 0),
      chunkCount: safeRowCount(body.chunkCount ?? 0),
    })]);
    return jsonResponse({ success: true, runId: active.claim.runId });
  } catch (error) {
    return errorResponse(error);
  }
}
