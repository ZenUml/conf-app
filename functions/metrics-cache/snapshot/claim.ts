import { json } from '../../OkResponse';
import type { ForgeRequestData } from '../../utils/authenticate';
import {
  CLAIM_STALE_MS,
  SNAPSHOT_SCHEMA_VERSION,
  HttpError,
  authenticateMetricsRequest,
  claimKey,
  emptyCounts,
  errorResponse,
  initialRunManifest,
  isSnapshotEnrolled,
  nowIso,
  NO_STORE_HEADERS,
  parseBody,
  putJson,
  requirePost,
  runPrefix,
  type AuthenticatedMetricsContext,
  type DailyClaim,
  type SnapshotEnv,
} from './common';

interface ClaimResponse {
  eligible: boolean;
  claimed?: boolean;
  duplicate?: boolean;
  completed?: boolean;
  runId?: string;
  capturedAt?: string;
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
      return json({ eligible: false } satisfies ClaimResponse, { headers: NO_STORE_HEADERS });
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
        return json({
          eligible: true,
          duplicate: true,
          completed: true,
          runId: existing.claim.runId,
          capturedAt: existing.claim.capturedAt,
        } satisfies ClaimResponse, { headers: NO_STORE_HEADERS });
      }
      if (existing.claim.state === 'running' && !isStale(existing.claim)) {
        return json({
          eligible: true,
          duplicate: true,
          runId: existing.claim.runId,
          capturedAt: existing.claim.capturedAt,
        } satisfies ClaimResponse, { headers: NO_STORE_HEADERS });
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
    return json({
      eligible: true,
      claimed: true,
      runId,
      capturedAt,
    } satisfies ClaimResponse, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

export const onRequest: PagesFunction<SnapshotEnv, string, ForgeRequestData> =
  ({ request, env, data }) => handleClaim(request, env, data);
