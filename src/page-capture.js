import api, { route } from '@forge/api';

const BACKEND_URL = process.env.BACKEND_API_BASE_URL;
const PAGE_CAPTURE_SECRET = process.env.PAGE_CAPTURE_SECRET;

/**
 * Forge function trigger handler for avi:confluence:updated:page.
 *
 * Fetches the full page body (body.storage) via requestConfluence and forwards
 * the enriched snapshot to the Cloudflare Worker endpoint /forge-page-capture.
 *
 * Auth: X-Page-Capture-Token shared secret (invokeRemote does not work in
 * trigger function context — api.fetch() is the correct pattern here).
 *
 * @param {object} event  - Forge trigger event (contains content, eventType, …)
 * @param {object} context - Forge invocation context (contains cloudId, siteUrl, …)
 */
export const handler = async (event, context) => {
  // Kill switch: set Forge variable PAGE_CAPTURE_ENABLED=false (per app, per env)
  // to short-circuit before the requestConfluence call when the Forge function
  // quota is under pressure. Default (unset / any other value) leaves capture on.
  if (process.env.PAGE_CAPTURE_ENABLED === 'false') {
    return;
  }

  const content = event?.content;
  const cloudId =
    event?.cloudId ??
    context?.cloudId ??
    context?.installation?.contexts?.[0]?.cloudId ??
    context?.installContext?.split('/').pop() ??
    null;
  if (!content?.id) {
    console.warn('page-capture: no content.id in payload, skipping');
    return;
  }

  if (content.type !== 'page' || content.subType === 'live') {
    return;
  }

  if (!BACKEND_URL || !PAGE_CAPTURE_SECRET) {
    console.error('page-capture: BACKEND_API_BASE_URL or PAGE_CAPTURE_SECRET not configured');
    return;
  }

  const versionNumber = content.version?.number;
  if (!versionNumber) {
    console.warn(`page-capture: no version.number for content ${content.id}, skipping`);
    return;
  }

  let pageBody = null;
  try {
    const response = await api.asApp().requestConfluence(
      route`/wiki/api/v2/pages/${content.id}?body-format=storage`,
    );

    if (!response.ok) {
      console.error(`page-capture: Confluence API ${response.status} for content ${content.id}`);
      return;
    }

    const pageData = await response.json();
    pageBody = pageData.body?.storage ?? null;
  } catch (err) {
    console.error(`page-capture: error fetching page body for ${content.id}:`, err);
    return;
  }

  const capturePayload = {
    cloudId,
    contentId: content.id,
    contentTitle: content.title ?? null,
    contentType: content.type,
    versionNumber,
    versionWhen: content.version?.when ?? null,
    versionBy: content.version?.by?.accountId ?? null,
    spaceKey: content.space?.key ?? null,
    spaceName: content.space?.name ?? null,
    capturedAt: new Date().toISOString(),
    body: pageBody,
  };

  try {
    const res = await api.fetch(`${BACKEND_URL}/forge-page-capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Page-Capture-Token': PAGE_CAPTURE_SECRET,
      },
      body: JSON.stringify(capturePayload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`page-capture: Worker returned ${res.status}: ${text}`);
    }
  } catch (err) {
    console.error('page-capture: error forwarding to Worker:', err);
  }
};
