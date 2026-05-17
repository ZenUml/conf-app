
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
function extractExportContext(payload) {
  const format = payload.exportType ?? (payload.context?.content?.id || payload.context?.contentId ? 'word' : 'pdf');

  const cloudId = payload.context?.cloudId ?? 'unknown';

  const siteUrl = payload.context?.siteUrl;
  let clientDomain = cloudId;
  if (siteUrl) {
    try { clientDomain = new URL(siteUrl).hostname; } catch (_) { clientDomain = siteUrl; }
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
function joinKeyProps(ctx) {
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
async function trackExportEvent(eventName, properties) {
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

      // AsyncAPI specs are text — the viewer doesn't generate a PNG
      // attachment, so the standard image-export path always misses. Fall
      // back to embedding the raw spec as a code block. Ported from
      // AsyncAPI-Conf-V2/src/backend/export.js (buildSpecDocument).
      const specDoc = await buildAsyncApiSpecFallback(customContentId);
      if (specDoc) {
        await trackExportEvent('macro_export_succeeded', {
          ...joinKeyProps(ctx),
          export_path: 'asyncapi_spec_fallback',
          ...fallbackProps(fallbackInfo),
        });
        return specDoc;
      }

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

function createErrorDocument(message) {
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

// AsyncAPI fallback: when no rendered PNG attachment exists, embed the raw
// spec as a code block. Only triggers for AsyncAPI custom content; other
// macros keep the existing "image not yet generated" error path.
async function buildAsyncApiSpecFallback(customContentId) {
  try {
    const response = await api
      .asApp()
      .requestConfluence(route`/wiki/api/v2/custom-content/${customContentId}?body-format=raw`);
    if (!response.ok) {
      console.debug(`Export AsyncAPI fallback: custom-content lookup ${response.status}`);
      return null;
    }
    const customContent = await response.json();
    const rawValue = customContent?.body?.raw?.value;
    if (!rawValue) return null;

    let parsed;
    try {
      parsed = JSON.parse(rawValue);
    } catch (e) {
      console.debug('Export AsyncAPI fallback: custom-content body is not JSON', e?.message);
      return null;
    }

    // Only fall back for AsyncAPI; let other diagram types keep the
    // "image not yet generated" error so users know to re-render.
    if (parsed?.diagramType !== 'AsyncAPI') return null;

    const spec = parsed?.code;
    if (typeof spec !== 'string' || spec.trim().length === 0) return null;

    const title = parsed?.title || customContent?.title || 'AsyncAPI Specification';
    const MAX = 40000;
    const text = spec.length > MAX ? `${spec.slice(0, MAX)}\n\n# (truncated for export)` : spec;

    return {
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: title, marks: [{ type: 'strong' }] }] },
        { type: 'codeBlock', attrs: { language: 'yaml' }, content: [{ type: 'text', text }] },
      ],
    };
  } catch (e) {
    console.warn('Export AsyncAPI fallback failed:', e?.message);
    return null;
  }
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
