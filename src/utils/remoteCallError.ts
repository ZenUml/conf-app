/**
 * Thrown by `callRemote` when our backend answers with a status other than
 * 200/201 (#927). Callers branch on `status` and `errorCode` instead of
 * parsing them back out of `message`, the way `ForgeRequestError` does for
 * the Confluence side.
 *
 * `message` keeps the `HTTP <status>: <body>` form callers matched on before
 * this class existed, so it still carries the backend body. Send `status`,
 * `errorCode` or `endpoint` to analytics, never `message` or `bodyPrefix`.
 *
 * Lives in its own module (not requestUtil.ts) so specs that mock
 * `@/utils/requestUtil` wholesale still get the real class for `instanceof`.
 */
export class RemoteCallError extends Error {
  readonly status: number;
  /** Method and path, no query string, e.g. `POST /magic-writeback`. */
  readonly endpoint: string;
  /** The backend's `{ error: '<code>' }` value, when it is a short snake_case token. */
  readonly errorCode: string | undefined;
  /** First characters of the body, whitespace collapsed. Diagnostics only. */
  readonly bodyPrefix: string;

  constructor(opts: { status: number; method: string; endpoint: string; body: unknown }) {
    const body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) ?? '';
    super(`HTTP ${opts.status}: ${body || 'No body'}`);
    this.name = 'RemoteCallError';
    this.status = opts.status;
    this.endpoint = `${opts.method.toUpperCase()} ${opts.endpoint.split('?')[0]}`;
    this.errorCode = parseErrorCode(opts.body);
    this.bodyPrefix = body.replace(/\s+/g, ' ').trim().slice(0, BODY_PREFIX_LENGTH);
  }
}

const BODY_PREFIX_LENGTH = 120;
const ERROR_CODE = /^[a-z_]{1,40}$/;

function parseErrorCode(body: unknown): string | undefined {
  let parsed = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  const code = (parsed as { error?: unknown } | null)?.error;
  return typeof code === 'string' && ERROR_CODE.test(code) ? code : undefined;
}
