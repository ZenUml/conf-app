
import api, { route } from '@forge/api';

// PlantUML's public server renders straight to a raster from an encoded source,
// so it needs no DOM — which is what makes it the one diagram type this Forge
// function (nodejs22.x, no browser) can render on its own. Same server the
// browser path already uses (model/Attachment.ts), so the source is not newly
// disclosed to a third party by doing it here.
const PLANTUML_PNG_SERVER = 'https://www.plantuml.com/plantuml/png/';

/**
 * Load the macro's diagram from custom content — the system of record, always
 * present (it is what the macro renders from), and readable with app auth.
 *
 * The backup PNG is only ever produced by a *browser* rendering the macro, so
 * for a macro nobody has opened it has never existed. Custom content is the
 * only artifact that is guaranteed to be there, which is why the empty
 * attachment path reads from it rather than from any browser-written artifact
 * (the diagram-source snapshots are written on the same browser paths as the
 * PNG, so they are absent for exactly the same macros). See #434 / #73.
 *
 * Never throws: this runs on a path that already has a working error document,
 * and a diagnostic read must not turn a handled failure into an exception.
 */
async function fetchDiagramSource(customContentId) {
  try {
    const res = await api.asApp().requestConfluence(
      route`/wiki/api/v2/custom-content/${customContentId}?body-format=raw`,
    );
    if (!res.ok) return undefined;
    const body = await res.json();
    // A v2 404 comes back as { errors: [...] } with no body.raw.value rather
    // than a non-ok status — the same shape ApWrapper2 guards against.
    const raw = body?.body?.raw?.value;
    if (!raw || body?.errors) return undefined;
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`Export: custom content read failed for ${customContentId}: ${e?.message}`);
    return undefined;
  }
}

// The browser path encodes with deflate + PlantUML's base64 variant, which
// needs `pako`. Importing that here fails the build outright: the Forge CLI
// type-checks the whole function module graph and pako ships no declarations
// (TS7016) — and it would drag a compression library into the FaaS bundle for
// one URL. PlantUML's `~h` prefix takes plain hex instead, verified against
// the live server, so this stays dependency-free.
//
// Hex is ~2x the source rather than compressed, so a very large diagram would
// produce a URL no server will accept. MAX_PLANTUML_SOURCE keeps that a clean
// "cannot render" rather than a mystery 414; the render probe would catch it
// regardless.
const MAX_PLANTUML_SOURCE = 3000;

function plantumlHexEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * Build a PlantUML render URL for a diagram, or undefined when this diagram
 * isn't PlantUML, carries no source, or is too large to express as a URL.
 */
export function plantUmlRenderUrl(diagram) {
  if (diagram?.diagramType !== 'plantuml') return undefined;
  const code = diagram?.plantUmlCode;
  if (!code || code.length > MAX_PLANTUML_SOURCE) return undefined;
  return `${PLANTUML_PNG_SERVER}~h${plantumlHexEncode(code)}`;
}

/**
 * Confirm the render URL actually yields a PNG before handing it to the
 * exporter.
 *
 * The ADF references images by URL (`type: "external"`), so a URL that 404s or
 * returns an error page would put a broken image in the user's PDF — strictly
 * worse than the current explanatory message. Fetching it here costs one
 * request and turns that regression into the existing, handled failure path.
 */
async function renderUrlIsLive(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return false;
    const type = resp.headers?.get?.('content-type') ?? '';
    return type.includes('image');
  } catch (e) {
    console.warn(`Export: PlantUML render probe failed: ${e?.message}`);
    return false;
  }
}

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

  return { format, cloudId, clientDomain, spaceKey, accountId, pageId, customContentId, attachmentName };
}

/**
 * Common join-key fields included on every export tracking event so we can
 * left-join to the frontend `attachment_upload_*` events on
 * (cloud_id, custom_content_id, page_id).
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
// Export handler
// ---------------------------------------------------------------------------

export const handler = async (payload) => {
  const ctx = extractExportContext(payload);
  const { pageId, customContentId, attachmentName } = ctx;

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

      // No attachment means no browser has ever rendered this macro (~79% of
      // these failures — #434). Fall back to the diagram source and render it
      // here where we can. Reading it also gives us `macro_type`, which these
      // events have never carried, so the failing population can finally be
      // sized per diagram type (#435) — and it cannot be recovered by joining
      // `macro_viewed`, because these macros have no view events either.
      const diagram = await fetchDiagramSource(customContentId);
      const macroType = diagram?.diagramType;

      const renderUrl = plantUmlRenderUrl(diagram);
      if (renderUrl && await renderUrlIsLive(renderUrl)) {
        console.info(`Export: server-rendered PlantUML for ${customContentId} (no attachment)`);
        await trackExportEvent('macro_export_succeeded', {
          ...joinKeyProps(ctx),
          macro_type: macroType,
          render_source: 'server_plantuml',
          ...fallbackProps(fallbackInfo),
        });
        return createMediaDocument(renderUrl);
      }

      await trackExportEvent('macro_export_failed', {
        ...joinKeyProps(ctx),
        failure_reason: 'attachment_not_found',
        macro_type: macroType,
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
