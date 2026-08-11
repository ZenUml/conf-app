/**
 * Lite->Full macro conversion queue — backend side (phase 1).
 *
 * Three FIT-authed endpoints consumed by the Full app's scheduled function
 * (src/lite-full-conversion.ts):
 *
 *   POST /conversion/claim   -> oldest queued ConversionJob for the FIT's cloudId
 *   POST /conversion/bodies  -> Lite diagram bodies for a set of customContentIds (D1 mirror)
 *   POST /conversion/report  -> terminal job status + counts
 *
 * Identity rules, same as the macro-count snapshot service: the tenant is the
 * verified FIT's cloudId — request bodies never name a tenant; and only the
 * FULL app may operate this queue (Lite/Diagramly/AsyncAPI FITs are rejected),
 * because converted custom content must be created under Full's identity.
 *
 * Design: docs/superpowers/specs/2026-08-11-lite-to-full-conversion.md
 */

import {
  HttpError,
  jsonResponse,
  errorResponse,
  authenticateMetricsRequest,
  LITE_APP_ID,
  productTypeForAppId,
  type SnapshotEnv,
} from '../metrics-cache/snapshot/common';
import type { ForgeRequestData } from '../utils/authenticate';

export type ConversionEnv = SnapshotEnv;

const TERMINAL_STATUSES = new Set(['done', 'failed']);
/** A claim older than this is considered abandoned and re-claimable. */
export const CLAIM_STALE_MS = 60 * 60 * 1000;
const MAX_BODY_IDS = 100;

interface ConversionJobRow {
  id: string;
  cloudId: string;
  spaceKey: string | null;
  pageIds: string | null;
  dryRun: number;
  requestSource: string;
  status: string;
  claimedAt: string | null;
}

async function requireFullAppContext(
  request: Request,
  env: ConversionEnv,
  data: ForgeRequestData,
) {
  const context = await authenticateMetricsRequest(request, env, {
    forgeContext: data.forgeContext,
  });
  if (productTypeForAppId(context.appId) !== 'full') {
    throw new HttpError(403, 'Conversion queue is operated by the Full app only');
  }
  // environmentId/Type are on the middleware-verified ForgeRequestContext but
  // not carried through AuthenticatedMetricsContext; read them from the same
  // verified object rather than widening the shared snapshot type.
  return {
    ...context,
    environmentId: data.forgeContext?.environmentId ?? null,
    environmentType: data.forgeContext?.environmentType ?? null,
  };
}

export async function handleClaim(
  request: Request,
  env: ConversionEnv,
  data: ForgeRequestData,
): Promise<Response> {
  try {
    const context = await requireFullAppContext(request, env, data);
    const now = new Date().toISOString();
    const staleBefore = new Date(Date.now() - CLAIM_STALE_MS).toISOString();

    // Oldest queued job, or a stale claim left behind by a dead invocation.
    const row = await env.DB.prepare(
      `SELECT id, cloudId, spaceKey, pageIds, dryRun, requestSource, status, claimedAt
         FROM ConversionJob
        WHERE cloudId = ?1
          AND (status = 'queued' OR (status = 'claimed' AND claimedAt < ?2))
        ORDER BY createdAt
        LIMIT 1`,
    )
      .bind(context.cloudId, staleBefore)
      .first<ConversionJobRow>();

    if (!row) return jsonResponse({ job: null });

    const claimed = await env.DB.prepare(
      `UPDATE ConversionJob SET status = 'claimed', claimedAt = ?2
        WHERE id = ?1 AND status IN ('queued', 'claimed') AND (claimedAt IS NULL OR claimedAt < ?3)`,
    )
      .bind(row.id, now, staleBefore)
      .run();
    if (!claimed.meta || claimed.meta.changes === 0) {
      // Lost the race to a concurrent invocation — behave as an empty queue.
      return jsonResponse({ job: null });
    }

    return jsonResponse({
      job: {
        id: row.id,
        spaceKey: row.spaceKey,
        pageIds: row.pageIds ? (JSON.parse(row.pageIds) as string[]) : null,
        dryRun: row.dryRun === 1,
        requestSource: row.requestSource,
      },
      // The executor's own identity, echoed from the VERIFIED FIT rather than
      // re-derived in the Forge runtime — the ADF rewrite builds the new
      // extensionKey/extensionId from these, so they must come from the same
      // trust root that authorized the claim.
      app: {
        appId: context.appId,
        environmentId: context.environmentId ?? null,
        environmentType: context.environmentType ?? null,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * The mirror's `body` column is `JSON.stringify(customContent.body)` — the
 * Confluence body OBJECT (`{raw: {representation, value}}`), not the diagram
 * JSON the viewer parses. Return the inner `raw.value`, or null when the
 * column is any other shape: an unrecognised body must skip the macro, never
 * be written into new custom content.
 */
export function unwrapMirrorBody(stored: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  const value = (parsed as { raw?: { value?: unknown } } | null)?.raw?.value;
  return typeof value === 'string' ? value : null;
}

export async function handleBodies(
  request: Request,
  env: ConversionEnv,
  data: ForgeRequestData,
): Promise<Response> {
  try {
    await requireFullAppContext(request, env, data);
    const body = (await request.json().catch(() => null)) as {
      contentIds?: unknown;
    } | null;
    const ids = Array.isArray(body?.contentIds)
      ? body!.contentIds.filter((v): v is string => typeof v === 'string' && /^\d+$/.test(v))
      : [];
    if (ids.length === 0) throw new HttpError(400, 'contentIds required');
    if (ids.length > MAX_BODY_IDS) throw new HttpError(400, `contentIds > ${MAX_BODY_IDS}`);

    // Latest version per Lite custom content id, from the D1 mirror. appId is
    // pinned to the Lite Forge app so this endpoint can never leak another
    // variant's rows regardless of the ids passed in. Authorization note: ids
    // name content the calling app can already see rendered on pages it is
    // about to edit; the FIT + Full-only gate above bounds the caller to one
    // tenant's app.
    const placeholders = ids.map((_, i) => `?${i + 2}`).join(',');
    const rows = await env.DB.prepare(
      `SELECT v.contentId AS contentId, v.body AS body, v.title AS title,
              c.diagramType AS diagramType, v.versionNumber AS versionNumber
         FROM CustomContentVersion v
         JOIN CustomContent c ON c.contentId = v.contentId AND c.appId = v.appId
        WHERE v.appId = ?1 AND v.contentId IN (${placeholders})
          AND v.versionNumber = (
            SELECT MAX(v2.versionNumber) FROM CustomContentVersion v2
             WHERE v2.contentId = v.contentId AND v2.appId = v.appId)`,
    )
      .bind(LITE_APP_ID, ...ids)
      .all<{ contentId: string; body: string; title: string | null; diagramType: string | null; versionNumber: number }>();

    const found: Record<string, { body: string; title: string | null; diagramType: string | null }> = {};
    for (const r of rows.results ?? []) {
      const body = unwrapMirrorBody(r.body);
      if (body === null) continue; // falls through to `missing` — see unwrapMirrorBody
      found[r.contentId] = { body, title: r.title, diagramType: r.diagramType };
    }
    const missing = ids.filter((id) => !(id in found));
    return jsonResponse({ contents: found, missing });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function handleReport(
  request: Request,
  env: ConversionEnv,
  data: ForgeRequestData,
): Promise<Response> {
  try {
    const context = await requireFullAppContext(request, env, data);
    const body = (await request.json().catch(() => null)) as {
      jobId?: unknown;
      status?: unknown;
      failureStage?: unknown;
      stats?: unknown;
    } | null;
    const jobId = typeof body?.jobId === 'string' ? body.jobId : '';
    const status = typeof body?.status === 'string' ? body.status : '';
    if (!jobId || !TERMINAL_STATUSES.has(status)) {
      throw new HttpError(400, 'jobId and terminal status required');
    }
    const stats =
      body?.stats && typeof body.stats === 'object' && !Array.isArray(body.stats)
        ? sanitizeStats(body.stats as Record<string, unknown>)
        : {};
    const failureStage =
      typeof body?.failureStage === 'string' ? body.failureStage.slice(0, 40) : null;

    const updated = await env.DB.prepare(
      `UPDATE ConversionJob
          SET status = ?2, completedAt = ?3, statsJson = ?4, failureStage = ?5
        WHERE id = ?1 AND cloudId = ?6 AND status = 'claimed'`,
    )
      .bind(jobId, status, new Date().toISOString(), JSON.stringify(stats), failureStage, context.cloudId)
      .run();
    if (!updated.meta || updated.meta.changes === 0) {
      throw new HttpError(409, 'Job is not claimed for this installation');
    }
    return jsonResponse({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Counts only — the report path must never persist content, titles, or raw errors. */
function sanitizeStats(input: Record<string, unknown>): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  const allowed = [
    'pagesTotal',
    'pagesSucceeded',
    'pagesFailed',
    'macrosConverted',
    'macrosSkippedEmbed',
    'macrosSkippedUnknownKey',
    'macrosSkippedBodyMissing',
    'dryRun',
  ] as const;
  for (const key of allowed) {
    const v = input[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    if (typeof v === 'boolean') out[key] = v;
  }
  return out;
}
