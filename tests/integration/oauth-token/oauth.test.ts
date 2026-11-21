import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { hashSecret, issueCode, issueRefreshToken, revokeChain, saveClient } from '../../../functions/agent-link/oauth/asStore';
import { challengeFor } from '../../../functions/agent-link/oauth/pkce';

const verifier = 'a'.repeat(64);
const redirect = 'http://localhost:3333/callback';
const clientId = 'local-client';
const userId = 'local-user';
let dir: string;
let bundle: string;
let runtime: Miniflare;
let base: string;
let compatibilityDate: string;
let compatibilityFlags: string[];
let db: Awaited<ReturnType<Miniflare['getD1Database']>>;
let kv: Awaited<ReturnType<Miniflare['getKVNamespace']>>;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No local port');
  await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
  return address.port;
}

async function start(withDb = true) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const mf = new Miniflare({
    modules: true, modulesRoot: dir, scriptPath: bundle, // Match wrangler-stg.toml.
    compatibilityDate, compatibilityFlags, port,
    outboundService: { network: { deny: ['0.0.0.0/0', '::/0'] } },
    kvNamespaces: ['OAUTH_GRANT_KV'],
    ...(withDb ? { d1Databases: ['DB'] } : {}),
    bindings: {
      OAUTH_GRANT_SECRET: 'local-test-secret', ATLASSIAN_OAUTH_CLIENT_ID: 'local',
      ATLASSIAN_OAUTH_CLIENT_SECRET: 'local', ATLASSIAN_OAUTH_REDIRECT_URI: `${origin}/agent-link/oauth/callback`,
    },
  });
  try { await mf.ready; } catch (error) { await mf.dispose(); throw error; }
  return { mf, origin };
}

async function post(path: string, body: Record<string, string>, origin = base) {
  const response = await fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  return { response, body: await response.json() as Record<string, any> };
}
async function mcp(token: string, origin = base) {
  const response = await fetch(`${origin}/agent-link/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  return { response, body: await response.json() as Record<string, any> };
}
async function code() {
  return issueCode(kv, { clientId, redirectUri: redirect, codeChallenge: await challengeFor(verifier), scope: 'diagram.read', resource: `${base}/agent-link/mcp`, userId, createdAtMs: Date.now() });
}
async function exchange(overrides: Record<string, string> = {}) {
  return post('/agent-link/oauth/token', { grant_type: 'authorization_code', code: await code(), code_verifier: verifier, client_id: clientId, redirect_uri: redirect, ...overrides });
}
async function refresh(token: string, client = clientId) {
  return post('/agent-link/oauth/token', { grant_type: 'refresh_token', refresh_token: token, client_id: client });
}
async function expectMcp(token: string, status: number) {
  const result = await mcp(token);
  expect(result.response.status).toBe(status);
  if (status === 200) expect(result.body.result.tools.length).toBeGreaterThan(0);
  else expect(result.response.headers.get('www-authenticate')).toContain('Bearer');
}

beforeAll(async () => {
  const wrangler = await readFile('wrangler-stg.toml', 'utf8');
  compatibilityDate = wrangler.match(/^compatibility_date\s*=\s*"([^"]+)"/m)?.[1] ?? '';
  const flags = wrangler.match(/^compatibility_flags\s*=\s*\[([^\]]*)\]/m)?.[1] ?? '';
  compatibilityFlags = [...flags.matchAll(/"([^"]+)"/g)].map(match => match[1]);
  expect(compatibilityDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(compatibilityFlags).toContain('nodejs_compat');
  const routes = JSON.parse(await readFile('public/_routes.json', 'utf8')) as { include: string[]; exclude: string[] };
  expect(routes.include).toContain('/agent-link/*');
  const matches = (pattern: string, path: string) => pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : pattern === path;
  for (const path of ['/agent-link/oauth/token', '/agent-link/mcp']) {
    expect(routes.include.some((pattern) => matches(pattern, path))).toBe(true);
    expect(routes.exclude.some((pattern) => matches(pattern, path))).toBe(false);
  }
  dir = await mkdtemp(join(tmpdir(), 'oauth-http-'));
  bundle = join(dir, 'index.js');
  execFileSync(resolve('node_modules/.bin/wrangler'), ['pages', 'functions', 'build', 'functions', '--outdir', dir], { stdio: 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  ({ mf: runtime, origin: base } = await start());
  db = await runtime.getD1Database('DB');
  kv = await runtime.getKVNamespace('OAUTH_GRANT_KV');
  // Apply the production migration that owns the refresh ledger tables.
  for (const file of ['0032_agent_link_oauth_refresh_ledger.sql']) {
    const sql = (await readFile(join('functions/migrations', file), 'utf8')).replace(/^\s*--.*$/gm, '');
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
});
afterAll(async () => { await runtime?.dispose(); if (dir) await rm(dir, { recursive: true, force: true }); });
beforeEach(async () => {
  await db.prepare('DELETE FROM AgentLinkOAuthRefreshToken').run();
  await db.prepare('DELETE FROM AgentLinkOAuthRefreshChain').run();
  for (const key of (await kv.list()).keys) await kv.delete(key.name);
  await saveClient(kv, { clientId, redirectUris: [redirect], createdAtMs: Date.now() });
});

describe('OAuth through Pages HTTP and local D1/KV', () => {
  it('exchanges a code and authorizes a real MCP tools/list request', async () => {
    const result = await exchange();
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get('cache-control')).toContain('no-store');
    expect(result.body.token_type).toBe('Bearer');
    expect(result.body.expires_in).toBe(3600);
    expect(result.body.access_token).toBeTruthy();
    expect(result.body.refresh_token).toBeTruthy();
    await expectMcp(result.body.access_token, 200);
  });
  it.each([
    ['PKCE', { code_verifier: 'b'.repeat(64) }],
    ['client', { client_id: 'other-client' }],
    ['redirect', { redirect_uri: 'http://localhost:3333/other' }],
  ])('rejects incorrect %s', async (_, overrides) => {
    const result = await exchange(overrides);
    expect(result.response.status).toBe(400);
    expect(result.body.error).toBe('invalid_grant');
    expect(result.body.access_token).toBeUndefined();
  });
  it('rejects a consumed code', async () => {
    const issued = await code();
    const params = { grant_type: 'authorization_code', code: issued, code_verifier: verifier, client_id: clientId, redirect_uri: redirect };
    const first = await post('/agent-link/oauth/token', params);
    expect(first.response.status).toBe(200);
    const second = await post('/agent-link/oauth/token', params);
    expect(second.response.status).toBe(400);
    expect(second.body.error).toBe('invalid_grant');
    expect(second.body.access_token).toBeUndefined();
    await expectMcp(first.body.access_token, 200);
  });
  it('rotates and returns the same pair on a retry within five minutes', async () => {
    const initial = await exchange();
    const next = await refresh(initial.body.refresh_token);
    const retry = await refresh(initial.body.refresh_token);
    expect(next.response.status).toBe(200);
    expect(retry.response.status).toBe(200);
    expect(next.body.refresh_token !== initial.body.refresh_token).toBe(true);
    expect(retry.body.access_token === next.body.access_token).toBe(true);
    expect(retry.body.refresh_token === next.body.refresh_token).toBe(true);
    await expectMcp(initial.body.access_token, 200);
    await expectMcp(next.body.access_token, 200);
  });
  it.each(['expired retry', 'cross-client'])('%s revokes both access tokens', async (kind) => {
    const initial = await exchange();
    const next = await refresh(initial.body.refresh_token);
    expect(next.response.status).toBe(200);
    if (kind === 'expired retry') {
      await db.prepare('UPDATE AgentLinkOAuthRefreshToken SET usedAtMs = ?, receiptExpiresAtMs = ? WHERE usedAtMs IS NOT NULL').bind(Date.now() - 301000, Date.now() - 1000).run();
    }
    const replay = await refresh(initial.body.refresh_token, kind === 'cross-client' ? 'other-client' : clientId);
    expect(replay.response.status).toBe(400);
    expect(replay.body.error).toBe('invalid_grant');
    expect(replay.body.access_token).toBeUndefined();
    await expectMcp(initial.body.access_token, 401);
    await expectMcp(next.body.access_token, 401);
  });
  it.each(['active', 'used', 'revoked'])('legacy %s token is handled without revival', async (state) => {
    const chainId = `legacy-${state}`;
    const token = await issueRefreshToken(kv, { userId, clientId, scope: 'diagram.read', resource: `${base}/agent-link/mcp`, chainId, ...(state === 'used' ? { usedAtMs: Date.now() - 1000 } : {}) });
    if (state === 'revoked') await revokeChain(kv, chainId, Date.now());
    const result = await refresh(token);
    expect(result.response.status).toBe(state === 'active' ? 200 : 400);
    if (state === 'active') {
      await expectMcp(result.body.access_token, 200);
      const imported = await db.prepare('SELECT legacy, legacyLineage FROM AgentLinkOAuthRefreshToken WHERE tokenHash = ?').bind(await hashSecret(token)).first<{ legacy: number; legacyLineage: number }>();
      expect(imported).toEqual({ legacy: 1, legacyLineage: 1 });
      const successor = await db.prepare('SELECT legacyLineage FROM AgentLinkOAuthRefreshToken WHERE tokenHash = ?').bind(await hashSecret(result.body.refresh_token)).first<{ legacyLineage: number }>();
      expect(successor).toEqual({ legacyLineage: 1 });
      const next = await refresh(result.body.refresh_token);
      expect(next.response.status).toBe(200);
      await expectMcp(next.body.access_token, 200);
      await db.prepare('UPDATE AgentLinkOAuthRefreshToken SET usedAtMs = ?, receiptExpiresAtMs = ? WHERE tokenHash = ?').bind(Date.now() - 301000, Date.now() - 1000, await hashSecret(token)).run();
      const replay = await refresh(token);
      expect(replay.response.status).toBe(400);
      expect(replay.body.error).toBe('invalid_grant');
      await expectMcp(result.body.access_token, 401);
      await expectMcp(next.body.access_token, 401);
    }
    else { expect(result.body.error).toBe('invalid_grant'); expect(result.body.access_token).toBeUndefined(); }
  });
  it('returns 503 when the actual D1 operation fails and leaves the existing token usable after recovery', async () => {
    const initial = await exchange();
    await db.prepare('ALTER TABLE AgentLinkOAuthRefreshToken RENAME TO BrokenRefreshToken').run();
    try {
      const result = await refresh(initial.body.refresh_token);
      expect(result.response.status).toBe(503);
      expect(result.body.error).toBe('temporarily_unavailable');
      expect(result.body.access_token).toBeUndefined();
    } finally { await db.prepare('ALTER TABLE BrokenRefreshToken RENAME TO AgentLinkOAuthRefreshToken').run(); }
    await expectMcp(initial.body.access_token, 200);
  });
  it('returns 503 on an actual D1 rotation write failure and recovers on retry', async () => {
    const initial = await exchange();
    expect(initial.response.status).toBe(200);
    await db.prepare(`CREATE TRIGGER fail_rotation BEFORE UPDATE ON AgentLinkOAuthRefreshToken BEGIN SELECT RAISE(ABORT, 'local write failure'); END`).run();
    try {
      const failed = await refresh(initial.body.refresh_token);
      expect(failed.response.status).toBe(503);
      expect(failed.body.error).toBe('temporarily_unavailable');
      expect(failed.body.access_token).toBeUndefined();
      expect(failed.body.refresh_token).toBeUndefined();
    } finally { await db.prepare('DROP TRIGGER fail_rotation').run(); }
    await expectMcp(initial.body.access_token, 200);
    const recovered = await refresh(initial.body.refresh_token);
    expect(recovered.response.status).toBe(200);
    await expectMcp(recovered.body.access_token, 200);
  });
  it('returns 503 when D1 is absent', async () => {
    const { mf, origin } = await start(false);
    try {
      const result = await post('/agent-link/oauth/token', { grant_type: 'refresh_token', refresh_token: 'fake', client_id: clientId }, origin);
      expect(result.response.status).toBe(503);
      expect(result.body.error).toBe('temporarily_unavailable');
      expect(result.body.access_token).toBeUndefined();
      const mcpResult = await mcp('local-unknown-token', origin);
      expect(mcpResult.response.status).toBe(503);
    } finally { await mf.dispose(); }
  });
});
