// https://developer.atlassian.com/cloud/confluence/context-parameters/
// xdm_e: the base URL of the host application, used for the JavaScript bridge (xdm - cross domain message)
import forgeGlobal from '@/model/globals/forgeGlobal';

export function getClientDomain() {
  // Dev sandbox fallback — `xdm_e` and `initialContext.currentPageUrl` are
  // never set when running on http://127.0.0.1:8080/, so the upgrade URL
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
  let url = getUrlParam('xdm_e');

  //@ts-ignore
  if(!url && window.initialContext?.currentPageUrl) {
    //@ts-ignore
    url = new URL(window.initialContext?.currentPageUrl).origin; //in macro editor
  }

  return url.toLowerCase();
}

export function getSpaceKey() {
  //@ts-ignore
  const urlSpaceKey = getUrlParam('spaceKey');
  //@ts-ignore
  const initialContextSpaceKey = window.initialContext?.currentSpace?.key;
  const forgeSpaceKey = forgeGlobal.forgeContext?.extension?.space?.key;
  return urlSpaceKey || initialContextSpaceKey || forgeSpaceKey || 'no_space_context';
}

export function getSubdomain(baseUrl: string) {
  const regexp = new RegExp('https://([a-z0-9-_]+).atlassian.net');
  const subdomainMatches = regexp.exec(baseUrl.toLowerCase());
  return subdomainMatches && subdomainMatches[1] || '';
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
