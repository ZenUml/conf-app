
import api, { route } from '@forge/api';

// ---------------------------------------------------------------------------
// Analytics — Phase 1 instrumentation (spec: docs/superpowers/specs/2026-05-12-pdf-export-paywall-strategy-design.md)
//
// Events are sent directly to Mixpanel /import from this Forge backend function.
// Requires MIXPANEL_TOKEN to be set as a Forge variable:
//   forge variables set MIXPANEL_TOKEN <token> -e staging
//   forge variables set MIXPANEL_TOKEN <token> -e production
//
// NEVER emit page_viewed / page_updated from this function — those are
// intentionally excluded from Mixpanel (see forge-user-behavior.ts).
// ---------------------------------------------------------------------------

/**
 * Extracts structured export context from the adfExport payload.
 *
 * Format detection: Word sets context.content.id at the top level;
 * PDF sets context.extension.content.id (see lines 13–15 below).
 *
 * Also extracts `pageId` and `customContentId` so every event (incl.
 * `macro_export_requested`) can carry the join keys we use to correlate
 * with frontend `attachment_upload_*` events.
 */
// conf-app#435: maps the custom content's `diagramType` field (see
// src/model/Diagram/Diagram.ts DiagramType, and the same fallback pattern in
// src/model/ContentProvider/Persistence.ts's DIAGRAM_TYPE_TO_MACRO_TYPE) to the
// MacroTypeValue used across analytics (src/utils/analytics/catalog.ts). Not
// imported directly — export.js runs in the Forge functions bundle, kept free
// of the frontend/Vue module graph — so the mapping is duplicated here.
const DIAGRAM_TYPE_TO_MACRO_TYPE = {
  sequence: 'sequence',
  mermaid: 'mermaid',
  plantuml: 'plantuml',
  graph: 'graph',
  OpenAPI: 'openapi',
  AsyncAPI: 'asyncapi',
  embed: 'embed',
};

/**
 * Resolves the exported macro's diagram type for analytics sizing (#435:
 * "macro_export_* events carry no diagram type, so export failures can't be
 * sized per type"). export.js otherwise never fetches custom content — it
 * only resolves the attachment by filename — so this is a dedicated GET,
 * accepted per #435's "route 2" (one extra Confluence API call per export)
 * since folding this into #434's server-side-render work isn't scheduled yet.
 *
 * Returns 'none' — the same "type didn't resolve" sentinel the frontend
 * already uses (Persistence.ts's DIAGRAM_TYPE_TO_MACRO_TYPE fallback) — for
 * every case where the type genuinely cannot be determined: no
 * customContentId (nothing to look up — the `missing_custom_content_id`
 * failure path), a non-2xx custom-content response (content deleted, page
 * restricted, asApp() lacking read access), a non-JSON raw body, or a raw
 * body with no (or an unrecognized) `diagramType` field. Recording 'none'
 * explicitly (rather than omitting the property) matters: an absent property
 * and an unknown type look identical in a Mixpanel query, and #435 exists
 * because of exactly that ambiguity.
 */
/**
 * The single custom-content read for an export invocation.
 *
 * Both consumers below need the SAME parsed body — `macro_type` (#435) reads
 * `diagramType`, and the PlantUML server render (#434 slice 1) reads
 * `diagramType` + `plantUmlCode`. They were built independently and each
 * fetched it, which made every export issue two identical GETs. The handler
 * now calls this once and stores the result on `ctx`; nothing here is cached
 * across invocations, because a warm Forge container would then serve a stale
 * body for content edited in between.
 *
 * Returns the parsed raw body, or null on any lookup/parse failure.
 */
export async function fetchCustomContentParsed(customContentId) {
  if (!customContentId) return null;
  try {
    const response = await api
      .asApp()
      .requestConfluence(route`/wiki/api/v2/custom-content/${customContentId}?body-format=raw`);
    if (!response.ok) {
      console.debug(`Export: custom-content lookup ${response.status} for ${customContentId}`);
      return null;
    }
    const customContent = await response.json();
    const rawValue = customContent?.body?.raw?.value;
    if (!rawValue) return null;
    return JSON.parse(rawValue);
  } catch (e) {
    console.warn(`Export: custom-content lookup failed for ${customContentId}:`, e?.message);
    return null;
  }
}

/** Maps an already-parsed body to its macro_type, with the 'none' sentinel. */
export function macroTypeFromParsed(parsed) {
  return DIAGRAM_TYPE_TO_MACRO_TYPE[parsed?.diagramType] ?? 'none';
}

export async function resolveMacroType(customContentId) {
  if (!customContentId) return 'none';
  return macroTypeFromParsed(await fetchCustomContentParsed(customContentId));
}

export function extractExportContext(payload) {
  const format = payload.exportType ?? (payload.context?.content?.id || payload.context?.contentId ? 'word' : 'pdf');

  const cloudId = payload.context?.cloudId ?? 'unknown';

  const siteUrl = payload.context?.siteUrl;
  let clientDomain = cloudId;
  if (siteUrl) {
    try {
      const hostname = new URL(siteUrl).hostname.toLowerCase();
      const match = /^([a-z0-9-_]+)\.atlassian\.net$/.exec(hostname);
      clientDomain = match ? match[1] : hostname;
    } catch (_) { clientDomain = siteUrl; }
  }

  const spaceKey = payload.context?.spaceKey ?? payload.context?.extension?.space?.key ?? 'unknown';

  const accountId = payload.context?.accountId ?? null;

  // Page → Word puts contentId at top level; PDF nests under context.extension.content.id.
  const pageId = payload.context?.content?.id
    ?? payload.context?.contentId
    ?? payload.context?.extension?.content?.id
    ?? null;

  // Macro instance → Word puts it on context.config; PDF on extensionPayload.config.
  const customContentId = payload.context?.config?.customContentId
    ?? payload.extensionPayload?.config?.customContentId
    ?? null;

  const attachmentName = customContentId ? `zenuml-${customContentId}.png` : null;

  // macroType is resolved separately (async, requires a custom-content GET —
  // see resolveMacroType) and attached to the context by the caller before
  // the first trackExportEvent call; default to 'none' ("not yet resolved")
  // so a caller that forgets the step still emits an explicit sentinel
  // instead of a silently absent property.
  return { format, cloudId, clientDomain, spaceKey, accountId, pageId, customContentId, attachmentName, macroType: 'none' };
}

/**
 * Common join-key fields included on every export tracking event so we can
 * left-join to the frontend `attachment_upload_*` events on
 * (cloud_id, custom_content_id, page_id). Also carries `macro_type` (#435)
 * so export failures/successes can be sized per diagram type.
 */
export function joinKeyProps(ctx) {
  return {
    account_id: ctx.accountId,
    client_domain: ctx.clientDomain,
    cloud_id: ctx.cloudId,
    space_key: ctx.spaceKey,
    page_id: ctx.pageId,
    custom_content_id: ctx.customContentId,
    attachment_name: ctx.attachmentName,
    format: ctx.format,
    macro_type: ctx.macroType ?? 'none',
  };
}

/**
 * Sends a single event to Mixpanel /import.
 * Awaited — Forge's serverless runtime kills pending promises when the handler returns,
 * so fire-and-forget is not reliable here.
 * Uses a 3-second timeout so a slow Mixpanel call never blocks the export response.
 * Never throws — a tracking failure must never break the export function.
 */
export async function trackExportEvent(eventName, properties) {
  const token = process.env.MIXPANEL_TOKEN;
  if (!token) {
    console.debug('Export: MIXPANEL_TOKEN not set — skipping analytics');
    return;
  }
  try {
    const body = JSON.stringify([{
      event: eventName,
      properties: {
        token,
        time: Math.floor(Date.now() / 1000),
        distinct_id: properties.account_id ?? properties.client_domain ?? 'forge_export',
        // Mixpanel requires $insert_id to be at most 36 bytes and contain only
        // alphanumeric characters or hyphens. A previous semantic key included
        // the event, cloud, page and macro identities plus a timestamp; Mixpanel
        // stored only its first 36 characters, before the page and macro identity,
        // so same-tenant exports still collided. A UUID fits the contract and is
        // unique per handler event, including same-millisecond macro exports.
        //
        // Measured 2026-08-16: `exportMacro` ran 12,407 times in 24h on Lite
        // production (Developer Console, invocations grouped by Source) while
        // Mixpanel recorded 65 `macro_export_requested` for the same day. The
        // the UUID below is what separates those collapsed events.
        //
        // ANALYSIS BREAK: counts before and after this ships are not comparable.
        // A rise in export volume on the changeover date is this fix landing,
        // not a change in user behaviour.
        $insert_id: crypto.randomUUID(),
        source: 'forge_export',
        ...properties,
      },
    }]);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch('https://api.mixpanel.com/import?strict=1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${btoa(`${token}:`)}`,
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        console.warn(`Export: Mixpanel import failed (${response.status}): ${text}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    console.warn('Export: analytics tracking error:', e?.message);
  }
}

/**
 * Spreads fallback telemetry into an event's properties. Returns {} when the
 * fallback path wasn't taken so we don't bloat every export event.
 */
function fallbackProps(info) {
  if (!info) return {};
  const out = { used_asuser_fallback: true };
  if (info.status !== null) out.fallback_http_status = info.status;
  if (info.error_name !== null) out.fallback_error_name = info.error_name;
  return out;
}

/**
 * Reads custom content at most ONCE per export, and only when a caller on a
 * failure path actually needs it. Memoised on `ctx`, so repeated failure
 * telemetry reads share the single request.
 *
 * Also sets `ctx.macroType`, which is why a failure event carries the real type
 * while `macro_export_requested` / `macro_export_succeeded` carry `'none'` —
 * the success path deliberately never reads (see the handler comment).
 */
async function ensureCustomContentParsed(ctx) {
  if (ctx.customContentParsed === undefined) {
    ctx.customContentParsed = await fetchCustomContentParsed(ctx.customContentId);
    ctx.macroType = macroTypeFromParsed(ctx.customContentParsed);
  }
  return ctx.customContentParsed;
}

// ---------------------------------------------------------------------------
// Export handler
// ---------------------------------------------------------------------------

export const handler = async (payload) => {
  const ctx = extractExportContext(payload);
  const { pageId, customContentId, attachmentName } = ctx;

  // NO custom-content read on the success path. Measured on Lite production
  // 2026-08-16: `exportMacro` runs 12,407 times/day, 40.3% of ALL Forge
  // function invocations for the app — far more than the ~185/day of
  // `macro_export_requested` Mixpanel records, for reasons not yet established.
  // Reading custom content eagerly therefore added an HTTP round-trip to 40% of
  // invocations, against a month-end compute projection already at ~94% of the
  // free allowance.
  //
  // The read is now deferred to the paths that genuinely need it — the failure
  // events and the PlantUML server render, both of which already sit behind a
  // failed attachment lookup. `ensureCustomContentParsed` memoises it on `ctx`,
  // so those paths still make exactly one read between them.
  //
  // Consequence, accepted deliberately: `macro_export_requested` and
  // `macro_export_succeeded` carry `macro_type: 'none'`. Analysis gets the
  // COMPOSITION of failures by type, not a per-type failure RATE — the
  // denominator is gone. #434's sizing needs the composition, which survives.
  await trackExportEvent('macro_export_requested', joinKeyProps(ctx));

  try {
    if (!customContentId) {
      console.warn(`Export: no customContentId, page ${pageId}`);
      await trackExportEvent('macro_export_failed', {
        ...joinKeyProps(ctx),
        failure_reason: 'missing_custom_content_id',
      });
      return createErrorDocument("Diagram content not available for export");
    }

    let response = await api.asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/attachments?filename=${attachmentName}`);

    // asApp() returns 404 for pages the app principal can't read (space restrictions, page restrictions).
    // Fall back to asUser(), which has the exporting user's permissions. Keep the original 404 if asUser
    // also fails so analytics still records `attachments_api_404` with the right failure_reason.
    //
    // The fallback path is the new failure mode introduced by switching to asApp() (issue #74) —
    // track usage so we can measure how often it triggers and whether it succeeds.
    let fallbackInfo = null;
    if (!response.ok && response.status === 404) {
      fallbackInfo = { used: true, status: null, error_name: null };
      try {
        const userResponse = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}/attachments?filename=${attachmentName}`);
        fallbackInfo.status = userResponse.status;
        if (userResponse.ok) {
          response = userResponse;
        }
      } catch (e) {
        fallbackInfo.error_name = e?.name ?? 'UnknownError';
        console.warn(`Export: asUser() fallback threw for ${attachmentName} on page ${pageId}: ${e?.message}`);
      }
    }

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Export: attachments API ${response.status} for ${attachmentName} on page ${pageId}`, errorBody);
      const failureReason = response.status === 401 || response.status === 403
        ? 'needs_authentication'
        : `attachments_api_${response.status}`;
      // Failure path — resolve the type here so this event is sizeable by
      // diagram type. The success path never reaches this and never reads.
      await ensureCustomContentParsed(ctx);
      await trackExportEvent('macro_export_failed', {
        ...joinKeyProps(ctx),
        failure_reason: failureReason,
        http_status: response.status,
        ...fallbackProps(fallbackInfo),
      });
      return createErrorDocument(`Failed to fetch attachments: ${response.status}`);
    }

    const attachmentsData = await response.json();

    if (!attachmentsData?.results?.length) {
      console.debug(`Export: ${attachmentName} not found on page ${pageId}`);

      // Failure telemetry still needs the real diagram type. The removed
      // PlantUML server-render fallback used to trigger this lazy read as a
      // side effect; keep the diagnostic behavior without the external fetch.
      await ensureCustomContentParsed(ctx);
      await trackExportEvent('macro_export_failed', {
        ...joinKeyProps(ctx),
        failure_reason: 'attachment_not_found',
        ...fallbackProps(fallbackInfo),
      });
      return createErrorDocument("Diagram image not yet generated. Please open the Confluence page containing this diagram to generate it, then export again.");
    }

    const attachment = attachmentsData.results[0];

    // The export ADF must reference the PNG as a native Confluence media file,
    // never as an external URL — see createMediaDocument below. Without a
    // fileId there is nothing to reference, so surface it instead of degrading.
    if (!attachment.fileId) {
      console.error(`Export: attachment ${attachmentName} on page ${pageId} carries no fileId`);
      await trackExportEvent('macro_export_failed', {
        ...joinKeyProps(ctx),
        failure_reason: 'missing_file_id',
        ...fallbackProps(fallbackInfo),
      });
      return createErrorDocument('Diagram image reference not available for export');
    }

    console.info(`Export: found ${attachmentName} on page ${pageId}`);

    await trackExportEvent('macro_export_succeeded', {
      ...joinKeyProps(ctx),
      ...fallbackProps(fallbackInfo),
    });

    return createMediaDocument(attachment.fileId, pageId);

  } catch (error) {
    const errorName = error?.name ?? 'UnknownError';
    const errorMessage = String(error?.message ?? error ?? '').slice(0, 200);
    const errorStatus = error?.status;
    const isKnownError = errorName === 'NEEDS_AUTHENTICATION_ERR';
    const failureReason = isKnownError ? 'needs_authentication' : `unexpected_error:${errorName}`;
    const errorStack = !isKnownError
      ? String(error?.stack ?? '').slice(0, 500)
      : undefined;
    console.error('Export function error:', error);
    await trackExportEvent('macro_export_failed', {
      ...joinKeyProps(ctx),
      failure_reason: failureReason,
      error_name: errorName,
      error_message: errorMessage,
      error_stack: errorStack,
      http_status: errorStatus,
    });
    return createErrorDocument("Error generating export content");
  }
};

// ---------------------------------------------------------------------------
// ADF helpers
// ---------------------------------------------------------------------------

export function createErrorDocument(message) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: message
          }
        ]
      }
    ]
  };
}

/**
 * Builds the export document as a native Confluence media reference.
 *
 * A media node of type "external" pointing at the attachment download endpoint
 * needs a Confluence session. Confluence's own export pipeline has one; a
 * third-party exporter running outside the page context does not, so it
 * received 404 and dropped the image. Reproduced with Scroll PDF Exporter on
 * 2026-08-19 — see docs/debugging/scroll-pdf-export.md for the issue report.
 *
 * A file media node carries only the fileId and the page's media collection.
 * Every renderer resolves it with its own credentials, so the diagram keeps the
 * access control the page already has and no URL is published.
 */
function createMediaDocument(fileId, pageId) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        "type": "mediaSingle",
        "attrs": {
          "layout": "center"
        },
        "content": [
          {
            "type": "media",
            "attrs": {
              "type": "file",
              "id": fileId,
              "collection": `contentId-${pageId}`
            }
          }
        ]
      }
    ]
  };
}
