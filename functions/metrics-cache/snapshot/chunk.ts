import { json } from '../../OkResponse';
import type { ForgeRequestData } from '../../utils/authenticate';
import {
  JSON_METADATA,
  MAX_CHUNK_BODY_BYTES,
  SNAPSHOT_SCHEMA_VERSION,
  HttpError,
  assertCounts,
  authenticateMetricsRequest,
  errorResponse,
  findActiveClaim,
  isSnapshotEnrolled,
  NO_STORE_HEADERS,
  parseBody,
  requirePost,
  runPrefix,
  safeHash,
  safeIdentifier,
  safeRowCount,
  sha256Hex,
  type ChunkReference,
  type DailyClaim,
  type MacroCounts,
  type SnapshotEnv,
} from './common';

export interface ContentSnapshotRow {
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

export interface ContentChunk {
  schemaVersion: 1;
  runId: string;
  spaceId: string;
  rows: ContentSnapshotRow[];
}

export interface SpaceManifest {
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

export type SpaceManifestUpload = Omit<SpaceManifest, 'cloudId' | 'productType'>;

export interface AggregateRow {
  spaceId: string;
  spaceKey: string;
  metrics: MacroCounts;
}

export interface AggregateChunk {
  schemaVersion: 1;
  runId: string;
  rows: AggregateRow[];
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

function indexSuffix(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index > 999_999) {
    throw new HttpError(400, 'Invalid chunk index');
  }
  return String(index).padStart(6, '0');
}

export function assertContentRow(row: unknown): asserts row is ContentSnapshotRow {
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

export function assertChunkReference(reference: unknown, prefix: string): asserts reference is ChunkReference {
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

export function assertStoredSpaceManifest(
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

export function assertAggregateChunk(payload: unknown, claim: DailyClaim): asserts payload is AggregateChunk {
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
    return json({ success: true, key, sha256: actualHash, rowCount }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

export const onRequest: PagesFunction<SnapshotEnv, string, ForgeRequestData> =
  ({ request, env, data }) => handleChunk(request, env, data);
