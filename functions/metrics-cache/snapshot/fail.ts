import { json } from '../../OkResponse';
import type { ForgeRequestData } from '../../utils/authenticate';
import {
  HttpError,
  authenticateMetricsRequest,
  boundedString,
  errorResponse,
  findActiveClaim,
  initialRunManifest,
  nowIso,
  NO_STORE_HEADERS,
  parseBody,
  putJson,
  readJsonObject,
  requirePost,
  runPrefix,
  safeDuration,
  safeRowCount,
  scheduleAnalytics,
  type DailyClaim,
  type FailureReason,
  type FailureStage,
  type RunManifest,
  type SnapshotEnv,
} from './common';
import { failedSnapshotEvent } from '../../service/macroCountSnapshotAnalytics';

const FAILURE_STAGES: readonly FailureStage[] = [
  'claim', 'scan', 'pagination', 'space_map', 'chunk_upload', 'commit', 'unknown',
];
const FAILURE_REASONS: readonly FailureReason[] = [
  'confluence_429', 'confluence_4xx', 'confluence_5xx', 'confluence_network',
  'invalid_pagination', 'missing_space_id', 'unresolved_space_id',
  'invalid_chunk', 'r2_write_failed', 'kv_write_failed', 'timeout', 'unknown',
];

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
    const failureStage = boundedString(body.failureStage, FAILURE_STAGES, 'unknown');
    const failureReason = boundedString(body.failureReason, FAILURE_REASONS, 'unknown');
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
    return json({ success: true, runId: active.claim.runId }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

export const onRequest: PagesFunction<SnapshotEnv, string, ForgeRequestData> =
  ({ request, env, data, waitUntil }) => handleFail(request, env, data, waitUntil);
