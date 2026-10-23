/**
 * One outbound-HTTP helper for the Pages Functions backend (#941).
 *
 * A Worker keeps the inbound request open while it waits on a subrequest, so a
 * slow upstream holds every request that touches it. Every outbound call goes
 * through `fetchOut()` with a named budget; a test fails on a bare `fetch(`.
 */

/** Confluence REST (as user or as app). */
export const CONFLUENCE_TIMEOUT_MS = 10_000;
/** Attachment uploads carry file bodies. */
export const ATTACHMENT_UPLOAD_TIMEOUT_MS = 30_000;
/** Atlassian OAuth / identity inside a user's browser redirect. */
export const OAUTH_TIMEOUT_MS = 8_000;
export const MIXPANEL_TIMEOUT_MS = 10_000;
export const ZARAZ_TIMEOUT_MS = 5_000;
export const TENANT_INFO_TIMEOUT_MS = 5_000;
export const DEFAULT_TIMEOUT_MS = 10_000;

export class UpstreamTimeoutError extends Error {
  readonly upstream: string;
  /** Host only. The full URL may carry tokens in its query string. */
  readonly host: string;
  readonly timeoutMs: number;
  constructor(upstream: string, host: string, timeoutMs: number) {
    super(`Upstream "${upstream}" (${host}) timed out after ${timeoutMs}ms`);
    this.name = 'UpstreamTimeoutError';
    this.upstream = upstream;
    this.host = host;
    this.timeoutMs = timeoutMs;
  }
}

export type FetchOutInit = RequestInit & { name: string; timeoutMs?: number };

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid-url';
  }
}

export async function fetchOut(url: string, init: FetchOutInit): Promise<Response> {
  const { name, timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...rest } = init;
  // Manual controller: AbortSignal.any is not assumed for our compatibility_date.
  const controller = new AbortController();
  let timedOut = false;

  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) onCallerAbort();
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await globalThis.fetch(url, { ...rest, signal: controller.signal });
  } catch (err) {
    if (timedOut && !callerSignal?.aborted) throw new UpstreamTimeoutError(name, hostOf(url), timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

/** AI chat generation is slow by nature; still bounded. */
export const DIAGRAMLY_TIMEOUT_MS = 60_000;

/**
 * A `fetch`-shaped function with a fixed upstream name and budget, for the
 * `fetchImpl` injection points (OAuth, MCP, Confluence readers).
 */
export function timedFetch(name: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    // A Request carries its own method, headers and body; passing only its URL
    // would drop them. Every injected caller passes a string URL today.
    if (typeof input !== 'string' && !(input instanceof URL)) {
      throw new TypeError('timedFetch accepts a URL string or URL, not a Request');
    }
    return fetchOut(typeof input === 'string' ? input : input.href, { ...init, name, timeoutMs });
  }) as typeof fetch;
}
