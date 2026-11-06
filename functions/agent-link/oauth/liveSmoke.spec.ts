// A live, opt-in smoke test of the headless credential path.
//
// The unit suites prove every branch against fakes. This proves the one thing
// they cannot: that a grant a real user really consented to still works —
// that it decrypts with the deployed secret, refreshes when stale, and reads
// Confluence through the api.atlassian.com gateway as that user.
//
// It is SKIPPED unless AGENT_LINK_OAUTH_LIVE=1, because it needs a grant, the
// client secret, and the network. Run it after completing the flow locally:
//
//   pnpm exec wrangler pages dev dist --port 8080 --kv OAUTH_GRANT_KV \
//     --binding ATLASSIAN_OAUTH_CLIENT_ID=<id> --persist-to .wrangler/state-oauth
//   # visit http://localhost:8080/agent-link/oauth/authorize, consent
//   AGENT_LINK_OAUTH_LIVE=1 pnpm exec vitest run functions/agent-link/oauth/liveSmoke.spec.ts
//
// It reads the grant out of the SAME local KV the dev server wrote, via
// wrangler's CLI, and the secrets out of .dev.vars — so no secret is ever
// passed on a command line or printed. It never writes to a remote namespace:
// a staging grant is sealed with staging's OAUTH_GRANT_SECRET and is by
// design undecryptable from a laptop.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { getAccessToken, grantKey, type GrantStore } from './tokenStore';
import { listAccessibleSites, type AtlassianAppConfig, type FetchLike } from './atlassianClient';
import { confluenceReaderFor } from './confluenceReader';
import { resolveMacroIdentity } from '../macroIdentity';

const LIVE = process.env.AGENT_LINK_OAUTH_LIVE === '1';
const REPO = resolve(__dirname, '../../..');
const PERSIST = '.wrangler/state-oauth';
const LOCAL_NAMESPACE = 'OAUTH_GRANT_KV';

/** .dev.vars is gitignored and holds the local secrets; parsed, never logged. */
function devVars(): Record<string, string> {
  const path = resolve(REPO, '.dev.vars');
  if (!existsSync(path)) throw new Error('.dev.vars not found — see docs/agent-link/headless-oauth-testing.md');
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function wrangler(args: string[], input?: string): string {
  return execFileSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd: REPO,
    input,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
}

/** A GrantStore backed by the dev server's own local KV, so a refresh persists where the Worker would put it. */
function localKvStore(): GrantStore {
  const ns = ['--namespace-id', LOCAL_NAMESPACE, '--local', '--persist-to', PERSIST];
  return {
    get: async (key) => {
      try {
        return wrangler(['kv', 'key', 'get', key, ...ns]);
      } catch {
        return null;
      }
    },
    put: async (key, value) => {
      // Via a temp file, not the command line: wrangler has no stdin mode that
      // works on Windows (/dev/stdin is not a path there). The value is the
      // AES-GCM-sealed record, but it is still deleted immediately.
      const tmp = join(tmpdir(), `agent-link-grant-${randomUUID()}.json`);
      try {
        writeFileSync(tmp, value, 'utf8');
        wrangler(['kv', 'key', 'put', key, '--path', tmp, ...ns]);
      } finally {
        rmSync(tmp, { force: true });
      }
    },
    delete: async (key) => {
      wrangler(['kv', 'key', 'delete', key, ...ns]);
    },
  };
}

function firstGrantUserId(): string {
  const rows = JSON.parse(
    wrangler(['kv', 'key', 'list', '--namespace-id', LOCAL_NAMESPACE, '--local', '--persist-to', PERSIST]),
  ) as Array<{ name: string }>;
  const prefix = grantKey('');
  const row = rows.find((r) => r.name.startsWith(prefix));
  if (!row) throw new Error('no grant in the local KV — complete the consent flow first');
  return row.name.slice(prefix.length);
}

// Each test shells out to wrangler and talks to Atlassian; the default 5s
// timeout is for unit tests, not for this.
const LIVE_TIMEOUT_MS = 120_000;

describe.skipIf(!LIVE)('headless OAuth, against real Atlassian', () => {
  const vars = LIVE ? devVars() : ({} as Record<string, string>);
  const store = localKvStore();
  const fetchImpl: FetchLike = (url, init) => fetch(url, init);
  const app: AtlassianAppConfig = {
    clientId: process.env.ATLASSIAN_OAUTH_CLIENT_ID ?? vars.ATLASSIAN_OAUTH_CLIENT_ID ?? '',
    clientSecret: vars.ATLASSIAN_OAUTH_CLIENT_SECRET ?? '',
    // Only used by a refresh, which Atlassian does not redirect — any
    // registered value is accepted, and this one always is.
    redirectUri: 'http://localhost:8080/agent-link/oauth/callback',
  };

  it('decrypts the stored grant and gets a usable access token', async () => {
    const userId = firstGrantUserId();
    const token = await getAccessToken(store, vars.OAUTH_GRANT_SECRET, app, fetchImpl, userId);
    expect(token.ok, `getAccessToken failed: ${JSON.stringify(token)}`).toBe(true);
    if (!token.ok) return;
    expect(token.accessToken.length).toBeGreaterThan(20);
    // Whether it refreshed depends on how old the grant is; both are correct.
    console.log(`access token obtained (refreshed: ${token.refreshed})`);
  }, LIVE_TIMEOUT_MS);

  it('reads Confluence as the user through the api.atlassian.com gateway', async () => {
    const userId = firstGrantUserId();
    const token = await getAccessToken(store, vars.OAUTH_GRANT_SECRET, app, fetchImpl, userId);
    if (!token.ok) throw new Error(`no access token: ${JSON.stringify(token)}`);

    const sites = await listAccessibleSites(fetchImpl, token.accessToken);
    expect(sites.ok, `accessible-resources failed: ${JSON.stringify(sites)}`).toBe(true);
    if (!sites.ok) return;
    expect(sites.sites.length).toBeGreaterThan(0);
    console.log('sites:', sites.sites.map((s) => s.url).join(', '));

    const site = sites.sites[0];
    const get = confluenceReaderFor({
      store,
      secret: vars.OAUTH_GRANT_SECRET,
      app,
      fetchImpl,
      userId,
      cloudId: site.cloudId,
    });

    // Pages, not spaces: /wiki/api/v2/spaces needs read:space:confluence,
    // which we deliberately do not request, and answers 401 "scope does not
    // match" — which reads like a broken token but is not. This endpoint is
    // covered by read:page:confluence, so a 200 proves both the gateway
    // routing and that the granted scopes are the ones the writer needs.
    const pages = await get('/wiki/api/v2/pages?limit=1');
    expect(pages.status, `pages read: ${JSON.stringify(pages.body).slice(0, 200)}`).toBe(200);
  }, LIVE_TIMEOUT_MS);

  it('resolves which ZenUML variant the site runs, the way the headless writer will', async () => {
    const userId = firstGrantUserId();
    const token = await getAccessToken(store, vars.OAUTH_GRANT_SECRET, app, fetchImpl, userId);
    if (!token.ok) throw new Error(`no access token: ${JSON.stringify(token)}`);
    const sites = await listAccessibleSites(fetchImpl, token.accessToken);
    if (!sites.ok || sites.sites.length === 0) throw new Error('no accessible sites');

    const get = confluenceReaderFor({
      store,
      secret: vars.OAUTH_GRANT_SECRET,
      app,
      fetchImpl,
      userId,
      cloudId: sites.sites[0].cloudId,
    });

    // Phase 1's resolver, now on a real credential instead of the hand-driven
    // probe it was written against. 'no_macro_on_site' is a legitimate answer
    // on a site with no diagrams; a probe failure is not.
    const identity = await resolveMacroIdentity(get);
    console.log('macro identity:', JSON.stringify(identity));
    expect(identity.ok || identity.reason === 'no_macro_on_site').toBe(true);
  }, LIVE_TIMEOUT_MS);
});
