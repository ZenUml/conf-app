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
import { mixpanelImportServiceEvents } from '../service/mixpanelService';
import type { AnalyticsEventName } from '../service/analyticsTypes';

export type ConversionEnv = SnapshotEnv;

const TERMINAL_STATUSES = new Set(['done', 'failed']);
/**
 * Not terminal: the executor converted a full batch and there may be more.
 * The job goes back to `queued` with its cursor advanced and its counts
 * accumulated, so the next tick continues instead of the job stopping
 * half-migrated. Silent truncation was the alternative and is not acceptable.
 */
const REQUEUE_STATUS = 'requeue';
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
  pageOffset: number;
  pageBatchLimit: number | null;
}

/**
 * Conversion telemetry is emitted HERE, not from the Forge executor: the
 * scheduled function has no Mixpanel token and no browser tracker, while this
 * endpoint already holds the verified tenant identity and the job row.
 *
 * `distinctId` is the job id — a conversion run is the subject, and a
 * scheduled job must never masquerade as an Atlassian user. `insertId` is
 * derived from (jobId, event) so a retried claim or report deduplicates.
 * Delivery failures are logged, never surfaced: telemetry must not fail a
 * conversion.
 *
 * `waitUntil` is required in practice, not decorative: without it the Worker
 * returns its response and the in-flight Import fetch is cancelled. Measured
 * 2026-08-12 on full-stg — the claim event arrived, the completion event never
 * did, because the report handler had one fetch to lose and the claim path had
 * three chances to win the race.
 */
function emitConversionEvent(
  env: ConversionEnv,
  event: AnalyticsEventName,
  jobId: string,
  cloudId: string,
  properties: Record<string, string | number | boolean | null>,
  waitUntil?: (promise: Promise<unknown>) => void,
): void {
  if (!env.MIXPANEL_TOKEN) return;
  const delivery = mixpanelImportServiceEvents(
    [
      {
        event,
        distinctId: jobId,
        insertId: `${jobId}:${event}`,
        time: Math.floor(Date.now() / 1000),
        properties: { ...properties, cloud_id: cloudId, product_type: 'full' },
      },
    ],
    env.MIXPANEL_TOKEN,
  ).catch((error) => {
    console.warn('[lite2full] Mixpanel delivery failed', {
      event,
      reason: error instanceof Error ? error.name : 'unknown_error',
    });
  });
  if (waitUntil) waitUntil(delivery);
  else void delivery;
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
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Response> {
  try {
    const context = await requireFullAppContext(request, env, data);
    const now = new Date().toISOString();
    const staleBefore = new Date(Date.now() - CLAIM_STALE_MS).toISOString();

    // Oldest queued job, or a stale claim left behind by a dead invocation.
    const row = await env.DB.prepare(
      `SELECT id, cloudId, spaceKey, pageIds, dryRun, requestSource, status, claimedAt,
              pageOffset, pageBatchLimit
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

    emitConversionEvent(env, 'macro_convert_job_claimed', row.id, context.cloudId, {
      convert_scope: row.spaceKey ? 'space' : 'pages',
      convert_page_count: row.pageIds ? (JSON.parse(row.pageIds) as string[]).length : 0,
      convert_dry_run: row.dryRun === 1,
      convert_request_source: row.requestSource,
    }, waitUntil);

    return jsonResponse({
      job: {
        id: row.id,
        spaceKey: row.spaceKey,
        pageIds: row.pageIds ? (JSON.parse(row.pageIds) as string[]) : null,
        dryRun: row.dryRun === 1,
        requestSource: row.requestSource,
        pageOffset: row.pageOffset ?? 0,
        pageBatchLimit: row.pageBatchLimit ?? null,
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
    const context = await requireFullAppContext(request, env, data);
    const body = (await request.json().catch(() => null)) as {
      contentIds?: unknown;
      jobId?: unknown;
    } | null;
    const ids = Array.isArray(body?.contentIds)
      ? body!.contentIds.filter((v): v is string => typeof v === 'string' && /^\d+$/.test(v))
      : [];
    if (ids.length === 0) throw new HttpError(400, 'contentIds required');
    if (ids.length > MAX_BODY_IDS) throw new HttpError(400, `contentIds > ${MAX_BODY_IDS}`);

    // The mirror carries no tenant column — CustomContent is keyed by
    // (contentId, appId) and spaceId is per-site, so a contentId alone proves
    // nothing about who owns it. Bind the read to a job WE created for this
    // cloudId and that this caller currently holds: without an active claim,
    // a tenant's Full app cannot read Lite bodies at all.
    const jobId = typeof body?.jobId === 'string' ? body.jobId : '';
    if (!jobId) throw new HttpError(400, 'jobId required');
    const job = await env.DB.prepare(
      `SELECT id FROM ConversionJob WHERE id = ?1 AND cloudId = ?2 AND status = 'claimed'`,
    )
      .bind(jobId, context.cloudId)
      .first<{ id: string }>();
    if (!job) throw new HttpError(403, 'no claimed conversion job for this tenant');

    // Latest version per Lite custom content id, from the D1 mirror. appId is
    // pinned to the Lite Forge app so this endpoint can never leak another
    // variant's rows regardless of the ids passed in. Authorization note: ids
    // name content the calling app can already see rendered on pages it is
    // about to edit; the FIT + Full-only gate above bounds the caller to one
    // tenant's app.
    const placeholders = ids.map((_, i) => `?${i + 2}`).join(',');
    const rows = await env.DB.prepare(
      `SELECT v.contentId AS contentId, v.body AS body, v.title AS title,
              c.diagramType AS diagramType, c.type AS contentType,
              v.versionNumber AS versionNumber
         FROM CustomContentVersion v
         JOIN CustomContent c ON c.contentId = v.contentId AND c.appId = v.appId
        WHERE v.appId = ?1 AND v.contentId IN (${placeholders})
          AND v.versionNumber = (
            SELECT MAX(v2.versionNumber) FROM CustomContentVersion v2
             WHERE v2.contentId = v.contentId AND v2.appId = v.appId)`,
    )
      .bind(LITE_APP_ID, ...ids)
      .all<{
        contentId: string;
        body: string;
        title: string | null;
        diagramType: string | null;
        contentType: string | null;
        versionNumber: number;
      }>();

    const found: Record<
      string,
      { body: string; title: string | null; diagramType: string | null; contentType: string | null }
    > = {};
    for (const r of rows.results ?? []) {
      const body = unwrapMirrorBody(r.body);
      if (body === null) continue; // falls through to `missing` — see unwrapMirrorBody
      // contentType travels so the converted content lands under the SAME
      // custom-content key Lite used. The app writes every diagram type under
      // `zenuml-content-sequence` (ApWrapper2.getContentKey) — 2103 of 2104
      // mirrored graph bodies included — so deriving the type from the macro
      // key would produce content the app itself never creates.
      found[r.contentId] = {
        body,
        title: r.title,
        diagramType: r.diagramType,
        contentType: r.contentType,
      };
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
  waitUntil?: (promise: Promise<unknown>) => void,
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
    if (!jobId || !(TERMINAL_STATUSES.has(status) || status === REQUEUE_STATUS)) {
      throw new HttpError(400, 'jobId and terminal status required');
    }
    const pagesProcessed =
      typeof (body as { pagesProcessed?: unknown })?.pagesProcessed === 'number'
        ? Math.max(0, Math.trunc((body as { pagesProcessed: number }).pagesProcessed))
        : 0;
    const stats =
      body?.stats && typeof body.stats === 'object' && !Array.isArray(body.stats)
        ? sanitizeStats(body.stats as Record<string, unknown>)
        : {};
    const failureStage =
      typeof body?.failureStage === 'string' ? body.failureStage.slice(0, 40) : null;

    // Counts accumulate across batches: a job's final statsJson must describe
    // the whole migration, not just its last tick.
    const prior = await env.DB.prepare(
      `SELECT statsJson, pageOffset FROM ConversionJob
        WHERE id = ?1 AND cloudId = ?2 AND status = 'claimed'`,
    )
      .bind(jobId, context.cloudId)
      .first<{ statsJson: string | null; pageOffset: number }>();
    if (!prior) throw new HttpError(409, 'Job is not claimed for this installation');
    const merged = mergeStats(prior.statsJson, stats);

    const requeue = status === REQUEUE_STATUS;
    const updated = await env.DB.prepare(
      `UPDATE ConversionJob
          SET status = ?2,
              completedAt = ?3,
              statsJson = ?4,
              failureStage = ?5,
              claimedAt = ?7,
              pageOffset = ?8
        WHERE id = ?1 AND cloudId = ?6 AND status = 'claimed'`,
    )
      .bind(
        jobId,
        requeue ? 'queued' : status,
        requeue ? null : new Date().toISOString(),
        JSON.stringify(merged),
        failureStage,
        context.cloudId,
        requeue ? null : new Date().toISOString(),
        (prior.pageOffset ?? 0) + pagesProcessed,
      )
      .run();
    if (!updated.meta || updated.meta.changes === 0) {
      throw new HttpError(409, 'Job is not claimed for this installation');
    }

    // A requeue is mid-flight; only a terminal report is a completion.
    if (!requeue) {
      emitConversionEvent(env, 'macro_convert_job_completed', jobId, context.cloudId, {
        convert_status: status,
        convert_failure_stage: failureStage,
        ...merged,
      }, waitUntil);
    }

    return jsonResponse({ ok: true, status: requeue ? 'queued' : status });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Add this batch's counts to whatever earlier batches recorded. `dryRun` is a
 * property of the job, not a count, so it is carried rather than summed.
 */
export function mergeStats(
  priorJson: string | null,
  batch: Record<string, number | boolean>,
): Record<string, number | boolean> {
  let prior: Record<string, unknown> = {};
  try {
    if (priorJson) prior = JSON.parse(priorJson) as Record<string, unknown>;
  } catch {
    prior = {};
  }
  const out: Record<string, number | boolean> = {};
  for (const [key, value] of Object.entries(batch)) {
    if (typeof value === 'boolean') {
      out[key] = value;
      continue;
    }
    const before = prior[key];
    out[key] = (typeof before === 'number' ? before : 0) + value;
  }
  // Keys an earlier batch reported that this one omitted stay visible.
  for (const [key, value] of Object.entries(prior)) {
    if (!(key in out) && (typeof value === 'number' || typeof value === 'boolean')) {
      out[key] = value;
    }
  }
  return out;
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
    'macrosSkippedAsyncApi',
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
