/**
 * One JSON call to Confluence, as the USER.
 *
 * `requestConfluence` runs with the current user's permissions rather than the
 * app's, which is the whole reason the byline's writes can come back
 * `forbidden` — a reader is not always an author, and every caller here treats
 * that as an outcome rather than an error.
 *
 * Imported dynamically because these callers run in surfaces (the page banner,
 * the byline panel) that decide whether to do any work at all from synchronous
 * localStorage reads; pulling @forge/bridge into that decision would put a
 * bundle on the hot path for the ~99% of loads that close immediately.
 */
export async function requestConfluenceJson(url: string, method: string, body?: unknown) {
  const { requestConfluence } = await import('@forge/bridge')
  return requestConfluence(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
