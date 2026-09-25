// Everything our authorization server has to remember: registered MCP clients,
// in-flight authorizations, the codes it hands back, the tokens it issues, and
// which client a user has actually consented to.
//
// ADR 0008 Decision 2: "MCP tokens are opaque handles, like session tokens
// today, stored in KV ... No JWTs, no signing keys, no key rotation story."
// This is that store. It shares OAUTH_GRANT_KV with the Atlassian grants,
// separated by key prefix — one namespace to provision, and every record here
// has a TTL, so nothing accumulates.
//
// TWO THINGS THAT ARE DELIBERATE:
//
//   - Secrets are stored HASHED. A KV row is not a bearer credential: we keep
//     SHA-256 of the token/code and look up by hash, so a dump of the
//     namespace cannot be replayed against the MCP endpoint. (The Atlassian
//     refresh token in tokenStore.ts is encrypted rather than hashed for the
//     opposite reason — we have to be able to read it back.)
//   - Authorization codes are SINGLE USE and short-lived. `consumeCode`
//     deletes before it returns, so two racing redemptions cannot both win.

import type { GrantStore } from './tokenStore';

/** The store this module needs is exactly the grant store's shape. */
export type GrantStoreLike = GrantStore;

const PREFIX = 'agent-link:oauth';

export const CLIENT_TTL_SECONDS = 365 * 24 * 60 * 60;
/**
 * Kept equal to atlassianLeg's STATE_TTL_SECONDS: the parked authorization and
 * the cookie that protects it must expire together, or one outlives the other
 * and the user gets a failure from whichever went first.
 */
export const PENDING_TTL_SECONDS = 30 * 60;
/** RFC 6749 §4.1.2: "maximum authorization code lifetime of 10 minutes is RECOMMENDED"; one minute is plenty for a redirect. */
export const CODE_TTL_SECONDS = 60;
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const CONSENT_TTL_SECONDS = 365 * 24 * 60 * 60;

export interface RegisteredClient {
  clientId: string;
  redirectUris: string[];
  clientName?: string;
  createdAtMs: number;
}

/** An authorization in flight: parked while the user consents and visits Atlassian. */
export interface PendingAuthorization {
  clientId: string;
  redirectUri: string;
  /** The MCP client's own state, echoed back untouched. */
  state?: string;
  codeChallenge: string;
  scope: string;
  resource: string;
  createdAtMs: number;
  /**
   * Set on the way back from Atlassian, never by the client: who consented.
   * Our consent screen is a separate request, so the user that /me named has
   * to be parked with the rest of the authorization or it is lost.
   */
  userId?: string;
}

export interface IssuedCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
  userId: string;
  createdAtMs: number;
}

export interface McpTokenRecord {
  userId: string;
  clientId: string;
  scope: string;
  resource: string;
  expiresAtMs: number;
}

export interface RefreshTokenRecord {
  userId: string;
  clientId: string;
  scope: string;
  resource: string;
}

/** Random, URL-safe, 256 bits. Used for every client id, code and token. */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SHA-256 hex. The lookup key for anything secret. */
export async function hashSecret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function putJson(store: GrantStore, key: string, value: unknown, ttl: number): Promise<void> {
  await store.put(key, JSON.stringify(value), { expirationTtl: ttl });
}

async function getJson<T>(store: GrantStore, key: string): Promise<T | null> {
  const raw = await store.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A record we cannot parse is a record we cannot trust; treat it as absent
    // rather than throwing into the middle of a token exchange.
    return null;
  }
}

// ---------------------------------------------------------------- clients

export function clientKey(clientId: string): string {
  return `${PREFIX}-client:${clientId}`;
}

export async function saveClient(store: GrantStore, client: RegisteredClient): Promise<void> {
  await putJson(store, clientKey(client.clientId), client, CLIENT_TTL_SECONDS);
}

export function loadClient(store: GrantStore, clientId: string): Promise<RegisteredClient | null> {
  return getJson<RegisteredClient>(store, clientKey(clientId));
}

// ------------------------------------------------------------ in-flight

export function pendingKey(id: string): string {
  return `${PREFIX}-pending:${id}`;
}

export async function savePending(store: GrantStore, id: string, pending: PendingAuthorization): Promise<void> {
  await putJson(store, pendingKey(id), pending, PENDING_TTL_SECONDS);
}

export function loadPending(store: GrantStore, id: string): Promise<PendingAuthorization | null> {
  return getJson<PendingAuthorization>(store, pendingKey(id));
}

export async function deletePending(store: GrantStore, id: string): Promise<void> {
  await store.delete(pendingKey(id));
}

// ---------------------------------------------------------------- codes

/**
 * Mint an authorization code for `details`, returning the code itself.
 *
 * The caller gets the only plaintext copy; KV holds its hash.
 */
export async function issueCode(store: GrantStore, details: IssuedCode): Promise<string> {
  const code = randomToken();
  await putJson(store, `${PREFIX}-code:${await hashSecret(code)}`, details, CODE_TTL_SECONDS);
  return code;
}

/** Redeem a code, deleting it first so a replay finds nothing. */
export async function consumeCode(store: GrantStore, code: string): Promise<IssuedCode | null> {
  const key = `${PREFIX}-code:${await hashSecret(code)}`;
  const record = await getJson<IssuedCode>(store, key);
  await store.delete(key);
  return record;
}

// --------------------------------------------------------------- tokens

export async function issueAccessToken(
  store: GrantStore,
  record: Omit<McpTokenRecord, 'expiresAtMs'>,
  nowMs: number,
  ttlSeconds: number = ACCESS_TOKEN_TTL_SECONDS,
): Promise<{ token: string; expiresInSeconds: number }> {
  const token = randomToken();
  const full: McpTokenRecord = { ...record, expiresAtMs: nowMs + ttlSeconds * 1000 };
  await putJson(store, `${PREFIX}-token:${await hashSecret(token)}`, full, ttlSeconds);
  return { token, expiresInSeconds: ttlSeconds };
}

/**
 * The record behind a bearer token, or null if it is unknown or expired.
 *
 * KV's own TTL does the sweeping, but it is eventually consistent, so the
 * expiry is re-checked here rather than trusted to have already fired.
 */
export async function loadAccessToken(
  store: GrantStore,
  token: string,
  nowMs: number,
): Promise<McpTokenRecord | null> {
  const record = await getJson<McpTokenRecord>(store, `${PREFIX}-token:${await hashSecret(token)}`);
  if (!record) return null;
  return record.expiresAtMs > nowMs ? record : null;
}

export async function revokeAccessToken(store: GrantStore, token: string): Promise<void> {
  await store.delete(`${PREFIX}-token:${await hashSecret(token)}`);
}

export async function issueRefreshToken(store: GrantStore, record: RefreshTokenRecord): Promise<string> {
  const token = randomToken();
  await putJson(store, `${PREFIX}-refresh:${await hashSecret(token)}`, record, REFRESH_TOKEN_TTL_SECONDS);
  return token;
}

/**
 * Redeem a refresh token, deleting it in the same step.
 *
 * Rotation, matching Atlassian's own behaviour (ADR 0008 Decision 2): the
 * presented token is dead whether or not the caller ends up using the new one,
 * so a stolen refresh token is single-use and its reuse is detectable as a
 * plain failure rather than silent parallel access.
 */
export async function consumeRefreshToken(
  store: GrantStore,
  token: string,
): Promise<RefreshTokenRecord | null> {
  const key = `${PREFIX}-refresh:${await hashSecret(token)}`;
  const record = await getJson<RefreshTokenRecord>(store, key);
  await store.delete(key);
  return record;
}

// -------------------------------------------------------------- consent

/**
 * ADR 0008 Decision 3: consent is per (user, client), and it is the security
 * boundary. One static upstream client id at Atlassian fronts every
 * dynamically registered MCP client, so without this record the second agent a
 * user registers would silently inherit the first one's Atlassian grant.
 */
export function consentKey(userId: string, clientId: string): string {
  return `${PREFIX}-consent:${userId}:${clientId}`;
}

export interface ConsentRecord {
  userId: string;
  clientId: string;
  scope: string;
  grantedAtMs: number;
}

export async function saveConsent(store: GrantStore, record: ConsentRecord): Promise<void> {
  await putJson(store, consentKey(record.userId, record.clientId), record, CONSENT_TTL_SECONDS);
}

export function loadConsent(
  store: GrantStore,
  userId: string,
  clientId: string,
): Promise<ConsentRecord | null> {
  return getJson<ConsentRecord>(store, consentKey(userId, clientId));
}

export async function revokeConsent(store: GrantStore, userId: string, clientId: string): Promise<void> {
  await store.delete(consentKey(userId, clientId));
}
