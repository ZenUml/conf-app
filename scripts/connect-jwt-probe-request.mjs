// Request shape for scripts/connect-jwt-probe.mjs, kept free of I/O so the
// query string and the Connect QSH canonical query cannot drift apart.

// RFC 3986 percent-encoding, as the Atlassian Connect QSH spec requires.
const encode = (value) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * GET /wiki/api/v2/pages/{id}/custom-content needs `type`; `body-format=raw`
 * is what makes the body (and so macroUuid) come back, exactly as production
 * listings send them (src/macro-count-snapshot.ts).
 * Returns the request path, the sorted canonical query used in the QSH, and
 * the same query as sent on the URL.
 */
export function buildProbeRequest({ pageId, type }) {
  if (!pageId) throw new Error('pageId is required');
  if (!type) throw new Error('type is required (e.g. ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence)');
  const params = { type, 'body-format': 'raw' };
  const query = Object.keys(params)
    .sort()
    .map((key) => `${encode(key)}=${encode(params[key])}`)
    .join('&');
  return { path: `/api/v2/pages/${pageId}/custom-content`, query };
}

/** QSH input: METHOD&canonicalPath&canonicalQuery (path relative to the /wiki context path). */
export function qshInput(method, { path, query }) {
  return `${method}&${path}&${query}`;
}
