
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
export async function resolveMacroType(customContentId) {
  if (!customContentId) return 'none';
  try {
    const response = await api
      .asApp()
      .requestConfluence(route`/wiki/api/v2/custom-content/${customContentId}?body-format=raw`);
    if (!response.ok) return 'none';
    const customContent = await response.json();
    const rawValue = customContent?.body?.raw?.value;
    if (!rawValue) return 'none';
    const parsed = JSON.parse(rawValue);
    return DIAGRAM_TYPE_TO_MACRO_TYPE[parsed?.diagramType] ?? 'none';
  } catch (e) {
    console.warn('Export: macro_type lookup failed:', e?.message);
    return 'none';
  }
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
        $insert_id: `${eventName}_${properties.cloud_id ?? ''}_${Date.now()}`,
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

// ---------------------------------------------------------------------------
// PlantUML server-side render fallback (issue #434, ADR-0004 slice 1)
//
// 79.2% of macro_export_failed/attachment_not_found events are macros that
// were never opened in a browser, so the backup PNG attachment never existed
// and never can — a browser is the only thing that has ever produced it.
// PlantUML is the one type with a proven, dependency-light, DOM-free render
// path: src/model/Attachment.ts:fetchPlantUmlPng already fetches a ready
// raster straight from the public PlantUML server. This ports that same
// logic into the Forge function so export.js can self-serve when the
// attachment lookup comes back empty, instead of failing outright.
// ---------------------------------------------------------------------------

const PLANTUML_PNG_SERVER = 'https://www.plantuml.com/plantuml/png/';

/**
 * Fetches the custom content's raw JSON body and returns { diagramType,
 * plantUmlCode }, or null on any lookup/parse failure. Read-only, mirrors the
 * pattern already used by src/asyncapi-export.js's buildAsyncApiSpecDocument.
 */
async function fetchCustomContentDiagramData(customContentId) {
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
    const parsed = JSON.parse(rawValue);
    return { diagramType: parsed?.diagramType, plantUmlCode: parsed?.plantUmlCode };
  } catch (e) {
    console.warn(`Export: custom-content lookup failed for ${customContentId}:`, e?.message);
    return null;
  }
}

/**
 * On an empty attachment lookup, attempts a server-side PlantUML render.
 * Returns the media ADF doc on success, or null when this macro isn't
 * PlantUML or the server render itself fails — in which case the caller
 * falls through to today's unchanged attachment_not_found path. A server
 * fetch failure always records its own macro_export_failed event first
 * (failure_reason: 'plantuml_server_render_failed') — this feature exists
 * because failures were invisible, so this path must never fail silently.
 */
async function tryPlantUmlServerRender(ctx) {
  const diagramData = await fetchCustomContentDiagramData(ctx.customContentId);
  if (!diagramData || diagramData.diagramType !== 'plantuml') return null;

  const code = diagramData.plantUmlCode;
  if (typeof code !== 'string' || code.trim().length === 0) return null;

  const { plantumlEncode } = await import('./utils/plantuml/encode');
  const pngUrl = `${PLANTUML_PNG_SERVER}${plantumlEncode(code)}`;

  try {
    const resp = await fetch(pngUrl);
    if (!resp.ok) {
      console.warn(`Export: PlantUML server render failed (${resp.status}) for ${ctx.customContentId}`);
      await trackExportEvent('macro_export_failed', {
        ...joinKeyProps(ctx),
        failure_reason: 'plantuml_server_render_failed',
        plantuml_server_http_status: resp.status,
      });
      return null;
    }
    const blob = await resp.blob();
    const contentType = (blob.type || '').toLowerCase().split(';')[0].trim();
    if (contentType !== 'image/png') {
      console.warn(`Export: PlantUML server returned non-PNG content-type "${contentType}" for ${ctx.customContentId}`);
      await trackExportEvent('macro_export_failed', {
        ...joinKeyProps(ctx),
        failure_reason: 'plantuml_server_render_failed',
        plantuml_server_content_type: contentType,
      });
      return null;
    }
  } catch (e) {
    console.warn(`Export: PlantUML server render threw for ${ctx.customContentId}:`, e?.message);
    await trackExportEvent('macro_export_failed', {
      ...joinKeyProps(ctx),
      failure_reason: 'plantuml_server_render_failed',
      error_name: e?.name ?? 'UnknownError',
      error_message: String(e?.message ?? e ?? '').slice(0, 200),
    });
    return null;
  }

  console.info(`Export: server-rendered PlantUML PNG for ${ctx.customContentId}`);
  await trackExportEvent('macro_export_succeeded', {
    ...joinKeyProps(ctx),
    render_source: 'server_render_plantuml',
  });
  return createMediaDocument(pngUrl);
}

// ---------------------------------------------------------------------------
// Export handler
// ---------------------------------------------------------------------------

export const handler = async (payload) => {
  const ctx = extractExportContext(payload);
  const { pageId, customContentId, attachmentName } = ctx;

  // Resolved before the first event so macro_export_requested — not just the
  // terminal succeeded/failed events — carries macro_type (#435).
  ctx.macroType = await resolveMacroType(customContentId);

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

      // issue #434 slice 1: no attachment exists (79.2% of these are macros
      // never opened in a browser, so one never will). PlantUML is the one
      // type with a DOM-free server render — try it before failing.
      const plantUmlRender = await tryPlantUmlServerRender(ctx);
      if (plantUmlRender) return plantUmlRender;

      await trackExportEvent('macro_export_failed', {
        ...joinKeyProps(ctx),
        failure_reason: 'attachment_not_found',
        ...fallbackProps(fallbackInfo),
      });
      return createErrorDocument("Diagram image not yet generated. Please open the Confluence page containing this diagram to generate it, then export again.");
    }

    const attachment = attachmentsData.results[0];
    const downloadLink = `${attachmentsData._links.base}${attachment.downloadLink}`;

    console.info(`Export: found ${attachmentName} on page ${pageId}`);

    await trackExportEvent('macro_export_succeeded', {
      ...joinKeyProps(ctx),
      ...fallbackProps(fallbackInfo),
    });

    return createMediaDocument(downloadLink);

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

function createMediaDocument(downloadLink) {
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
              "type": "external",
              "url": downloadLink
            }
          }
        ]
      }
    ]
  };
}
