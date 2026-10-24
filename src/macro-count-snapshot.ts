import api, { getAppContext, invokeRemote, route } from '@forge/api';

/**
 * Daily, tenant-wide macro inventory for the Lite Forge app.
 *
 * Confluence is the source of truth. The scanner walks the V2 custom-content
 * collection once for each of the two custom-content types, reduces every
 * response to an explicitly allow-listed row, and then uploads immutable
 * chunks to the authenticated `connect` Remote. Installation identity is
 * supplied to that Remote by Forge's FIT; it is deliberately absent from all
 * request bodies below.
 */

export const LITE_CUSTOM_CONTENT_TYPES = [
  'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence',
  'ac:com.zenuml.confluence-addon-lite:zenuml-content-graph',
] as const;

export const SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const SNAPSHOT_CHUNK_MAX_BYTES = 400 * 1024;
export const CONFLUENCE_PAGE_LIMIT = 250;
export const SPACE_ID_BATCH_SIZE = 100;
export const MAX_REQUEST_ATTEMPTS = 4;

export type CountField =
  | 'sequence'
  | 'graph'
  | 'openapi'
  | 'mermaid'
  | 'plantuml'
  // Lite ships the AsyncAPI macro (ADR-0005 Option A), stored under the shared
  // zenuml-content-sequence type like OpenAPI. Without its own bucket every
  // such row would land in `unknown` with parseStatus 'unknown_diagram_type',
  // i.e. indistinguishable from genuinely corrupt content.
  | 'asyncapi'
  | 'unknown';

export type FailureStage =
  | 'claim'
  | 'scan'
  | 'pagination'
  | 'space_map'
  | 'chunk_upload'
  | 'commit'
  | 'unknown';

export type FailureReason =
  | 'confluence_429'
  | 'confluence_4xx'
  | 'confluence_5xx'
  | 'confluence_network'
  | 'invalid_pagination'
  | 'missing_space_id'
  | 'unresolved_space_id'
  | 'invalid_chunk'
  | 'r2_write_failed'
  | 'kv_write_failed'
  | 'timeout'
  | 'unknown';

export interface MacroCounts {
  total: number;
  sequence: number;
  graph: number;
  openapi: number;
  mermaid: number;
  plantuml: number;
  asyncapi: number;
  unknown: number;
}

export type ParseStatus =
  | 'parsed'
  | 'missing_body'
  | 'invalid_json'
  | 'unknown_diagram_type';

/** The complete allow-list accepted by the Remote. Never add body or title. */
export interface ContentSnapshotRow {
  contentId: string;
  pageId: string | null;
  type: string;
  status: string;
  versionNumber: number | null;
  versionCreatedAt: string | null;
  diagramType: CountField;
  logicalIdHash: string;
  parseStatus: ParseStatus;
}

export interface ContentWithSpace {
  spaceId: string;
  row: ContentSnapshotRow;
}

export interface ChunkReference {
  key: string;
  rowCount: number;
  sha256: string;
}

export interface AggregateRow {
  spaceId: string;
  spaceKey: string;
  metrics: MacroCounts;
}

export interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text?(): Promise<string>;
  headers?: {
    get(name: string): string | null;
  };
}

export interface ScannerDependencies {
  requestCustomContent(type: string, cursor?: string): Promise<ResponseLike>;
  requestSpaces(ids: string[], cursor?: string): Promise<ResponseLike>;
  invokeRemote(path: string, body: Record<string, unknown>): Promise<ResponseLike>;
  /** Installation-scoped salt. It is used locally and is never uploaded. */
  tenantScope: string;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export type SnapshotRunResult =
  | { status: 'skipped'; reason: 'not_enrolled' | 'duplicate' }
  | {
    status: 'completed';
    runId: string;
    spaceCount: number;
    contentCount: number;
    chunkCount: number;
    counts: MacroCounts;
  };

interface MultiEntityPage {
  results: unknown[];
  _links?: { next?: unknown };
}

interface ClaimResponse {
  eligible?: unknown;
  claimed?: unknown;
  duplicate?: unknown;
  runId?: unknown;
  capturedAt?: unknown;
}

const COUNT_FIELDS: readonly CountField[] = [
  'sequence',
  'graph',
  'openapi',
  'mermaid',
  'plantuml',
  'asyncapi',
  'unknown',
];

const REMOTE_PATHS = {
  claim: '/metrics-cache/snapshot/claim',
  chunk: '/metrics-cache/snapshot/chunk',
  commit: '/metrics-cache/snapshot/commit',
  fail: '/metrics-cache/snapshot/fail',
} as const;

const FORBIDDEN_IDENTITY_KEYS = new Set([
  'domain',
  'clientdomain',
  'product',
  'producttype',
  'cloudid',
]);

const textEncoder = new TextEncoder();

export class SnapshotFailure extends Error {
  constructor(
    public readonly stage: FailureStage,
    public readonly reason: FailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'SnapshotFailure';
  }
}

export function emptyCounts(): MacroCounts {
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

export function countsInvariant(counts: MacroCounts): boolean {
  if (!Number.isSafeInteger(counts.total) || counts.total < 0) return false;
  if (COUNT_FIELDS.some((field) => (
    !Number.isSafeInteger(counts[field]) || counts[field] < 0
  ))) return false;
  return counts.total === COUNT_FIELDS.reduce((sum, field) => sum + counts[field], 0);
}

export function countSnapshotRows(rows: readonly ContentSnapshotRow[]): MacroCounts {
  const counts = emptyCounts();
  for (const row of rows) {
    counts.total += 1;
    counts[row.diagramType] += 1;
  }
  if (!countsInvariant(counts)) {
    throw new SnapshotFailure('scan', 'invalid_chunk', 'Macro count invariant failed');
  }
  return counts;
}

export function addCounts(target: MacroCounts, source: MacroCounts): void {
  target.total += source.total;
  for (const field of COUNT_FIELDS) target[field] += source[field];
  if (!countsInvariant(target)) {
    throw new SnapshotFailure('scan', 'invalid_chunk', 'Aggregate macro count invariant failed');
  }
}

function jsonByteLength(value: unknown): number {
  return textEncoder.encode(JSON.stringify(value)).byteLength;
}

// The Forge Functions runtime (Node 20) exposes WebCrypto as `globalThis.crypto`,
// but this repo's tsconfig declares neither the DOM lib nor `@types/node`'s global
// augmentation, so the bundler's ts-loader rejects a bare `globalThis.crypto`
// (TS2339) and emits nothing for this entry. Narrow to just what we call — a
// type-only shim, so the runtime call is unchanged.
const webCrypto = (
  globalThis as unknown as {
    crypto: { subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
  }
).crypto;

export async function sha256Hex(value: string): Promise<string> {
  const digest = await webCrypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function safeIdentifier(value: unknown, field: string): string {
  const normalized = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value
      : '';
  if (!normalized || normalized.length > 200) {
    throw new SnapshotFailure('pagination', 'invalid_pagination', `Invalid ${field}`);
  }
  return normalized;
}

function nullableIdentifier(value: unknown): string | null {
  if (value == null) return null;
  const normalized = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value
      : '';
  return normalized && normalized.length <= 200 ? normalized : null;
}

function safeStatus(value: unknown): string {
  return typeof value === 'string' && value.length > 0 && value.length <= 50
    ? value
    : 'unknown';
}

function safeVersionNumber(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
}

function safeTimestamp(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 50
    ? value
    : null;
}

export function normalizeDiagramType(value: unknown): CountField {
  if (typeof value !== 'string') return 'unknown';
  switch (value.trim().toLowerCase()) {
    case 'sequence': return 'sequence';
    case 'graph': return 'graph';
    case 'openapi': return 'openapi';
    case 'mermaid': return 'mermaid';
    case 'plantuml': return 'plantuml';
    // DiagramType.AsyncApi is the string 'AsyncAPI' — matched here lowercased,
    // like OpenAPI above.
    case 'asyncapi': return 'asyncapi';
    default: return 'unknown';
  }
}

/**
 * Reduce a Confluence response object to the exact privacy-safe row schema.
 * The raw body is parsed locally and immediately discarded.
 */
export async function toPrivacySafeRow(
  content: unknown,
  expectedType: string,
  tenantScope: string,
): Promise<ContentWithSpace> {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new SnapshotFailure('pagination', 'invalid_pagination', 'Invalid custom-content result');
  }
  const value = content as Record<string, unknown>;
  const contentId = safeIdentifier(value.id, 'contentId');
  if (value.spaceId == null || value.spaceId === '') {
    throw new SnapshotFailure('scan', 'missing_space_id', 'Custom content has no space id');
  }
  const spaceId = safeIdentifier(value.spaceId, 'spaceId');
  const body = value.body && typeof value.body === 'object'
    ? value.body as Record<string, unknown>
    : undefined;
  const raw = body?.raw && typeof body.raw === 'object'
    ? body.raw as Record<string, unknown>
    : undefined;
  const rawValue = raw?.value;

  let parsed: Record<string, unknown> | undefined;
  let parseStatus: ParseStatus;
  let diagramType: CountField = 'unknown';
  if (typeof rawValue !== 'string' || rawValue.length === 0) {
    parseStatus = 'missing_body';
  } else {
    try {
      const candidate = JSON.parse(rawValue) as unknown;
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        parsed = candidate as Record<string, unknown>;
      }
      diagramType = normalizeDiagramType(parsed?.diagramType);
      parseStatus = diagramType === 'unknown' ? 'unknown_diagram_type' : 'parsed';
    } catch {
      parseStatus = 'invalid_json';
    }
  }

  const logicalIdValue = parsed?.id;
  const logicalId = (
    (typeof logicalIdValue === 'string' && logicalIdValue.length > 0)
    || (typeof logicalIdValue === 'number' && Number.isSafeInteger(logicalIdValue))
  ) ? String(logicalIdValue) : contentId;
  // NUL separators avoid ambiguous concatenations. The installation salt is
  // intentionally local-only, making equal logical ids unlinkable by tenant.
  const logicalIdHash = await sha256Hex(`macro-count-v1\0${tenantScope}\0${logicalId}`);
  const version = value.version && typeof value.version === 'object'
    ? value.version as Record<string, unknown>
    : undefined;

  return {
    spaceId,
    row: {
      contentId,
      pageId: nullableIdentifier(value.pageId),
      type: expectedType,
      status: safeStatus(value.status),
      versionNumber: safeVersionNumber(version?.number),
      versionCreatedAt: safeTimestamp(version?.createdAt),
      diagramType,
      logicalIdHash,
      parseStatus,
    },
  };
}

/** Reject any accidental client-asserted installation identity recursively. */
export function assertNoClientIdentity(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoClientIdentity(item);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_IDENTITY_KEYS.has(key.toLowerCase())) {
      throw new SnapshotFailure('unknown', 'unknown', `Forbidden client identity field: ${key}`);
    }
    assertNoClientIdentity(nested);
  }
}

/**
 * Greedily chunk rows using the exact UTF-8 JSON size of each row and payload
 * envelope. Every returned payload is strictly smaller than maxBytes.
 */
export function chunkJsonRows<T, P>(
  rows: readonly T[],
  buildPayload: (chunkRows: T[]) => P,
  maxBytes = SNAPSHOT_CHUNK_MAX_BYTES,
): Array<{ rows: T[]; payload: P; byteLength: number }> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new SnapshotFailure('chunk_upload', 'invalid_chunk', 'Invalid chunk byte limit');
  }
  if (rows.length === 0) return [];

  const emptyEnvelopeBytes = jsonByteLength(buildPayload([]));
  const chunks: Array<{ rows: T[]; payload: P; byteLength: number }> = [];
  let current: T[] = [];
  let currentBytes = emptyEnvelopeBytes;

  const flush = () => {
    if (current.length === 0) return;
    const payload = buildPayload(current);
    const byteLength = jsonByteLength(payload);
    if (byteLength >= maxBytes) {
      throw new SnapshotFailure('chunk_upload', 'invalid_chunk', 'Snapshot chunk exceeds byte limit');
    }
    chunks.push({ rows: current, payload, byteLength });
    current = [];
    currentBytes = emptyEnvelopeBytes;
  };

  for (const row of rows) {
    const rowBytes = jsonByteLength(row);
    const candidateBytes = currentBytes + rowBytes + (current.length > 0 ? 1 : 0);
    if (candidateBytes >= maxBytes) flush();
    if (emptyEnvelopeBytes + rowBytes >= maxBytes) {
      throw new SnapshotFailure('chunk_upload', 'invalid_chunk', 'A snapshot row exceeds byte limit');
    }
    current.push(row);
    currentBytes += rowBytes + (current.length > 1 ? 1 : 0);
  }
  flush();
  return chunks;
}

function nextLinkFromHeader(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(',')) {
    if (!/;\s*rel\s*=\s*"?next"?/i.test(part)) continue;
    const match = /<([^>]+)>/.exec(part);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

export function nextCursor(
  page: Pick<MultiEntityPage, '_links'>,
  linkHeader?: string | null,
): string | undefined {
  const bodyNext = page._links?.next;
  const link = typeof bodyNext === 'string' && bodyNext.length > 0
    ? bodyNext
    : nextLinkFromHeader(linkHeader);
  if (!link) return undefined;
  try {
    const cursor = new URL(link, 'https://confluence.invalid').searchParams.get('cursor');
    if (!cursor) {
      throw new Error('missing cursor');
    }
    return cursor;
  } catch {
    throw new SnapshotFailure('pagination', 'invalid_pagination', 'Invalid next-page cursor');
  }
}

function retryDelayMs(response: ResponseLike | undefined, attempt: number, now: number): number {
  const retryAfter = response?.headers?.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 5_000);
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.min(Math.max(0, retryAt - now), 5_000);
  }
  return Math.min(250 * (2 ** attempt), 5_000);
}

function confluenceReason(status: number): FailureReason {
  if (status === 429) return 'confluence_429';
  if (status >= 500) return 'confluence_5xx';
  return 'confluence_4xx';
}

export async function requestConfluenceJsonWithRetry(
  request: () => Promise<ResponseLike>,
  options: {
    stage: FailureStage;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    maxAttempts?: number;
  },
): Promise<{ page: MultiEntityPage; response: ResponseLike }> {
  const sleep = options.sleep || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now || Date.now;
  const maxAttempts = options.maxAttempts || MAX_REQUEST_ATTEMPTS;
  let lastNetworkError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response: ResponseLike;
    try {
      response = await request();
    } catch (error) {
      if (error instanceof SnapshotFailure) throw error;
      lastNetworkError = error;
      if (attempt + 1 < maxAttempts) {
        await sleep(retryDelayMs(undefined, attempt, now()));
        continue;
      }
      throw new SnapshotFailure(options.stage, 'confluence_network', 'Confluence request failed');
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt + 1 < maxAttempts) {
        await sleep(retryDelayMs(response, attempt, now()));
        continue;
      }
      throw new SnapshotFailure(
        options.stage,
        confluenceReason(response.status),
        `Confluence HTTP ${response.status}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new SnapshotFailure(options.stage, 'invalid_pagination', 'Invalid Confluence JSON');
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as MultiEntityPage).results)) {
      throw new SnapshotFailure(options.stage, 'invalid_pagination', 'Invalid Confluence page');
    }
    return { page: parsed as MultiEntityPage, response };
  }

  // The loop is exhaustive, but retaining the cause here helps type narrowing
  // without ever logging Confluence response data.
  void lastNetworkError;
  throw new SnapshotFailure(options.stage, 'confluence_network', 'Confluence request failed');
}

function remoteFailure(stage: FailureStage, status: number): SnapshotFailure {
  const reason: FailureReason = stage === 'chunk_upload' && status >= 500
    ? 'r2_write_failed'
    : stage === 'commit' && status >= 500
      ? 'kv_write_failed'
      : 'unknown';
  return new SnapshotFailure(stage, reason, `Snapshot Remote HTTP ${status}`);
}

async function invokeRemoteJson(
  deps: ScannerDependencies,
  path: string,
  body: Record<string, unknown>,
  stage: FailureStage,
  retrySafe: boolean,
): Promise<Record<string, unknown>> {
  assertNoClientIdentity(body);
  const attempts = retrySafe ? MAX_REQUEST_ATTEMPTS : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: ResponseLike;
    try {
      response = await deps.invokeRemote(path, body);
    } catch {
      if (retrySafe && attempt + 1 < attempts) {
        await deps.sleep(Math.min(250 * (2 ** attempt), 5_000));
        continue;
      }
      throw new SnapshotFailure(stage, 'unknown', 'Snapshot Remote request failed');
    }
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      if (retrySafe && retryable && attempt + 1 < attempts) {
        await deps.sleep(retryDelayMs(response, attempt, deps.now()));
        continue;
      }
      throw remoteFailure(stage, response.status);
    }
    try {
      const parsed = await response.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('invalid response');
      }
      return parsed as Record<string, unknown>;
    } catch {
      throw new SnapshotFailure(stage, 'unknown', 'Invalid Snapshot Remote JSON');
    }
  }
  throw new SnapshotFailure(stage, 'unknown', 'Snapshot Remote request failed');
}

async function scanType(
  deps: ScannerDependencies,
  type: string,
  grouped: Map<string, ContentSnapshotRow[]>,
): Promise<number> {
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  let processed = 0;
  let firstPage = true;

  do {
    const currentCursor = cursor;
    const { page, response } = await requestConfluenceJsonWithRetry(
      () => deps.requestCustomContent(type, currentCursor),
      {
        stage: firstPage ? 'scan' : 'pagination',
        sleep: deps.sleep,
        now: deps.now,
      },
    );
    const safeRows = await Promise.all(
      page.results.map((content) => toPrivacySafeRow(content, type, deps.tenantScope)),
    );
    for (const item of safeRows) {
      const rows = grouped.get(item.spaceId) || [];
      rows.push(item.row);
      grouped.set(item.spaceId, rows);
    }
    processed += safeRows.length;

    cursor = nextCursor(page, response.headers?.get('link'));
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new SnapshotFailure('pagination', 'invalid_pagination', 'Repeated pagination cursor');
      }
      seenCursors.add(cursor);
    }
    firstPage = false;
  } while (cursor);

  return processed;
}

function batches<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export async function resolveSpaceKeys(
  deps: ScannerDependencies,
  spaceIds: readonly string[],
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  for (const batch of batches(spaceIds, SPACE_ID_BATCH_SIZE)) {
    const expected = new Set(batch);
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    do {
      const currentCursor = cursor;
      const { page, response } = await requestConfluenceJsonWithRetry(
        () => deps.requestSpaces(batch, currentCursor),
        { stage: 'space_map', sleep: deps.sleep, now: deps.now },
      );
      for (const raw of page.results) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const record = raw as Record<string, unknown>;
        const id = nullableIdentifier(record.id);
        const key = typeof record.key === 'string' ? record.key : '';
        if (!id || !expected.has(id) || !key || key.length > 200) continue;
        const previous = resolved.get(id);
        if (previous && previous !== key) {
          throw new SnapshotFailure('space_map', 'unresolved_space_id', 'Space id resolved inconsistently');
        }
        resolved.set(id, key);
      }
      cursor = nextCursor(page, response.headers?.get('link'));
      if (cursor) {
        if (seenCursors.has(cursor)) {
          throw new SnapshotFailure('space_map', 'invalid_pagination', 'Repeated space cursor');
        }
        seenCursors.add(cursor);
      }
    } while (cursor);
  }

  const missing = spaceIds.find((spaceId) => !resolved.has(spaceId));
  if (missing) {
    throw new SnapshotFailure('space_map', 'unresolved_space_id', 'A custom-content space could not be resolved');
  }
  return resolved;
}

function assertPayloadUnderLimit(payload: unknown): void {
  if (jsonByteLength(payload) >= SNAPSHOT_CHUNK_MAX_BYTES) {
    throw new SnapshotFailure('chunk_upload', 'invalid_chunk', 'Snapshot payload exceeds byte limit');
  }
}

async function uploadChunk(
  deps: ScannerDependencies,
  body: {
    runId: string;
    kind: 'content' | 'space' | 'aggregate';
    spaceId?: string;
    index?: number;
    rowCount: number;
    payload: unknown;
  },
): Promise<ChunkReference> {
  assertPayloadUnderLimit(body.payload);
  const sha256 = await sha256Hex(JSON.stringify(body.payload));
  const requestBody: Record<string, unknown> = { ...body, sha256 };
  const response = await invokeRemoteJson(
    deps,
    REMOTE_PATHS.chunk,
    requestBody,
    'chunk_upload',
    true,
  );
  const acknowledgedHash = typeof response.sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(response.sha256)
    ? response.sha256
    : '';
  if (
    response.success !== true
    || typeof response.key !== 'string'
    || response.key.length === 0
    || !acknowledgedHash
    // The Remote injects FIT-derived cloudId/productType only into the stored
    // space manifest, so that one acknowledgement intentionally has a new
    // server-side hash. Content/aggregate references must remain byte-exact.
    || (body.kind !== 'space' && acknowledgedHash !== sha256)
    || response.rowCount !== body.rowCount
  ) {
    throw new SnapshotFailure('chunk_upload', 'invalid_chunk', 'Invalid chunk acknowledgement');
  }
  return { key: response.key, sha256: acknowledgedHash, rowCount: body.rowCount };
}

function normalizeFailure(error: unknown): SnapshotFailure {
  return error instanceof SnapshotFailure
    ? error
    : new SnapshotFailure('unknown', 'unknown', 'Unexpected snapshot failure');
}

async function bestEffortFail(
  deps: ScannerDependencies,
  runId: string,
  failure: SnapshotFailure,
  progress: {
    completedTypes: string[];
    processedContents: number;
    processedSpaces: number;
    chunkCount: number;
    durationMs: number;
  },
): Promise<void> {
  const body: Record<string, unknown> = {
    runId,
    failureStage: failure.stage,
    failureReason: failure.reason,
    ...progress,
  };
  try {
    assertNoClientIdentity(body);
    await deps.invokeRemote(REMOTE_PATHS.fail, body);
  } catch {
    // Reporting a failed run must never replace the original scanner error.
  }
}

export async function runMacroCountSnapshot(
  deps: ScannerDependencies = createProductionDependencies(),
): Promise<SnapshotRunResult> {
  const startedAt = deps.now();
  const claim = await invokeRemoteJson(deps, REMOTE_PATHS.claim, {}, 'claim', false) as ClaimResponse;
  if (claim.eligible === false) return { status: 'skipped', reason: 'not_enrolled' };
  if (claim.duplicate === true) return { status: 'skipped', reason: 'duplicate' };
  if (
    claim.eligible !== true
    || claim.claimed !== true
    || typeof claim.runId !== 'string'
    || claim.runId.length === 0
    || typeof claim.capturedAt !== 'string'
    || claim.capturedAt.length === 0
  ) {
    throw new SnapshotFailure('claim', 'unknown', 'Invalid snapshot claim');
  }

  const runId = claim.runId;
  const capturedAt = claim.capturedAt;
  const completedTypes: string[] = [];
  const grouped = new Map<string, ContentSnapshotRow[]>();
  let processedContents = 0;
  let chunkCount = 0;

  try {
    for (const type of LITE_CUSTOM_CONTENT_TYPES) {
      processedContents += await scanType(deps, type, grouped);
      completedTypes.push(type);
    }

    const spaceIds = [...grouped.keys()].sort();
    const spaceKeys = await resolveSpaceKeys(deps, spaceIds);
    const aggregateRows: AggregateRow[] = [];
    const aggregateMetrics = emptyCounts();

    for (const spaceId of spaceIds) {
      const rows = grouped.get(spaceId) || [];
      rows.sort((left, right) => left.contentId.localeCompare(right.contentId));
      const metrics = countSnapshotRows(rows);
      addCounts(aggregateMetrics, metrics);
      const contentChunks = chunkJsonRows(
        rows,
        (chunkRows) => ({
          schemaVersion: SNAPSHOT_SCHEMA_VERSION,
          runId,
          spaceId,
          rows: chunkRows,
        }),
      );
      const contentRefs: ChunkReference[] = [];
      for (let index = 0; index < contentChunks.length; index += 1) {
        contentRefs.push(await uploadChunk(deps, {
          runId,
          kind: 'content',
          spaceId,
          index,
          rowCount: contentChunks[index].rows.length,
          payload: contentChunks[index].payload,
        }));
        chunkCount += 1;
      }

      const spaceKey = spaceKeys.get(spaceId);
      if (!spaceKey) {
        throw new SnapshotFailure('space_map', 'unresolved_space_id', 'Space key disappeared');
      }
      const spaceManifest = {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        runId,
        capturedAt,
        spaceId,
        spaceKey,
        metrics,
        contentChunks: contentRefs,
      };
      await uploadChunk(deps, {
        runId,
        kind: 'space',
        spaceId,
        rowCount: 1,
        payload: spaceManifest,
      });
      chunkCount += 1;
      aggregateRows.push({ spaceId, spaceKey, metrics });
    }

    if (aggregateMetrics.total !== processedContents || !countsInvariant(aggregateMetrics)) {
      throw new SnapshotFailure('scan', 'invalid_chunk', 'Tenant aggregate count invariant failed');
    }

    const aggregateChunks = chunkJsonRows(
      aggregateRows,
      (rows) => ({ schemaVersion: SNAPSHOT_SCHEMA_VERSION, runId, rows }),
    );
    const aggregateRefs: ChunkReference[] = [];
    for (let index = 0; index < aggregateChunks.length; index += 1) {
      aggregateRefs.push(await uploadChunk(deps, {
        runId,
        kind: 'aggregate',
        index,
        rowCount: aggregateChunks[index].rows.length,
        payload: aggregateChunks[index].payload,
      }));
      chunkCount += 1;
    }

    await invokeRemoteJson(deps, REMOTE_PATHS.commit, {
      runId,
      expectedTypes: [...LITE_CUSTOM_CONTENT_TYPES],
      completedTypes,
      spaceCount: aggregateRows.length,
      contentCount: aggregateMetrics.total,
      chunkCount,
      aggregateMetrics,
      aggregateChunks: aggregateRefs,
      durationMs: Math.max(0, deps.now() - startedAt),
    }, 'commit', true);

    return {
      status: 'completed',
      runId,
      spaceCount: aggregateRows.length,
      contentCount: aggregateMetrics.total,
      chunkCount,
      counts: aggregateMetrics,
    };
  } catch (error) {
    const failure = normalizeFailure(error);
    await bestEffortFail(deps, runId, failure, {
      completedTypes,
      processedContents,
      processedSpaces: grouped.size,
      chunkCount,
      durationMs: Math.max(0, deps.now() - startedAt),
    });
    throw error;
  }
}

export function createProductionDependencies(): ScannerDependencies {
  const confluence = api.asApp();
  const context = getAppContext();
  return {
    requestCustomContent(type, cursor) {
      return confluence.requestConfluence(
        cursor
          ? route`/wiki/api/v2/custom-content?type=${type}&body-format=raw&limit=${CONFLUENCE_PAGE_LIMIT}&cursor=${cursor}`
          : route`/wiki/api/v2/custom-content?type=${type}&body-format=raw&limit=${CONFLUENCE_PAGE_LIMIT}`,
        { headers: { accept: 'application/json' } },
      ) as Promise<ResponseLike>;
    },
    requestSpaces(ids, cursor) {
      const joinedIds = ids.join(',');
      return confluence.requestConfluence(
        cursor
          ? route`/wiki/api/v2/spaces?ids=${joinedIds}&limit=${CONFLUENCE_PAGE_LIMIT}&cursor=${cursor}`
          : route`/wiki/api/v2/spaces?ids=${joinedIds}&limit=${CONFLUENCE_PAGE_LIMIT}`,
        { headers: { accept: 'application/json' } },
      ) as Promise<ResponseLike>;
    },
    invokeRemote(path, body) {
      return invokeRemote('connect', {
        path,
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }) as Promise<ResponseLike>;
    },
    tenantScope: context.installationAri.installationId,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
  };
}

export const scheduledHandler = async (): Promise<SnapshotRunResult> =>
  runMacroCountSnapshot();
