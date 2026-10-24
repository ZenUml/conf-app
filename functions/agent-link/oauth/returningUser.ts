// The returning-user cookie: how /authorize recognises someone it has met
// before, so it can skip the trip to Atlassian when it already holds a live
// grant for them. Design: docs/superpowers/specs/2026-09-26-agent-link-returning-user-design.md §1.
//
// Without it every authorization goes through Atlassian's 3LO screen, because
// the grant store is keyed by the Atlassian account id and nothing names the
// user before Atlassian's /me does (authServer.ts header). With it, a second
// agent costs one screen (ours) and a re-authorization of an approved agent
// costs none.
//
// AN IDENTITY HINT, NOT AN AUTHORIZATION. The cookie only chooses which stored
// grant to consider. It never stands in for our per-(user, client) consent
// (ADR 0008 Decision 3): a new client arriving with a valid cookie still gets
// the consent screen. And it is only trusted after its HMAC verifies and the
// grant it names still yields an access token; anything less falls back to
// the Atlassian path rather than failing the request.
//
// It is SIGNED because an unsigned id would let a browser nominate whose grant
// to use. The key is OAUTH_GRANT_SECRET — the grant store already requires it,
// so this adds no configuration — under a message prefix that keeps the MAC
// from colliding with any other use of that secret.

export const RETURNING_USER_COOKIE = 'agent_link_user';
/** Matches Atlassian's 90-day refresh-token inactivity window; refreshed on every use. */
export const RETURNING_USER_TTL_SECONDS = 90 * 24 * 60 * 60;
/** Covers /authorize, where it is read, and /callback, where it is set. */
const COOKIE_PATH = '/agent-link/oauth';
const MAC_PREFIX = 'agent-link-returning-user:v1:';

const ENC = new TextEncoder();
const DEC = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function macKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    ENC.encode(secret) as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function macInput(accountId: string): BufferSource {
  return ENC.encode(`${MAC_PREFIX}${accountId}`) as unknown as BufferSource;
}

function cookie(value: string, requestUrl: URL, maxAge: number): string {
  const secure = requestUrl.protocol === 'https:' ? '; Secure' : '';
  // Lax for the same reason as the state and consent cookies: /authorize is a
  // top-level navigation that usually starts somewhere else (the agent opens
  // the browser), and Strict would withhold the cookie on exactly that request.
  return `${RETURNING_USER_COOKIE}=${value}; Path=${COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

/** Set-Cookie value naming `accountId`, which must come from Atlassian's /me. */
export async function returningUserCookie(accountId: string, secret: string, requestUrl: URL): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', await macKey(secret), macInput(accountId));
  const value = `${toBase64Url(ENC.encode(accountId))}.${toBase64Url(new Uint8Array(mac))}`;
  return cookie(value, requestUrl, RETURNING_USER_TTL_SECONDS);
}

export function clearReturningUserCookie(requestUrl: URL): string {
  return cookie('', requestUrl, 0);
}

export type ReturningUser =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'ok'; accountId: string };

/**
 * Who this browser says it is, if the claim verifies.
 *
 * 'invalid' is kept apart from 'none' only for analytics: a rising share of
 * bad signatures after a secret rotation is expected, anywhere else it is a
 * probe. Both are handled the same way — go to Atlassian.
 */
export async function readReturningUser(cookieHeader: string | null, secret: string): Promise<ReturningUser> {
  let raw: string | null = null;
  for (const part of (cookieHeader ?? '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === RETURNING_USER_COOKIE) raw = rest.join('=');
  }
  if (!raw) return { status: 'none' };

  const [idPart, macPart, extra] = raw.split('.');
  if (!idPart || !macPart || extra !== undefined) return { status: 'invalid' };
  const idBytes = fromBase64Url(idPart);
  const mac = fromBase64Url(macPart);
  if (!idBytes || !mac) return { status: 'invalid' };
  const accountId = DEC.decode(idBytes);
  if (!accountId) return { status: 'invalid' };

  // subtle.verify, not a string compare: it does not leak where a forged MAC
  // first differs.
  const ok = await crypto.subtle.verify('HMAC', await macKey(secret), mac as unknown as BufferSource, macInput(accountId));
  return ok ? { status: 'ok', accountId } : { status: 'invalid' };
}

/**
 * Does this /authorize request ask to go through Atlassian regardless?
 *
 * OIDC's `prompt=login` / `prompt=select_account` are the escape hatch for a
 * user who wants Atlassian's screen back — to sign in as someone else, or to
 * pick another site, both of which only Atlassian's screen can do. Our consent
 * screen links here for a recognised user; an agent can send it too.
 */
export function forcesAtlassian(url: URL): boolean {
  const prompt = (url.searchParams.get('prompt') ?? '').split(/\s+/);
  return prompt.includes('login') || prompt.includes('select_account');
}
