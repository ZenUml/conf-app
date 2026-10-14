import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, hashSecret, newChainId, randomToken, type RefreshTokenRecord } from './asStore';

const RETRY_MS = 120_000;
const ENC = new TextEncoder();
const DEC = new TextDecoder();

interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta: { changes?: number } }>;
}
export interface RefreshDb {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<Array<{ success: boolean; meta: { changes?: number } }>>;
}

interface Row extends Omit<RefreshTokenRecord, 'usedAtMs' | 'chainId'> {
  legacy: number;
  legacyLineage: number;
  tokenHash: string;
  expiresAtMs: number;
  usedAtMs: number | null;
  successorHash: string | null;
  receiptCiphertext: string | null;
  receiptIv: string | null;
  receiptExpiresAtMs: number | null;
  revokedAtMs: number | null;
  chainId: string;
}
export interface RefreshPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresAtMs: number;
  scope: string;
  record: RefreshTokenRecord & { chainId: string };
}
export type RotateResult =
  | { status: 'rotated' | 'retried'; pair: RefreshPair; reuseAgeMs?: number }
  | { status: 'unknown' | 'revoked' | 'expired' | 'client_mismatch' | 'resource_mismatch' | 'reused' | 'advanced'; record?: RefreshTokenRecord & { chainId: string }; reuseAgeMs?: number };

function b64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
function unb64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
async function keyFor(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', ENC.encode(secret) as BufferSource);
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(secret: string, aad: string, pair: RefreshPair): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: ENC.encode(aad) as BufferSource },
    await keyFor(secret), ENC.encode(JSON.stringify(pair)) as BufferSource,
  );
  return { ciphertext: b64(new Uint8Array(cipher)), iv: b64(iv) };
}
async function unseal(secret: string, aad: string, ciphertext: string, iv: string): Promise<RefreshPair> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(iv) as BufferSource, additionalData: ENC.encode(aad) as BufferSource },
    await keyFor(secret), unb64(ciphertext) as BufferSource,
  );
  return JSON.parse(DEC.decode(plain)) as RefreshPair;
}

export function createRefreshLedger(db: RefreshDb, secret: string, issuer: string) {
  const aad = (row: Pick<Row, 'tokenHash' | 'clientId' | 'chainId'>) =>
    JSON.stringify([issuer, row.tokenHash, row.clientId, row.chainId]);
  const read = (hash: string) => db.prepare(`SELECT t.*, c.revokedAtMs FROM AgentLinkOAuthRefreshToken t
    JOIN AgentLinkOAuthRefreshChain c ON c.issuer=t.issuer AND c.chainId=t.chainId
    WHERE t.issuer=? AND t.tokenHash=?`).bind(issuer, hash).first<Row>();

  async function issue(record: RefreshTokenRecord & { chainId: string }, nowMs: number): Promise<string> {
    const token = randomToken();
    const hash = await hashSecret(token);
    const expiry = nowMs + REFRESH_TOKEN_TTL_SECONDS * 1000;
    const results = await db.batch([
      db.prepare(`INSERT INTO AgentLinkOAuthRefreshChain (issuer,chainId,expiresAtMs)
        VALUES (?,?,?) ON CONFLICT(issuer,chainId) DO UPDATE SET expiresAtMs=max(expiresAtMs,excluded.expiresAtMs)`)
        .bind(issuer, record.chainId, expiry),
      db.prepare(`INSERT INTO AgentLinkOAuthRefreshToken
        (issuer,tokenHash,chainId,userId,clientId,scope,resource,expiresAtMs)
        VALUES (?,?,?,?,?,?,?,?)`).bind(issuer, hash, record.chainId, record.userId, record.clientId, record.scope, record.resource, expiry),
    ]);
    if (results.some((result) => !result.success)) throw new Error('D1 refresh issue failed');
    return token;
  }

  /** Import only on KV miss in D1. An old consumed token remains consumed. */
  async function importLegacy(token: string, record: RefreshTokenRecord, nowMs: number): Promise<void> {
    const chainId = record.chainId ?? newChainId();
    const hash = await hashSecret(token);
    const expiry = nowMs + REFRESH_TOKEN_TTL_SECONDS * 1000;
    const results = await db.batch([
      db.prepare(`INSERT INTO AgentLinkOAuthRefreshChain (issuer,chainId,expiresAtMs)
        VALUES (?,?,?) ON CONFLICT(issuer,chainId) DO UPDATE SET expiresAtMs=max(expiresAtMs,excluded.expiresAtMs)`)
        .bind(issuer, chainId, expiry),
      db.prepare(`INSERT INTO AgentLinkOAuthRefreshToken
        (issuer,tokenHash,chainId,userId,clientId,scope,resource,expiresAtMs,legacy,legacyLineage,usedAtMs)
        VALUES (?,?,?,?,?,?,?,?,1,1,?) ON CONFLICT(issuer,tokenHash) DO NOTHING`)
        .bind(issuer, hash, chainId, record.userId, record.clientId, record.scope, record.resource, expiry, record.usedAtMs ?? null),
    ]);
    if (results.some((result) => !result.success)) throw new Error('D1 refresh import failed');
  }

  async function revoke(chainId: string, nowMs: number): Promise<void> {
    const result = await db.prepare(`UPDATE AgentLinkOAuthRefreshChain SET revokedAtMs=COALESCE(revokedAtMs,?) WHERE issuer=? AND chainId=?`)
      .bind(nowMs, issuer, chainId).run();
    if (!result.success) throw new Error('D1 refresh revoke failed');
  }
  async function inspect(token: string): Promise<{ legacy: boolean; legacyLineage: boolean; chainId: string; resource: string; usedAtMs: number | null } | null> {
    const row = await read(await hashSecret(token));
    return row ? { legacy: row.legacy === 1, legacyLineage: row.legacyLineage === 1,
      chainId: row.chainId, resource: row.resource, usedAtMs: row.usedAtMs } : null;
  }
  async function isRevoked(chainId: string): Promise<boolean> {
    const state = await chainState(chainId);
    if (state === null) throw new Error('D1 refresh chain missing');
    return state;
  }
  async function chainState(chainId: string): Promise<boolean | null> {
    const row = await db.prepare('SELECT revokedAtMs FROM AgentLinkOAuthRefreshChain WHERE issuer=? AND chainId=?')
      .bind(issuer, chainId).first<{ revokedAtMs: number | null }>();
    if (!row) return null;
    return row.revokedAtMs !== null;
  }

  async function rotate(token: string, clientId: string, resource: string, nowMs: number): Promise<RotateResult> {
    const hash = await hashSecret(token);
    const parent = await read(hash);
    if (!parent) return { status: 'unknown' };
    const record = { userId: parent.userId, clientId: parent.clientId, scope: parent.scope, resource: parent.resource, chainId: parent.chainId };
    if (parent.revokedAtMs !== null) return { status: 'revoked', record };
    if (clientId !== parent.clientId) { await revoke(parent.chainId, nowMs); return { status: 'client_mismatch', record }; }
    if (resource !== parent.resource) return { status: 'resource_mismatch', record };
    if (parent.usedAtMs !== null) return retryOrRevoke(parent, record, nowMs);
    if (parent.expiresAtMs <= nowMs) return { status: 'expired', record };

    const refreshToken = randomToken();
    const accessToken = randomToken();
    const successorHash = await hashSecret(refreshToken);
    const nonce = randomToken(16);
    const pair: RefreshPair = { accessToken, refreshToken, accessExpiresAtMs: nowMs + ACCESS_TOKEN_TTL_SECONDS * 1000, scope: parent.scope, record };
    const receipt = await seal(secret, aad(parent), pair);
    const expiry = nowMs + REFRESH_TOKEN_TTL_SECONDS * 1000;
    const results = await db.batch([
      db.prepare(`UPDATE AgentLinkOAuthRefreshToken SET usedAtMs=?, successorHash=?, rotationNonce=?,
          receiptCiphertext=?, receiptIv=?, receiptExpiresAtMs=?
        WHERE issuer=? AND tokenHash=? AND usedAtMs IS NULL AND expiresAtMs>? AND EXISTS
          (SELECT 1 FROM AgentLinkOAuthRefreshChain c WHERE c.issuer=? AND c.chainId=AgentLinkOAuthRefreshToken.chainId AND c.revokedAtMs IS NULL)`)
        .bind(nowMs, successorHash, nonce, receipt.ciphertext, receipt.iv, nowMs + RETRY_MS,
          issuer, hash, nowMs, issuer),
      db.prepare(`INSERT INTO AgentLinkOAuthRefreshToken
          (issuer,tokenHash,chainId,userId,clientId,scope,resource,expiresAtMs,legacyLineage)
        SELECT issuer,?,chainId,userId,clientId,scope,resource,?,legacyLineage
        FROM AgentLinkOAuthRefreshToken WHERE issuer=? AND tokenHash=? AND rotationNonce=?`)
        .bind(successorHash, expiry, issuer, hash, nonce),
      db.prepare(`UPDATE AgentLinkOAuthRefreshChain SET expiresAtMs=max(expiresAtMs,?)
        WHERE issuer=? AND chainId=? AND EXISTS
          (SELECT 1 FROM AgentLinkOAuthRefreshToken WHERE issuer=? AND tokenHash=? AND rotationNonce=?)`)
        .bind(expiry, issuer, parent.chainId, issuer, hash, nonce),
    ]);
    if (results.some((result) => !result.success)) throw new Error('D1 refresh rotation failed');
    if (results[0].meta.changes === 1 && results[1].meta.changes === 1) return { status: 'rotated', pair };
    const winner = await read(hash);
    if (!winner) throw new Error('D1 refresh parent disappeared');
    return retryOrRevoke(winner, record, nowMs);
  }

  async function retryOrRevoke(parent: Row, record: RefreshPair['record'], nowMs: number): Promise<RotateResult> {
    if (parent.revokedAtMs !== null) return { status: 'revoked', record };
    const age = nowMs - (parent.usedAtMs ?? nowMs);
    if (age >= RETRY_MS || !parent.receiptCiphertext || !parent.receiptIv || !parent.receiptExpiresAtMs || nowMs >= parent.receiptExpiresAtMs) {
      await revoke(parent.chainId, nowMs);
      return { status: 'reused', record, reuseAgeMs: age };
    }
    if (!parent.successorHash) throw new Error('D1 refresh successor missing');
    const successor = await read(parent.successorHash);
    if (!successor) throw new Error('D1 refresh successor missing');
    if (successor.revokedAtMs !== null) return { status: 'revoked', record };
    if (successor.usedAtMs !== null) return { status: 'advanced', record, reuseAgeMs: age };
    const pair = await unseal(secret, aad(parent), parent.receiptCiphertext, parent.receiptIv);
    if (pair.accessExpiresAtMs <= nowMs) return { status: 'advanced', record, reuseAgeMs: age };
    return { status: 'retried', pair, reuseAgeMs: age };
  }
  return { issue, importLegacy, inspect, rotate, revoke, isRevoked, chainState };
}
export type RefreshLedger = ReturnType<typeof createRefreshLedger>;
