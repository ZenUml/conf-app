// The one place the Agent Link OAuth cookies are written and read: the
// Atlassian state cookie (atlassianLeg.ts), the consent cookie (authServer.ts)
// and the returning-user cookie (returningUser.ts). Each caller keeps its own
// name, path and lifetime; the attribute policy and the parser live here.
//
// Every cookie is HttpOnly, SameSite=Lax, and Secure when the request is https.
//
// Lax, not Strict. The requests that must carry these cookies are the redirect
// into /consent, the callback from Atlassian, and /authorize opened by an
// agent. Each is part of a navigation that STARTED cross-site, and Strict
// withholds the cookie there. The consent cookie was once Strict: the consent
// screen saw no cookie and refused every real user (observed on staging
// 2026-09-26). Lax still does the job Strict was added for: it is withheld from
// a cross-site POST, which is the shape a CSRF against the consent form takes.
// The GET it allows only renders the page.

export interface SetCookieOptions {
  path: string;
  /** Lifetime in seconds. */
  maxAge: number;
  /** Secure is set when this request was https. */
  requestUrl: URL;
}

/** A Set-Cookie header value. */
export function setCookie(name: string, value: string, { path, maxAge, requestUrl }: SetCookieOptions): string {
  const secure = requestUrl.protocol === 'https:' ? '; Secure' : '';
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

/** A Set-Cookie header value that expires the cookie: empty value, Max-Age=0. */
export function clearCookie(name: string, { path, requestUrl }: Omit<SetCookieOptions, 'maxAge'>): string {
  return setCookie(name, '', { path, maxAge: 0, requestUrl });
}

/**
 * Read one cookie from a Cookie header. Splits on `;`, then on the FIRST `=`;
 * the value is returned as sent (no URL-decoding). An empty value is '' (not
 * null). With duplicate names the first wins, unless `duplicate: 'last'`.
 */
export function readCookie(
  header: string | null,
  name: string,
  { duplicate = 'first' }: { duplicate?: 'first' | 'last' } = {},
): string | null {
  if (!header) return null;
  let found: string | null = null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k !== name) continue;
    found = rest.join('=');
    if (duplicate === 'first') break;
  }
  return found;
}
