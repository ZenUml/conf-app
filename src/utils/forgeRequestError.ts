/**
 * Thrown by `forgeRequest` when Confluence answers with a body that is not
 * JSON — typically an HTML page (`<!doctype html>…`) for a gateway error, a
 * login/interstitial page or a maintenance page. Also thrown for a JSON body
 * with a non-2xx status, but only when the caller opts in with
 * `{ throwOnHttpError: true }`; `nonJson` tells the two apart.
 *
 * Before this existed the caller got the bare `SyntaxError` from
 * `Response.json()` ("Unexpected token '<', \"<!doctype \"…"), which dropped the
 * HTTP status and left the largest `attachment_upload_failed` bucket with no
 * way to tell a 502 from a 401 from a 200 login page. JSON bodies, including
 * `{ errors: [...] }` error envelopes on 4xx, are still returned as before —
 * only an unparseable body reaches this error.
 *
 * Lives in its own module (not requestUtil.ts) so specs that mock
 * `@/utils/requestUtil` wholesale still get the real class for `instanceof`.
 */
export class ForgeRequestError extends Error {
  readonly status: number;
  readonly method: string;
  /** Low-cardinality request shape, e.g. `GET /wiki/api/v2/pages/{id}/attachments`. */
  readonly endpoint: string;
  readonly contentType: string;
  /** First characters of the body, whitespace collapsed. Diagnostics only. */
  readonly bodyPrefix: string;
  /** `<title>` of an HTML body, when there is one. Usually names the error page. */
  readonly htmlTitle: string | undefined;
  /** False when the body parsed as JSON and the error comes from the HTTP status alone (opt-in). */
  readonly nonJson: boolean;

  constructor(opts: { status: number; method: string; url: string; contentType: string; body: string; nonJson?: boolean }) {
    const bodyPrefix = opts.body.replace(/\s+/g, ' ').trim().slice(0, BODY_PREFIX_LENGTH);
    const method = opts.method.toUpperCase();
    const endpoint = `${method} ${templateUrl(opts.url)}`;
    const nonJson = opts.nonJson ?? true;
    super(`HTTP ${opts.status} ${nonJson ? 'non-JSON' : 'error'} response (${opts.contentType || 'no content-type'}) from ${endpoint}: ${bodyPrefix}`);
    this.nonJson = nonJson;
    this.name = 'ForgeRequestError';
    this.status = opts.status;
    this.method = method;
    this.endpoint = endpoint;
    this.contentType = opts.contentType;
    this.bodyPrefix = bodyPrefix;
    this.htmlTitle = parseHtmlTitle(opts.body);
  }
}

const BODY_PREFIX_LENGTH = 120;
const TITLE_LENGTH = 80;

/**
 * Drop the query string and replace numeric, `att<n>` attachment and UUID path
 * segments with `{id}`, so the endpoint groups in Mixpanel and carries no
 * content or page ids.
 */
export function templateUrl(url: string): string {
  const path = url.split('?')[0];
  return path
    .split('/')
    .map(seg => (/^(att)?\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(seg) ? '{id}' : seg))
    .join('/');
}

function parseHtmlTitle(body: string): string | undefined {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(body);
  const title = match?.[1]?.replace(/\s+/g, ' ').trim();
  return title ? title.slice(0, TITLE_LENGTH) : undefined;
}
