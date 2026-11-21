import { trackEvent, serializeError } from "@/utils/window";
import { getClientDomain } from "@/utils/ContextParameters/ContextParameters";
import forgeGlobal from "@/model/globals/forgeGlobal";

// Wait before the single retry of a request that never reached the server.
const RETRY_DELAY_MS = 750;
const MAX_ATTEMPTS = 2;

// Bounded, tenant-free description of why the client domain came out empty:
// was the Forge context there, and does the site host look like *.atlassian.net
// (the only shape getClientDomain parses)?
function describeContext(): { context_resolved: boolean; site_host_kind: 'atlassian_net' | 'other' | 'none' } {
  const ctx = (forgeGlobal as any).forgeContext;
  const location = ctx?.siteUrl || ctx?.extension?.location;
  let kind: 'atlassian_net' | 'other' | 'none' = 'none';
  if (location) {
    try {
      kind = new URL(location).hostname.toLowerCase().endsWith('.atlassian.net') ? 'atlassian_net' : 'other';
    } catch {
      kind = 'other';
    }
  }
  return { context_resolved: !!ctx, site_host_kind: kind };
}

// A fetch that fails because the page is going away (navigation, tab close,
// iframe teardown) rejects with the same TypeError as a real network drop.
// It is not a failure of the lookup, so it is not reported.
function pageIsLeaving(): boolean {
  try {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default async function (features: string[]) {
  const client = getClientDomain();
  const featuresParam = features.join(",");

  if (!client) {
    trackEvent('empty_client_domain', 'get_feature_flags', 'error', describeContext());
    return {};
  }

  const baseUrl = forgeGlobal.zenumlRemoteBaseUrl;
  const url = `${baseUrl}/feature-flags?client=${client}&features=${featuresParam}`;

  let attempts = 0;
  try {
    for (;;) {
      attempts++;
      try {
        const response = await fetch(url);

        if (!response.ok) {
          // The server answered: retrying will not change a 4xx/5xx decision.
          console.error("HTTP Error:", response.status, response.statusText);
          trackEvent(response.statusText, 'get_feature_flags', 'error', {
            error_kind: 'http',
            http_status: response.status,
            attempts,
          });
          return {};
        }

        const data = await response.json();
        console.debug("featureFlags", client, features, data);
        return data;
      } catch (error) {
        // fetch rejects with a TypeError when the request never completed.
        // Retry once unless the page is already going away.
        if (attempts < MAX_ATTEMPTS && error instanceof TypeError && !pageIsLeaving()) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    console.error("Fetching feature flags failed:", error);
    if (!pageIsLeaving()) {
      trackEvent(serializeError(error), 'get_feature_flags', 'error', {
        error_kind: error instanceof TypeError ? 'network' : 'other',
        attempts,
      });
    }
    return {};
  }
}
