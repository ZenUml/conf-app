
import api, { route, routeFromAbsolute } from '@forge/api';
import { readPngDimensions } from './lib/pngDimensions.js';
import { decideExportSample } from './lib/exportSampling.js';

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

// ---------------------------------------------------------------------------
// TEMPORARY DIAGNOSTIC (#554) — identify what triggers `exportType: 'other'`.
//
// Measured on production 2026-08-19..25: `other` is 87,608 of 93,786 adfExport
// invocations and 46,417 of 47,878 export failures. Atlassian documents
// `exportType` only as `pdf`, `word` or `other`, with `other` as the catch-all,
// and the Developer Console groups invocations by our own function name, so
// nothing we hold today names the caller. Several tenants fire this on a fixed
// schedule (one alternates 20/10 invocations every hour around the clock;
// another fires ~3,100 inside a single hour each day), and two accounts swept
// 262 and 257 distinct spaces in a week — the shape of a scheduled export tool.
//
// Delete this block, `redactPayloadShape`, and its call site once #554 names
// the trigger.
// ---------------------------------------------------------------------------

/** Sample rate for the #554 payload-shape log. 1% of ~12,500 invocations/day. */
const OTHER_EXPORT_SHAPE_SAMPLE_RATE = 0.01;

/**
 * Keys whose values can carry page or diagram content rather than structure.
 * Their subtrees are reduced to key names only, so the diagnostic never copies
 * customer content into the app log.
 */
const SHAPE_LOG_CONTENT_KEYS = new Set([
  'parameters', 'body', 'value', 'title', 'text', 'content', 'macroParams',
]);

/**
 * Reduces a payload to a shape-only view for diagnostic logging: object keys
 * survive, long strings collapse to `String(<length>)`, arrays report their
 * length and first entries, and recursion stops at depth 4. Short strings are
 * kept because the identifying signal we are looking for is one — an app key,
 * a module key, or an enum value.
 */
export function redactPayloadShape(value, depth = 0, key = '') {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > 80 ? `String(${value.length})` : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    if (depth >= 4) return `Array(${value.length})`;
    return { _len: value.length, _sample: value.slice(0, 2).map((v) => redactPayloadShape(v, depth + 1)) };
  }
  const entries = Object.entries(value);
  if (depth >= 4) return `Object(${entries.length})`;
  if (SHAPE_LOG_CONTENT_KEYS.has(key)) return { _keys: entries.map(([k]) => k) };
  return Object.fromEntries(entries.map(([k, v]) => [k, redactPayloadShape(v, depth + 1, k)]));
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
  // Quota sampling (src/lib/exportSampling.js). Null means "drop this one";
  // otherwise the returned props carry the `sample_rate` stamp that lets a
  // count be extrapolated as `count / sample_rate`.
  const sampleProps = decideExportSample(eventName);
  if (sampleProps === null) return;
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
        ...sampleProps,
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

/**
 * Reads the export PNG's own pixel width/height without downloading the
 * whole file: a byte-Range request for the first 32 bytes is enough to cover
 * the PNG signature + IHDR chunk (see src/lib/pngDimensions.js). If the
 * Confluence attachment endpoint ignores the Range header it just returns the
 * full file — readPngDimensions only reads the leading bytes it needs either
 * way, so correctness doesn't depend on Range support, only bandwidth does.
 *
 * Never throws: a failure here must not fail the whole export (the diagram
 * still exports, just without a declared intrinsic size — the pre-existing
 * mediaSingle-only-width behavior). Logged with console.error and surfaced
 * via the `media_width_px`/`media_height_px: null` telemetry on the success
 * event, so the degrade stays visible rather than silently masked.
 *
 * `usedAsUser` picks the SAME identity that resolved the attachments lookup
 * (asApp() vs the asUser() 404-fallback, see the handler) — a page asApp()
 * can't read is a page it likely can't download from either, so this avoids
 * a doomed second asApp() call on the fallback path.
 */
async function fetchPngDimensions(linksBase, downloadLink, attachmentName, pageId, usedAsUser) {
  const downloadUrl = `${linksBase}${downloadLink}`;
  try {
    const requester = usedAsUser ? api.asUser() : api.asApp();
    // requestConfluence rejects a plain string URL at runtime — @forge/api
    // requires a Route built from the `route` tagged template, or (as here,
    // where the full absolute URL is already known from `_links.base` +
    // `downloadLink`) `routeFromAbsolute`, which strips it down to the
    // pathname+search a Route carries. See the ReadonlyRoute brand check in
    // @forge/api's safeUrl.js — a bare string throws
    // "You must create your route using the 'route' export from
    // '@forge/api'", which is exactly the production error this fixes.
    const response = await requester.requestConfluence(routeFromAbsolute(downloadUrl), {
      headers: { Range: 'bytes=0-31' },
    });
    if (!response.ok) {
      throw new Error(`png_header_fetch_failed_${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return readPngDimensions(buffer);
  } catch (error) {
    console.error(`Export: failed to read PNG dimensions for ${attachmentName} on page ${pageId}:`, error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Export handler
// ---------------------------------------------------------------------------

export const handler = async (payload) => {
  const ctx = extractExportContext(payload);
  const { pageId, customContentId, attachmentName } = ctx;

  // #554 diagnostic — see redactPayloadShape above. Sampled, shape only.
  if (ctx.format === 'other' && Math.random() < OTHER_EXPORT_SHAPE_SAMPLE_RATE) {
    console.log(`Export #554: exportType=other payload shape ${JSON.stringify(redactPayloadShape(payload))}`);
  }

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
      return createErrorDocument("Diagram content not available for export. The diagram may need to be re-inserted on the page.");
    }

    let response = await api.asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/attachments?filename=${attachmentName}`);

    // asApp() returns 404 for pages the app principal can't read (space restrictions, page restrictions).
    // Fall back to asUser(), which has the exporting user's permissions. Keep the original 404 if asUser
    // also fails so analytics still records `attachments_api_404` with the right failure_reason.
    //
    // The fallback path is the new failure mode introduced by switching to asApp() (issue #74) —
    // track usage so we can measure how often it triggers and whether it succeeds.
    let fallbackInfo = null;
    let usedAsUser = false;
    if (!response.ok && response.status === 404) {
      fallbackInfo = { used: true, status: null, error_name: null };
      try {
        const userResponse = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}/attachments?filename=${attachmentName}`);
        fallbackInfo.status = userResponse.status;
        if (userResponse.ok) {
          response = userResponse;
          usedAsUser = true;
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
      const userMessage = (response.status === 401 || response.status === 403)
        ? "Couldn't access the diagram image (permission denied). Sign in to Confluence with an account that has access to this page, then try again."
        : `Couldn't fetch the diagram image (HTTP ${response.status}). Please try the export again, or contact support if this keeps happening.`;
      return createErrorDocument(userMessage);
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
      // 94% of macro_export_failed events hit this branch (3-day Mixpanel slice
       // post-v2026.05.240313 release). The diagram image is saved as a page
       // attachment by the macro viewer running in the *viewing user's*
       // browser, with that user's Confluence credentials — so pages only ever
       // viewed by users without attachment-write permission accumulate
       // diagrams that render fine on screen but can never be exported.
       // The prior message ("Please open the Confluence page…to generate it,
       // then export again") was misleading: the page HAS typically been
       // opened, but the upload silently failed. Tell the user what would
       // actually help — a page editor needs to open the page so the
       // diagram image can be saved with sufficient permissions.
      return createErrorDocument(
        "Diagram image not available for export. " +
        "To save it for export, a user with edit access to this page needs " +
        "to open it in Confluence — then try the export again."
      );
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

    // The file media node is sized from the media file's own metadata, not
    // from mediaSingle's width/widthType hint — measured on lite-stg
    // 2026-08-19: with no width attrs the placed image was 1.77in; with a
    // mediaSingle width hint (either percentage or an equal-valued pixel
    // count) it was 5.38in, never the 6.68in the previous `type: "external"`
    // node produced for the same page. Declaring the image's own intrinsic
    // width/height directly on the media node (not just on mediaSingle) is
    // the ADF-documented way to give a file node a natural size; see
    // fetchPngDimensions below for how those pixels are read without a full
    // download.
    const dimensions = await fetchPngDimensions(attachmentsData._links.base, attachment.downloadLink, attachmentName, pageId, usedAsUser);

    await trackExportEvent('macro_export_succeeded', {
      ...joinKeyProps(ctx),
      ...fallbackProps(fallbackInfo),
      media_width_px: dimensions?.width ?? null,
      media_height_px: dimensions?.height ?? null,
    });

    return createMediaDocument(attachment.fileId, pageId, dimensions);

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
 *
 * `dimensions` is the export PNG's own {width, height} in px (fetchPngDimensions),
 * or null if that read failed. When known, it is declared BOTH on the media
 * node (its documented "intrinsic size" attrs) and on mediaSingle (the width
 * hint alone was measured insufficient — see the call site's comment) —
 * candidate fix for the placement-width regression tracked in this PR; not
 * yet confirmed against a real PDF export, see the PR body for the
 * pdfimages -list measurement.
 *
 * Falls back to the pre-existing mediaSingle-only 760px hint when dimensions
 * are unknown, matching the behavior this replaces.
 */
function createMediaDocument(fileId, pageId, dimensions) {
  const mediaAttrs = {
    "type": "file",
    "id": fileId,
    "collection": `contentId-${pageId}`,
  };
  const mediaSingleAttrs = { "layout": "center" };

  if (dimensions) {
    mediaAttrs.width = dimensions.width;
    mediaAttrs.height = dimensions.height;
    mediaSingleAttrs.width = dimensions.width;
    mediaSingleAttrs.widthType = "pixel";
  } else {
    mediaSingleAttrs.width = 760;
    mediaSingleAttrs.widthType = "pixel";
  }

  return {
    type: "doc",
    version: 1,
    content: [
      {
        "type": "mediaSingle",
        "attrs": mediaSingleAttrs,
        "content": [
          {
            "type": "media",
            "attrs": mediaAttrs
          }
        ]
      }
    ]
  };
}
