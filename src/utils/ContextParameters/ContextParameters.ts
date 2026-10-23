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

export function getSpaceKey() {
  //@ts-ignore
  const urlSpaceKey = getUrlParam('spaceKey');
  //@ts-ignore
  const initialContextSpaceKey = window.initialContext?.currentSpace?.key;
  const forgeSpaceKey = forgeGlobal.forgeContext?.extension?.space?.key;
  return urlSpaceKey || initialContextSpaceKey || forgeSpaceKey || NO_SPACE_CONTEXT;
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
