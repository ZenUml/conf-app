export interface JsonInit extends ResponseInit {
  /** Pretty-print indent passed to JSON.stringify. Only the admin inspector uses it. */
  space?: number;
}

/**
 * The one place a JSON response is built. Always emits an explicit
 * `Content-Type: application/json` unless the caller already set one: a string
 * body with no Content-Type defaults to `text/plain;charset=UTF-8` in the
 * Workers runtime, which the Forge bridge (`invokeRemote`) rejects *before*
 * reading the body, masking the real error behind a generic content-type
 * complaint. Per-endpoint policy (status, Cache-Control, CORS) goes in `init`
 * at the call site. Argument order is always (body, init).
 */
export function json(body: unknown, init: JsonInit = {}): Response {
  const { space, headers: extraHeaders, ...rest } = init;
  const headers = new Headers(extraHeaders);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body, null, space), { ...rest, headers });
}

export function OkResponse(data?: object | undefined) {
  return json(data || 'OK', { status: 200 });
}

// The body is always a string today (callers pass status/error text); `{ error }`
// is the stable shape clients can read, so every error stays parseable.
export function response(status: number, body?: unknown) {
  return json({ error: body || '' }, { status });
}
