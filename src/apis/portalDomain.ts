import forgeGlobal from '@/model/globals/forgeGlobal';

// Forge Custom UI is served from `*.cdn.prod.atlassian-dev.net/<app-id>/...`,
// so `window.location.host` is an Atlassian CDN host — NOT one of the conf-*.zenuml.com
// domains. Falling back on the host whitelist alone sends every Forge user to
// portal-stg, which has an empty feature-flag KV. Use the Forge environmentType
// when available, otherwise fall back to the Connect host check.
export function getPortalDomain() {
  if (forgeGlobal.isForge) {
    return forgeGlobal.forgeContext?.environmentType === 'PRODUCTION'
      ? 'https://portal.zenuml.com'
      : 'https://portal-stg.zenuml.com';
  }
  return ["conf-full.zenuml.com", "conf-lite.zenuml.com"].includes(
    window.location.host
  )
    ? "https://portal.zenuml.com"
    : "https://portal-stg.zenuml.com";
}
