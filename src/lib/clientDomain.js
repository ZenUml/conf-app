// One converter between the two spellings of a Confluence tenant (#955):
//   client domain  `example-tenant`                  (Mixpanel `client_domain`, KV keys)
//   site host      `example-tenant.atlassian.net`    (D1 and URL vocabulary)
//
// Plain JS with NO imports on purpose: `src/export.js` is a Forge Function
// entry, and `.ts` imports there go through a ts-loader typecheck that has
// broken deploys. `functions/` imports this the same way it imports
// `../src/lib/pngExportState.js`.
//
// DECISION: a custom-domain site (one NOT on `*.atlassian.net`) has the FULL,
// lower-cased HOST as its `client_domain` (`wiki.example.com`), because the
// first label alone (`wiki`) would merge unrelated hosts. A bare input with no
// dots is returned unchanged (lower-cased). Only a trailing `.atlassian.net` is
// stripped; a trailing root dot (`x.atlassian.net.`) is not normalised, which
// keeps results byte-identical to the older hand-written copies.

/**
 * Anchored, dots escaped. Group 1 is the client domain. Matches the HOST only
 * (no scheme, no path); callers that start from a URL parse it first.
 */
export const ATLASSIAN_SITE_HOST_RE = /^([^\s/:?#@]+)\.atlassian\.net$/i;

/**
 * Reduce a bare domain, host, or URL to a lower-cased hostname.
 * @param {string | null | undefined} input
 * @returns {string | null} null when empty or unparseable
 */
function hostnameOf(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const hostname = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
    return hostname || null;
  } catch (_) {
    return null;
  }
}

/**
 * Bare client domain for a `*.atlassian.net` URL or host, otherwise null.
 * Stricter than {@link toClientDomain}: a bare label such as `example-tenant`
 * or a custom domain gives null.
 * @param {string | null | undefined} input
 * @returns {string | null}
 */
export function toAtlassianClientDomain(input) {
  if (typeof input !== 'string' || !input.includes('.')) return null;
  const hostname = hostnameOf(input);
  const match = hostname ? ATLASSIAN_SITE_HOST_RE.exec(hostname) : null;
  return match ? match[1] : null;
}

/**
 * Accepts a bare domain, a host, or a URL. Returns the bare client domain for
 * `*.atlassian.net`, the full lower-cased host for any other host (custom
 * domain), and null if the input is empty or unparseable.
 * @param {string | null | undefined} input
 * @returns {string | null}
 */
export function toClientDomain(input) {
  const hostname = hostnameOf(input);
  if (!hostname) return null;
  const match = ATLASSIAN_SITE_HOST_RE.exec(hostname);
  return match ? match[1] : hostname;
}

/**
 * Inverse for `*.atlassian.net` tenants: `example-tenant` becomes
 * `example-tenant.atlassian.net`. A value that already contains a dot (a site
 * host or a custom-domain client domain) is returned lower-cased and unchanged.
 * @param {string} clientDomain
 * @returns {string} '' for empty input
 */
export function toSiteHost(clientDomain) {
  const value = typeof clientDomain === 'string' ? clientDomain.trim().toLowerCase() : '';
  if (!value) return '';
  return value.includes('.') ? value : `${value}.atlassian.net`;
}
