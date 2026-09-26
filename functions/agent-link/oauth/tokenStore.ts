// Storage for Atlassian grants, and the one function that turns a stored grant
// into a usable access token.
//
// See docs/superpowers/specs/2026-09-19-headless-diagram-mcp-design.md §5, and
// §12.2, which flags that holding refresh tokens is a new class of end-user
// credential for us and needs a Marketplace P&S declaration to match.
//
// ENCRYPTED AT REST. A refresh token is a 90-day credential to a user's
// Confluence, so it is sealed with AES-GCM before it reaches KV rather than
// stored as the plaintext that a KV browse, a support export or a misrouted
// log would hand over whole. The key comes from a Worker secret; the IV is
// random per write and travels with the ciphertext, as AES-GCM requires.
//
// This is deliberately NOT a general crypto utility. It seals exactly one
// field, for exactly one caller.

import {
  isAccessTokenUsable,
  refreshGrant,
  type AtlassianAppConfig,
  type AtlassianGrant,
  type FetchLike,
  type GrantFailure,
} from './atlassianClient';

/** Narrow enough to be a Map in tests and a KVNamespace in the Worker. */
export interface GrantStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Atlassian's rotating refresh tokens expire after 90 days of inactivity.
 * Storing for slightly longer lets a returning user get a clean
 * 'invalid_grant' — and so a "please authorize again" — rather than a
 * confusing "no grant found" that looks like they never connected at all.
 */
export const GRANT_TTL_SECONDS = 100 * 24 * 60 * 60;

export function grantKey(userId: string): string {
  return `agent-link:oauth-grant:${userId}`;
}

/** The at-rest shape. `rt` is ciphertext; nothing here is plaintext-sensitive except by mistake. */
interface StoredGrant {
  v: 1;
  /** base64 AES-GCM ciphertext of the refresh token. */
  rt: string;
  /** base64 12-byte IV for `rt`. */
  iv: string;
  /**
   * The ACCESS token is stored in the clear. It is a ~1h bearer where the
   * refresh token is a 90-day one, and sealing it would double the crypto on
   * the hot path for a credential that expires before most incidents are even
   * noticed. If that trade stops being acceptable, seal it the same way.
   */
  at: string;
  exp: number;
  scope: string;
  /** Epoch ms of the last successful write, for staleness reporting. */
  updated: number;
}

const ENC = new TextEncoder();
const DEC = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Derive the AES key from the Worker secret.
 *
 * SHA-256 of the secret gives a 256-bit key from a secret of any length, so a
 * short or long secret both produce a valid key rather than an import error at
 * the first write. It is not a password KDF and does not need to be: the input
 * is a high-entropy machine-generated secret, not a human password.
 */
async function deriveKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', ENC.encode(secret) as unknown as BufferSource);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function seal(secret: string, plaintext: string): Promise<{ ct: string; iv: string }> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // The BufferSource casts keep this compiling across the TS lib versions that
  // disagree about whether a Uint8Array's buffer may be a SharedArrayBuffer.
  // Runtime shape is unaffected.
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    ENC.encode(plaintext) as unknown as BufferSource,
  );
  return { ct: toBase64(new Uint8Array(ct)), iv: toBase64(iv) };
}

async function unseal(secret: string, ct: string, iv: string): Promise<string | null> {
  try {
    const key = await deriveKey(secret);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(iv) as unknown as BufferSource },
      key,
      fromBase64(ct) as unknown as BufferSource,
    );
    return DEC.decode(plain);
  } catch {
    // Wrong key, tampered ciphertext, or a record written before a secret
    // rotation. All three mean the same thing operationally: this grant can no
    // longer be used and the user must authorize again.
    return null;
  }
}

export async function saveGrant(
  store: GrantStore,
  secret: string,
  userId: string,
  grant: AtlassianGrant,
  nowMs: number = Date.now(),
): Promise<void> {
  const { ct, iv } = await seal(secret, grant.refreshToken);
  const stored: StoredGrant = {
    v: 1,
    rt: ct,
    iv,
    at: grant.accessToken,
    exp: grant.accessTokenExpiresAtMs,
    scope: grant.scope,
    updated: nowMs,
  };
  await store.put(grantKey(userId), JSON.stringify(stored), { expirationTtl: GRANT_TTL_SECONDS });
}

export async function loadGrant(
  store: GrantStore,
  secret: string,
  userId: string,
): Promise<AtlassianGrant | null> {
  const raw = await store.get(grantKey(userId));
  if (!raw) return null;

  let stored: StoredGrant;
  try {
    stored = JSON.parse(raw) as StoredGrant;
  } catch {
    return null;
  }
  if (stored?.v !== 1 || typeof stored.rt !== 'string' || typeof stored.iv !== 'string') return null;

  const refreshToken = await unseal(secret, stored.rt, stored.iv);
  if (!refreshToken) return null;

  return {
    accessToken: typeof stored.at === 'string' ? stored.at : '',
    refreshToken,
    accessTokenExpiresAtMs: typeof stored.exp === 'number' ? stored.exp : 0,
    scope: typeof stored.scope === 'string' ? stored.scope : '',
  };
}

export async function deleteGrant(store: GrantStore, userId: string): Promise<void> {
  await store.delete(grantKey(userId));
}

export type AccessTokenResult =
  | { ok: true; accessToken: string; refreshed: boolean }
  | { ok: false; reason: 'no_grant' | 'reauthorize_required' | 'refresh_failed'; detail?: string };

/**
 * The access token for `userId`, refreshing and re-persisting if needed.
 *
 * Every headless Confluence call goes through here, so the ordering matters:
 * the rotated refresh token is PERSISTED BEFORE the new access token is
 * returned. Atlassian has already invalidated the old refresh token by the
 * time we see the response, so a crash between "refresh succeeded" and "grant
 * saved" loses the user's authorization outright. Saving first makes the worst
 * case a wasted refresh rather than a dead grant.
 *
 * 'reauthorize_required' is separated from 'refresh_failed' because only the
 * first is the user's to fix. A rejected refresh token means the 90-day
 * inactivity window lapsed or the user revoked us; a 503 from Atlassian means
 * try again in a minute.
 */
export async function getAccessToken(
  store: GrantStore,
  secret: string,
  app: AtlassianAppConfig,
  fetchImpl: FetchLike,
  userId: string,
  nowMs: number = Date.now(),
): Promise<AccessTokenResult> {
  const grant = await loadGrant(store, secret, userId);
  if (!grant) return { ok: false, reason: 'no_grant' };

  if (isAccessTokenUsable(grant, nowMs)) {
    return { ok: true, accessToken: grant.accessToken, refreshed: false };
  }

  const refreshed = await refreshGrant(fetchImpl, app, grant.refreshToken, nowMs);
  if (!refreshed.ok) {
    const terminal: GrantFailure[] = ['invalid_grant', 'invalid_client'];
    if (terminal.includes(refreshed.failure)) {
      // The grant is dead. Drop it so the next call reports 'no_grant' and the
      // user is told to authorize rather than being retried at forever.
      await deleteGrant(store, userId);
      return { ok: false, reason: 'reauthorize_required', detail: refreshed.detail };
    }
    return { ok: false, reason: 'refresh_failed', detail: refreshed.detail };
  }

  await saveGrant(store, secret, userId, refreshed.grant, nowMs);
  return { ok: true, accessToken: refreshed.grant.accessToken, refreshed: true };
}
