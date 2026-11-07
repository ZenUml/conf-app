import { getAtlassianInstanceClientDomain, getForgeInstallationClientDomain } from '../../utils/dbUtils';
import {
  validateContextToken,
  type ForgeRequestContext,
  type VerifiedForgeFit,
} from '../../utils/authenticate';
import { getAuthorizationHeader } from '../../utils/requestUtils';
import { hasForgeUserToken } from '../../utils/forgeUserToken';
import { json } from '../../OkResponse';
import { mixpanelImportServiceEvents } from '../../service/mixpanelService';

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const SNAPSHOT_PREFIX = 'macro-count/v1';
export const LITE_APP_ID = '8ad26115-211f-4216-971b-0540f606303d';
export const CLAIM_STALE_MS = 30 * 60 * 1000;
export const KV_EXPIRATION_TTL_SECONDS = 365 * 24 * 60 * 60;

const APP_PRODUCTS: Record<string, ProductType> = {
  [LITE_APP_ID]: 'lite',
  'd9e4002b-120b-426b-834b-402a4a5adce7': 'full',
  '01ede8b1-4e88-451a-b9ef-89eeef93afaf': 'diagramly',
  '49017727-af19-4ab6-8d5a-7d28108936b6': 'asyncapi',
};

export type ProductType = 'lite' | 'full' | 'diagramly' | 'asyncapi';
export type CountField = 'sequence' | 'graph' | 'openapi' | 'mermaid' | 'plantuml' | 'asyncapi' | 'unknown';
export const COUNT_FIELDS: readonly CountField[] = [
  'sequence', 'graph', 'openapi', 'mermaid', 'plantuml', 'asyncapi', 'unknown',
];

export interface MacroCounts {
  total: number;
  sequence: number;
  graph: number;
  openapi: number;
  mermaid: number;
  plantuml: number;
  // Lite ships the AsyncAPI macro (ADR-0005 Option A) and stores it under the
  // shared zenuml-content-sequence type, so these rows arrive here like any
  // other. Clients older than that bucket omit the field — see assertCounts.
  asyncapi: number;
  unknown: number;
}

export interface SpaceMetrics extends MacroCounts {
  space: string;
  isLite: boolean;
  lastUpdated: string;
}

export interface DomainMetrics {
  domain: string;
  spaces: Record<string, SpaceMetrics>;
}

export type ClaimState = 'running' | 'completed' | 'failed';

export interface DailyClaim {
  schemaVersion: 1;
  runId: string;
  capturedAt: string;
  state: ClaimState;
  appId: string;
  installationId: string;
  cloudId: string;
  productType: ProductType;
  environment?: string;
  failureStage?: string;
  failureReason?: string;
  updatedAt: string;
}

export interface LatestPointer {
  schemaVersion: 1;
  runId: string;
  capturedAt: string;
  state: 'committing' | 'completed';
  cloudId: string;
  productType: ProductType;
  updatedAt: string;
}

export interface SnapshotEnv {
  ALLOWED_FORGE_APP_IDS?: string;
  DB: D1Database;
  MACRO_COUNT_SNAPSHOT_BUCKET: R2Bucket;
  confluence_plugin_features: KVNamespace;
  KV_FEATURE_FLAGS: KVNamespace;
  MIXPANEL_TOKEN?: string;
  ENVIRONMENT?: string;
  EXPECTED_FORGE_ENVIRONMENT_TYPE?: string;
}

export interface AuthenticatedMetricsContext {
  appId: string;
  cloudId: string;
  installationId: string;
  clientDomain: string;
  productType: ProductType;
  environment: string;
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message }, { status: error.status, headers: NO_STORE_HEADERS });
  }
  console.error('[macro-count:snapshot] unexpected error', {
    reason: error instanceof Error ? error.name : 'unknown_error',
  });
  return json({ error: 'Internal Server Error' }, { status: 500, headers: NO_STORE_HEADERS });
}

export function normalizeClientDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  let hostname = trimmed;
  try {
    hostname = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    // Keep the original compatibility key when it is not URL-shaped.
  }
  return hostname.endsWith('.atlassian.net')
    ? hostname.slice(0, -'.atlassian.net'.length)
    : hostname;
}

export function productTypeForAppId(appId: string): ProductType | undefined {
  return APP_PRODUCTS[appId.split('/').pop() || appId];
}

function productTypeFromAddonKey(addonKey: string): ProductType | undefined {
  if (!addonKey) return undefined;
  if (addonKey.includes('confluence-addon-lite')) return 'lite';
  if (addonKey.includes('confluence-addon')) return 'full';
  if (addonKey.includes('gptdock')) return 'diagramly';
  if (addonKey === 'my-api' || addonKey.includes('asyncapi')) return 'asyncapi';
  return undefined;
}

async function resolveClientDomain(
  env: SnapshotEnv,
  fit: Pick<VerifiedForgeFit, 'cloudId' | 'forgeAppAri' | 'forgeAppId'>,
): Promise<string> {
  const raw = await getAtlassianInstanceClientDomain(env.DB, fit.cloudId)
    || await getForgeInstallationClientDomain(env.DB, fit.forgeAppAri, fit.cloudId)
    || await getForgeInstallationClientDomain(env.DB, fit.forgeAppId, fit.cloudId);
  const domain = raw ? normalizeClientDomain(raw) : '';
  if (!domain) {
    throw new HttpError(403, 'Authenticated installation domain is unresolved');
  }
  return domain;
}

function rejectSpoofedIdentity(
  request: Request,
  body: Record<string, unknown> | undefined,
  context: Omit<AuthenticatedMetricsContext, 'environment'>,
): void {
  const url = new URL(request.url);
  const domainHint = url.searchParams.get('domain')
    ?? (typeof body?.domain === 'string' ? body.domain : undefined);
  if (domainHint && normalizeClientDomain(domainHint) !== context.clientDomain) {
    throw new HttpError(403, 'Request domain does not match authenticated installation');
  }

  const addonKey = url.searchParams.get('addonKey')
    ?? (typeof body?.addonKey === 'string' ? body.addonKey : undefined);
  const hintedProduct = addonKey ? productTypeFromAddonKey(addonKey) : undefined;
  if (addonKey && (!hintedProduct || hintedProduct !== context.productType)) {
    throw new HttpError(403, 'Request product does not match authenticated app');
  }

  const exactChecks: Array<[unknown, string, string]> = [
    [body?.cloudId, context.cloudId, 'cloudId'],
    [body?.installationId, context.installationId, 'installationId'],
    [body?.productType, context.productType, 'productType'],
    [body?.appId, context.appId, 'appId'],
  ];
  for (const [hint, expected, field] of exactChecks) {
    if (hint != null && hint !== expected) {
      throw new HttpError(403, `Request ${field} does not match authenticated installation`);
    }
  }
}

export async function authenticateMetricsRequest(
  request: Request,
  env: SnapshotEnv,
  options: {
    backendOnly?: boolean;
    body?: Record<string, unknown>;
    forgeContext?: ForgeRequestContext;
  } = {},
): Promise<AuthenticatedMetricsContext> {
  let fit: VerifiedForgeFit | undefined;
  let verifiedContext: ForgeRequestContext;
  if (options.forgeContext) {
    verifiedContext = options.forgeContext;
  } else {
    const jwt = getAuthorizationHeader(request);
    if (!jwt) throw new HttpError(401, 'Missing Forge Invocation Token');
    if (!env.ALLOWED_FORGE_APP_IDS) {
      throw new HttpError(500, 'ALLOWED_FORGE_APP_IDS is not configured');
    }
    try {
      fit = await validateContextToken(jwt, env.ALLOWED_FORGE_APP_IDS);
    } catch {
      throw new HttpError(401, 'Invalid Forge Invocation Token');
    }
    verifiedContext = {
      cloudId: fit.cloudId,
      apiBaseUrl: fit.apiBaseUrl,
      forgeAppId: fit.forgeAppId,
      forgeAppAri: fit.forgeAppAri,
      installationId: fit.installationId,
      environmentId: fit.environmentId,
      environmentType: fit.environmentType,
      invocationSource: fit.payload.context == null ? 'backend' : 'frontend',
    };
  }

  const appId = typeof verifiedContext.forgeAppId === 'string' ? verifiedContext.forgeAppId : '';
  const cloudId = typeof verifiedContext.cloudId === 'string' ? verifiedContext.cloudId : '';
  const installationId = typeof verifiedContext.installationId === 'string'
    ? verifiedContext.installationId
    : '';
  if (!appId || !cloudId || !installationId) {
    throw new HttpError(401, 'Verified FIT identity is incomplete');
  }
  const productType = productTypeForAppId(appId);
  if (!productType) throw new HttpError(403, 'Authenticated app is unsupported');

  if (options.backendOnly) {
    const hasSystemToken = Boolean(request.headers.get('x-forge-oauth-system'));
    const hasUserToken = hasForgeUserToken(request);
    // @forge/api.invokeRemote from a scheduled backend function has no user or
    // frontend context. Requiring this shape prevents a Custom UI caller with
    // a valid FIT from invoking the snapshot write protocol directly.
    if (verifiedContext.invocationSource !== 'backend' || !hasSystemToken || hasUserToken) {
      throw new HttpError(403, 'Snapshot writes require a backend Forge invocation');
    }
  }

  const normalizedFit = fit || {
    cloudId,
    forgeAppAri: verifiedContext.forgeAppAri || `ari:cloud:ecosystem::app/${appId}`,
    forgeAppId: appId,
  };
  const clientDomain = await resolveClientDomain(env, normalizedFit);
  const environment = verifiedContext.environmentType || env.ENVIRONMENT || 'unknown';
  if (
    env.EXPECTED_FORGE_ENVIRONMENT_TYPE
    && environment !== env.EXPECTED_FORGE_ENVIRONMENT_TYPE
  ) {
    throw new HttpError(403, 'Forge environment does not match this backend');
  }
  const context = {
    appId,
    cloudId,
    installationId,
    clientDomain,
    productType,
    environment,
  };
  rejectSpoofedIdentity(request, options.body, context);
  return context;
}

export async function isSnapshotEnrolled(
  env: SnapshotEnv,
  context: AuthenticatedMetricsContext,
): Promise<boolean> {
  if (context.appId !== LITE_APP_ID || context.productType !== 'lite') return false;
  const raw = await env.KV_FEATURE_FLAGS.get('CUSTOMER_SUCCESS_SERVICE');
  if (!raw) return false;
  try {
    const flags = JSON.parse(raw) as Record<string, unknown>;
    return Boolean(flags[context.clientDomain]);
  } catch {
    throw new HttpError(500, 'CUSTOMER_SUCCESS_SERVICE is malformed');
  }
}

export function utcDateParts(iso: string): { year: string; month: string; day: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(iso);
  if (!match) throw new HttpError(400, 'Invalid capturedAt timestamp');
  return { year: match[1], month: match[2], day: match[3] };
}

export function tenantSnapshotPrefix(productType: ProductType, cloudId: string): string {
  return `${SNAPSHOT_PREFIX}/${productType}/${cloudId}`;
}

export function latestPointerKey(productType: ProductType, cloudId: string): string {
  return `${tenantSnapshotPrefix(productType, cloudId)}/latest.json`;
}

export function claimKey(productType: ProductType, cloudId: string, capturedAt: string): string {
  const { year, month, day } = utcDateParts(capturedAt);
  return `${tenantSnapshotPrefix(productType, cloudId)}/${year}/${month}/${day}/claim.json`;
}

export function runPrefix(claim: DailyClaim): string {
  const { year, month, day } = utcDateParts(claim.capturedAt);
  return `${tenantSnapshotPrefix(claim.productType, claim.cloudId)}/${year}/${month}/${day}/${claim.runId}`;
}

export function metricsKvKey(context: Pick<AuthenticatedMetricsContext, 'clientDomain' | 'productType'>): string {
  return `metrics:${context.clientDomain}:${context.productType}`;
}

export async function readJsonObject<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  try {
    return await object.json<T>();
  } catch {
    throw new HttpError(409, 'Stored snapshot object is malformed');
  }
}

export async function readLatestPointer(
  env: SnapshotEnv,
  context: Pick<AuthenticatedMetricsContext, 'productType' | 'cloudId'>,
): Promise<LatestPointer | null> {
  return readJsonObject<LatestPointer>(
    env.MACRO_COUNT_SNAPSHOT_BUCKET,
    latestPointerKey(context.productType, context.cloudId),
  );
}

/**
 * Read one bucket, treating absent as 0.
 *
 * The backend deploys ahead of the Forge app in the same pipeline, and installs
 * upgrade on their own schedule, so a client predating a newly added bucket
 * (e.g. `asyncapi`) keeps posting payloads without it. Reading those as 0 keeps
 * them valid instead of 400-ing the whole snapshot.
 *
 * Deliberately NON-mutating: chunk payloads are integrity-checked against a
 * client-computed sha256 of the exact bytes sent, so writing a default back
 * into the payload would change the re-serialized object and fail that check.
 */
export function countBucket(metrics: MacroCounts, field: CountField): number {
  return metrics[field] ?? 0;
}

/**
 * A full count set with every bucket present, absent ones defaulted to 0.
 *
 * Use this at every point that PERSISTS counts. `assertCounts` tolerates an
 * absent bucket (a client predating it), which is correct — the total-vs-buckets
 * invariant still holds, the payload just omits a zero. But tolerating it on
 * read must not mean writing `undefined` into KV: consumers would then have to
 * guard a field the type says is a number.
 *
 * NOT for chunk payloads, which are integrity-checked against a
 * client-computed sha256 of the exact bytes sent — those must stay untouched.
 */
export function normalizeCounts(metrics: MacroCounts): MacroCounts {
  const out = { total: metrics.total } as MacroCounts;
  for (const field of COUNT_FIELDS) out[field] = countBucket(metrics, field);
  return out;
}

/**
 * Compare two count sets bucket by bucket.
 *
 * NOT `JSON.stringify(a) === JSON.stringify(b)`: that is sensitive to key order
 * and key presence, so the moment one side carries a bucket the other omits —
 * a newly added bucket against a client that predates it — otherwise-identical
 * counts compare unequal and the commit 409s.
 */
export function countsEqual(a: MacroCounts, b: MacroCounts): boolean {
  return a.total === b.total
    && COUNT_FIELDS.every((field) => countBucket(a, field) === countBucket(b, field));
}

export function assertCounts(metrics: MacroCounts): void {
  if (!Number.isSafeInteger(metrics.total) || metrics.total < 0) {
    throw new HttpError(400, 'Invalid non-negative count: total');
  }
  for (const field of COUNT_FIELDS) {
    const value = countBucket(metrics, field);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new HttpError(400, `Invalid non-negative count: ${field}`);
    }
  }
  const bucketTotal = COUNT_FIELDS.reduce((sum, field) => sum + countBucket(metrics, field), 0);
  if (metrics.total !== bucketTotal) {
    throw new HttpError(400, 'Macro count invariant failed');
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function boundedString<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

export const JSON_METADATA = { contentType: 'application/json' };
export const MAX_CHUNK_BODY_BYTES = 450 * 1024;

export type FailureStage =
  'claim' | 'scan' | 'pagination' | 'space_map' | 'chunk_upload' | 'commit' | 'unknown';
export type FailureReason =
  | 'confluence_429' | 'confluence_4xx' | 'confluence_5xx' | 'confluence_network'
  | 'invalid_pagination' | 'missing_space_id' | 'unresolved_space_id'
  | 'invalid_chunk' | 'r2_write_failed' | 'kv_write_failed' | 'timeout' | 'unknown';

export interface ChunkReference {
  key: string;
  rowCount: number;
  sha256: string;
}

export interface RunManifest {
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

export function nowIso(): string {
  return new Date().toISOString();
}

export function safeDuration(value: unknown, capturedAt: string): number {
  if (Number.isFinite(value) && (value as number) >= 0) return Math.round(value as number);
  return Math.max(0, Date.now() - Date.parse(capturedAt));
}

export function scheduleAnalytics(
  env: SnapshotEnv,
  waitUntil: ((promise: Promise<unknown>) => void) | undefined,
  events: Parameters<typeof mixpanelImportServiceEvents>[0],
): void {
  if (!env.MIXPANEL_TOKEN || events.length === 0) return;
  const delivery = mixpanelImportServiceEvents(events, env.MIXPANEL_TOKEN, { runtime: env }).catch((error) => {
    console.warn('[macro-count:snapshot] Mixpanel delivery failed', {
      reason: error instanceof Error ? error.name : 'unknown_error',
      eventCount: events.length,
    });
  });
  if (waitUntil) waitUntil(delivery);
  else void delivery;
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

export function addCounts(target: MacroCounts, source: MacroCounts): void {
  target.total += source.total;
  // countBucket, not source[field]: a client predating a bucket omits it, and
  // `+= undefined` would poison the whole aggregate with NaN.
  for (const field of COUNT_FIELDS) target[field] += countBucket(source, field);
}

export function safeIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._~-]{1,200}$/.test(value)) {
    throw new HttpError(400, `Invalid ${field}`);
  }
  return value;
}

export function safeHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new HttpError(400, 'Invalid SHA-256 hash');
  }
  return value;
}

export function safeRowCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new HttpError(400, 'Invalid row count');
  }
  return value as number;
}

export async function parseBody<T extends Record<string, unknown>>(request: Request): Promise<T> {
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

export function requirePost(request: Request): void {
  if (request.method !== 'POST') throw new HttpError(405, 'Method Not Allowed');
}

export function initialRunManifest(claim: DailyClaim): RunManifest {
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

export async function putJson(
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

export async function findActiveClaim(
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
