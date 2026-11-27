// https://developer.atlassian.com/cloud/confluence/context-parameters/
import { toAtlassianClientDomain } from '@/lib/clientDomain.js';
import forgeGlobal from '@/model/globals/forgeGlobal';

export function getClientDomain() {
  // Dev sandbox fallback — `xdm_e` and `initialContext.currentPageUrl` are
  // never set when running in the standalone local sandbox, so the upgrade URL
  // would otherwise read `?domain=` with an empty value. Allow tests / the
  // sandbox to inject a domain via localStorage.
  try {
    const mocked = window.localStorage?.getItem('mockClientDomain');
    if (mocked) return mocked;
  } catch {
    // localStorage may be unavailable (private browsing, restrictive iframe);
    // fall through to the production resolution path.
  }
  return getSubdomain(getBaseUrl());
}

export function getBaseUrl() {
  const location = forgeGlobal.forgeContext?.siteUrl || forgeGlobal.forgeContext?.extension?.location;
  if (!location) {
    return '';
  }

  try {
    return new URL(location).origin.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * What `getSpaceKey` returns when no source supplied one. It is a SENTINEL, not
 * an empty value — analytics wants a bucket rather than a missing property — so
 * `getSpaceKey() || fallback` never fires and any caller interpolating the
 * result into a URL builds `/wiki/spaces/no_space_context/...`. Callers that
 * need a real key must compare against this.
 */
export const NO_SPACE_CONTEXT = 'no_space_context';

const PAGE_BANNER_EXTENSION_TYPE = 'confluence:pageBanner';
const PAGE_LOCATION_PATH =
  /^\/wiki\/spaces\/([^/]+)\/(?:overview\/?$|pages\/(\d+)(?:\/|$)|blog\/\d{4}\/\d{2}\/\d{2}\/(\d+)(?:\/|$))/;

/**
 * The space key the page's own URL names, or null when the URL has no trusted
 * shape. A URL carrying a content id must name the content this iframe is for;
 * otherwise it does not describe this page.
 */
function spaceKeyFromLocation(location: unknown, contentId: unknown): string | null {
  if (typeof location !== 'string') return null;
  try {
    const match = PAGE_LOCATION_PATH.exec(new URL(location).pathname);
    if (!match) return null;
    const urlContentId = match[2] ?? match[3];
    if (urlContentId !== undefined && urlContentId !== String(contentId)) return null;
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/**
 * The Forge context's space, corrected for a page-banner iframe.
 *
 * After a Confluence SPA navigation by quick find, a new `confluence:pageBanner`
 * iframe receives the new `content.id` and `location` and the PREVIOUS page's
 * `space` (lite-stg 2026-11-08; macro iframes on the same navigation had the
 * right space, so only banners are corrected). `location` is synchronous, which
 * the banner's fast-exit gates depend on. A corrected space has no `id` because
 * the context's id is the previous space's; callers resolve it from the key.
 */
export function resolveForgeSpace(): { key: string; id?: string } | undefined {
  const extension = forgeGlobal.forgeContext?.extension;
  const contextSpace = extension?.space;
  if (extension?.type !== PAGE_BANNER_EXTENSION_TYPE) return contextSpace;
  const locationKey = spaceKeyFromLocation(extension.location, extension.content?.id);
  if (!locationKey || locationKey.toLowerCase() === contextSpace?.key?.toLowerCase()) return contextSpace;
  return { key: locationKey };
}

/** True when {@link resolveForgeSpace} had to replace the context's space. */
export function isForgeSpaceContextStale(): boolean {
  const contextSpace = forgeGlobal.forgeContext?.extension?.space;
  return Boolean(contextSpace) && resolveForgeSpace() !== contextSpace;
}

export function getSpaceKey() {
  //@ts-ignore
  const urlSpaceKey = getUrlParam('spaceKey');
  //@ts-ignore
  const initialContextSpaceKey = window.initialContext?.currentSpace?.key;
  return urlSpaceKey || initialContextSpaceKey || resolveForgeSpace()?.key || NO_SPACE_CONTEXT;
}

// The result is a KEY (paywall / space-license / CSS lookups), so the contract
// stays: bare subdomain for a single-label `*.atlassian.net` host, '' for
// everything else (custom domains included). Parsing is anchored via #955.
export function getSubdomain(baseUrl: string) {
  const subdomain = toAtlassianClientDomain(baseUrl);
  return subdomain && /^[a-z0-9_-]+$/.test(subdomain) ? subdomain : '';
}

export function getUrlParam (param: string): string {
  try {
    const query = window.location.search;
    const matches = (new RegExp(param + '=([^&]*)')).exec(query);
    return matches && matches[1] && decodeURIComponent(matches[1]) || '';
  } catch (e) {
    return ''
  }
}
