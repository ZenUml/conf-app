import { ForgeRequestError } from '@/utils/forgeRequestError';

/**
 * Thrown when the Confluence v1 attachment API rejects the upload because the
 * page is still a draft.  The API returns HTTP 200 with a body like:
 *   {"statusCode":404,"message":"No content found … status : draft"}
 * We surface this as a typed error so the outer catch can handle it without
 * re-throwing (draft pages are expected — not a bug).
 */
export class DraftPageError extends Error {
  constructor(body: string) {
    super(`Attachment upload skipped — page is a draft: ${body}`);
    this.name = 'DraftPageError';
  }
}

/**
 * Thrown when toPng() returns null — the diagram is empty, not yet rendered,
 * or the capture node is absent. Treated as a skip (not a failure) so the
 * caller doesn't log it as an error and it doesn't break the save flow.
 */
export class ToPngError extends Error {
  constructor() {
    super('Diagram is empty or not yet rendered — PNG capture skipped.');
    this.name = 'ToPngError';
  }
}

/**
 * Thrown when the Confluence attachment API responds with a non-2xx HTTP
 * status — either reported directly on the `Response` object, or wrapped in
 * the response body (`{"statusCode": 403, ...}`).  Carrying the status as a
 * structured field lets the analytics catch label these uniformly as
 * `http_403` / `http_401` / etc. instead of opaque `Error` / `UnknownError`,
 * which made the upload-failure data unusable in Mixpanel.
 */
export class AttachmentUploadHttpError extends Error {
  /** e.g. 'PermissionException' — undefined when the body carries no class. */
  readonly confluenceErrorClass?: string;

  constructor(public readonly status: number, body: string) {
    const detail = extractConfluenceMessage(body);
    super(`Confluence attachment API returned ${status}: ${detail.slice(0, 200)}`);
    this.name = 'AttachmentUploadHttpError';
    this.confluenceErrorClass = parseConfluenceErrorClass(detail);
  }
}

/**
 * Pull the diagnostic part out of a Confluence v1 error body.
 *
 * The v1 API wraps every error in a fixed ~180-char envelope:
 *   {"statusCode":403,"data":{"authorized":true,"valid":true,"errors":[],
 *    "successful":true},"message":"com.atlassian…Exception: <the actual reason>"}
 * Both this error's message and the `error_message` analytics property are
 * capped at 200 chars, so the envelope alone consumed the entire budget and
 * every recorded failure ended mid-class-name ("…api.BadReques"). `http_400`
 * was 21% of failures and completely undiagnosable, and JQL substring matches
 * for the exception class returned zero (#392). Keep the `message` field so
 * the 200 chars are spent on the reason instead of the wrapper.
 */
export function extractConfluenceMessage(body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.message === 'string' && parsed.message) return parsed.message;
  } catch {
    // The body may be a TRUNCATED envelope — the app-fallback backend caps the
    // body it relays at 500 chars — so JSON.parse fails on an otherwise
    // well-formed prefix. Salvage the message field textually before giving up.
    const salvaged = /"message"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(body);
    if (salvaged?.[1]) return salvaged[1];
  }
  // Not a Confluence envelope: an HTML error page, a plain-text body, or one
  // of our own backend strings. Keep it as-is.
  return body;
}

/**
 * Low-cardinality Confluence exception class for grouping in Mixpanel, parsed
 * out of the fully-qualified name (`com.atlassian.…api.PermissionException:
 * …` -> `PermissionException`). Undefined when the body carries no class.
 */
export function parseConfluenceErrorClass(detail: string): string | undefined {
  return /(?:^|[.\s])([A-Za-z]+Exception)\b/.exec(detail)?.[1];
}

/**
 * Pull an HTTP status out of an arbitrary thrown value.  Covers three shapes
 * we see in production:
 *   1. `AttachmentUploadHttpError.status` / `ForgeRequestError.status` (our
 *      typed errors — the latter is a non-JSON body from `forgeRequest`)
 *   2. `e.status` (Forge bridge surface on some failures)
 *   3. `e.xhr.status` (legacy XHR-style error)
 * Returns undefined when no status is recoverable.
 */
export function extractHttpStatus(e: unknown): number | undefined {
  if (e instanceof AttachmentUploadHttpError || e instanceof ForgeRequestError) return e.status;
  const obj = e as { status?: unknown; xhr?: { status?: unknown } } | null | undefined;
  const candidate = obj?.status ?? obj?.xhr?.status;
  return typeof candidate === 'number' ? candidate : undefined;
}

/**
 * Build a stable, low-cardinality label for the `event_label` field on
 * `attachment_upload_failed`.  Mixpanel aggregates on this — keep it bucketed,
 * not free-form strings.  Examples:
 *   - `http_403`        — Confluence rejected the upload (permissions, etc.)
 *   - `http_404`        — page or content gone
 *   - `non_json_http_502` — `forgeRequest` got a body that wasn't JSON (an
 *                         HTML error/login page) with that status. Kept apart
 *                         from `http_<status>` because the response is a page,
 *                         not a Confluence error envelope.
 *   - `SyntaxError`     — body wasn't JSON on a path that has no status
 *   - `non_error_thrown` — something other than an Error was thrown
 *   - `Error`           — fallback (anonymous Error with no useful name)
 *   - `app_no_access`   — the app-authenticated fallback 404'd, i.e. the APP
 *                         cannot see the page (restricted space it isn't a
 *                         member of). Distinct from a user-side `http_404`,
 *                         which means the parent page isn't published yet and
 *                         is recorded as a skip rather than a failure (#211).
 */
export function buildFailureLabel(
  e: unknown,
  httpStatus: number | undefined,
  viaAppFallback = false,
): string {
  if (httpStatus === 404 && viaAppFallback) return 'app_no_access';
  if (e instanceof ForgeRequestError && e.nonJson) return `non_json_http_${e.status}`;
  if (typeof httpStatus === 'number') return `http_${httpStatus}`;
  if (e instanceof Error) return e.name || 'Error';
  return 'non_error_thrown';
}
