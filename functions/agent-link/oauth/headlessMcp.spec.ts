import { describe, it, expect } from 'vitest';
import { handleHeadlessRpc, looksLikeRelayToken, clientDeclaresUi } from './headlessMcp';
import { authenticateHeadless, challengeFor } from './headlessAuth';
import { issueAccessToken, type GrantStoreLike } from './asStore';
import { saveGrant } from './tokenStore';
import { resourceFor } from './asMetadata';
import type { FetchLike } from './atlassianClient';

const ORIGIN = 'https://conf-stg-lite.zenuml.com';
const MCP = `${ORIGIN}/agent-link/mcp`;
const ACCOUNT = '712020:abc';

function makeEnv() {
  const kv = new Map<string, string>();
  const store: GrantStoreLike = {
    get: async (k) => kv.get(k) ?? null,
    put: async (k, v) => { kv.set(k, v); },
    delete: async (k) => { kv.delete(k); },
  };
  return {
    kv,
    store,
    env: {
      ATLASSIAN_OAUTH_CLIENT_ID: 'client-id',
      ATLASSIAN_OAUTH_CLIENT_SECRET: 'client-secret',
      ATLASSIAN_OAUTH_REDIRECT_URI: 'https://conf-stg-lite.zenuml.com/agent-link/oauth/callback',
      OAUTH_GRANT_KV: store,
      OAUTH_GRANT_SECRET: 'grant-key',
    },
  };
}

/** Atlassian as the headless tools see it: a live grant, one site, one diagram. */
function atlassianFetch(overrides: Partial<Record<'sites' | 'customContent' | 'content', () => Response>> = {}) {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    if (url === 'https://api.atlassian.com/oauth/token/accessible-resources') {
      return (overrides.sites ??
        (() => json(200, [{ id: 'cloud-1', name: 'One', url: 'https://one.atlassian.net', scopes: [] }])))();
    }
    if (url.includes('/custom-content?type=')) {
      // macroIdentity's variant probe: one Lite row with a real extensionKey.
      return json(200, {
        results: [
          {
            id: 'cc-1',
            type: 'ac:com-zenuml-confluence-plugin:zenuml-content',
            title: 'Diagram',
            pageId: 'page-1',
          },
        ],
      });
    }
    if (url.includes('/pages/page-1/custom-content') || url.endsWith('/custom-content?limit=25')) {
      return (overrides.customContent ??
        (() => json(200, { results: [{ id: 'cc-1', title: 'Checkout', type: 'ac:x:zenuml', version: { createdAt: '2026-09-01T00:00:00Z' }, pageId: 'page-1' }] })))();
    }
    if (url.includes('/custom-content/cc-1')) {
      return (overrides.content ??
        (() => json(200, { id: 'cc-1', title: 'Checkout', type: 'ac:x:zenuml', version: { number: 7 }, body: { raw: { value: 'A.method()' } } })))();
    }
    return new Response(`unexpected ${url}`, { status: 500 });
  };
  return { fetchImpl, calls };
}

async function tokenFor(store: GrantStoreLike, scope = 'diagram.read diagram.write', resource = resourceFor(ORIGIN)) {
  const { token } = await issueAccessToken(
    store,
    { userId: ACCOUNT, clientId: 'client-A', scope, resource },
    Date.now(),
  );
  return token;
}

function rpc(token: string | null, method: string, params?: unknown) {
  return new Request(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

async function call(env: ReturnType<typeof makeEnv>, token: string | null, method: string, params?: unknown, fetchImpl?: FetchLike) {
  const request = rpc(token, method, params);
  const body = await request.clone().json();
  return handleHeadlessRpc(request, env.env, body, { fetchImpl: fetchImpl ?? atlassianFetch().fetchImpl });
}

describe('mode selection', () => {
  it('recognises the relay token shape and nothing else', () => {
    expect(looksLikeRelayToken('CL-7F3K-Q9M2')).toBe(true);
    expect(looksLikeRelayToken('1OVj1UU5sJb0pQ')).toBe(false);
    expect(looksLikeRelayToken(null)).toBe(false);
  });
});

describe('headless authentication', () => {
  it('challenges an unauthenticated call with the resource metadata URL', async () => {
    const env = makeEnv();
    const res = await call(env, null, 'tools/list');
    expect(res.status).toBe(401);
    const challenge = res.headers.get('WWW-Authenticate')!;
    expect(challenge).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`);
    // "you need a token" is not an error about a token
    expect(challenge).not.toContain('error=');
  });

  it('rejects a token it never issued, with error=invalid_token', async () => {
    const env = makeEnv();
    const res = await call(env, 'not-a-real-token', 'tools/list');
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('error="invalid_token"');
  });

  it('refuses a token minted for a different resource', async () => {
    const env = makeEnv();
    const token = await tokenFor(env.store, 'diagram.read', 'https://other.zenuml.com/agent-link/mcp');
    const res = await call(env, token, 'tools/list');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { data: { code: string } } };
    expect(body.error.data.code).toBe('wrong_audience');
  });

  it('accepts a token we issued for this resource', async () => {
    const env = makeEnv();
    const token = await tokenFor(env.store);
    const res = await authenticateHeadless(new Request(MCP, { headers: { authorization: `Bearer ${token}` } }), env.store);
    expect(res.ok).toBe(true);
  });

  it('reads the token from the header only, never the query string', async () => {
    const env = makeEnv();
    const token = await tokenFor(env.store);
    const res = await authenticateHeadless(new Request(`${MCP}?token=${token}`), env.store);
    expect(res.ok).toBe(false);
  });

  it('says so plainly when headless mode is not configured', async () => {
    const env = makeEnv();
    const res = await handleHeadlessRpc(rpc(null, 'tools/list'), { ...env.env, OAUTH_GRANT_KV: undefined }, { id: 1, method: 'tools/list' });
    expect(res.status).toBe(503);
  });
});

describe('headless RPC', () => {
  it('advertises the read tools and every write tool', async () => {
    const env = makeEnv();
    const token = await tokenFor(env.store);
    const res = await call(env, token, 'tools/list');
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    const names = body.result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'create_diagram',
      'create_page',
      'get_status',
      'list_diagrams',
      'list_sites',
      'read_diagram',
      'read_page',
      'update_diagram',
      'update_page',
    ]);
  });

  it('answers initialize without an Atlassian round trip', async () => {
    const env = makeEnv();
    const token = await tokenFor(env.store);
    const { fetchImpl, calls } = atlassianFetch();
    const res = await call(env, token, 'initialize', undefined, fetchImpl);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it('declares the MCP Apps extension so a host knows a view exists', async () => {
    // Bilateral: if we never declare it, the host still gets a good text result
    // and the missing view looks like a broken render with no error anywhere.
    const env = makeEnv();
    const token = await tokenFor(env.store);
    const res = await call(env, token, 'initialize');
    const body = await res.json();
    expect(body.result.capabilities.extensions).toEqual({
      'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] },
    });
    // resources exists only to serve that view, so the two travel together.
    expect(body.result.capabilities.resources).toEqual({});
  });

  it('carries _meta.ui on the diagram tools, pinned to this deploy origin', async () => {
    const env = makeEnv();
    const token = await tokenFor(env.store);
    const res = await call(env, token, 'tools/list');
    const body = await res.json();
    const byName = Object.fromEntries(body.result.tools.map((t: { name: string }) => [t.name, t]));
    expect(byName.read_diagram._meta.ui.resourceUri).toBe('ui://zenuml/diagram');
    // The csp lives on the RESOURCE, not the tool — asserting it here is what
    // let the real misplacement pass. resources/list and resources/read carry it.
    expect(byName.read_diagram._meta.ui.csp).toBeUndefined();
    expect(byName.list_diagrams).not.toHaveProperty('_meta');
  });

  it('carries the csp on the listed resource, pinned to this deploy origin', async () => {
    const env = makeEnv();
    const token = await tokenFor(env.store);
    const res = await call(env, token, 'resources/list');
    const body = await res.json();
    expect(body.result.resources[0]._meta.ui.csp.resourceDomains).toEqual([new URL(MCP).origin]);
  });

  it('lists the view as a resource', async () => {
    const env = makeEnv();
    const token = await tokenFor(env.store);
    const res = await call(env, token, 'resources/list');
    const body = await res.json();
    expect(body.result.resources).toHaveLength(1);
    expect(body.result.resources[0].uri).toBe('ui://zenuml/diagram');
  });

  it('serves the built view for resources/read', async () => {
    const env = makeEnv();
    const token = await tokenFor(env.store);
    // The marker is what tells readUiResource this is the view and not the
    // SPA shell Pages serves for an unknown path.
    const html =
      '<!doctype html><html><head><meta name="mcp-app" content="zenuml-diagram"></head>' +
      '<body><div id="app"></div><script src="./assets/v.js"></script></body></html>';
    const res = await call(env, token, 'resources/read', { uri: 'ui://zenuml/diagram' }, async () =>
      new Response(html, { status: 200 }));
    const body = await res.json();
    const served = body.result.contents[0];
    expect(served.uri).toBe('ui://zenuml/diagram');
    expect(served.mimeType).toBe('text/html;profile=mcp-app');
    // The base is what makes the built bundle's relative src resolve against us
    // instead of the host's frame, where it would silently fetch nothing.
    expect(served.text).toContain(`<base href="${new URL(MCP).origin}/">`);
    expect(served.text).toContain('src="./assets/v.js"');
  });

  it('rejects a resources/read for a URI it does not publish', async () => {
    const env = makeEnv();
    const token = await tokenFor(env.store);
    const res = await call(env, token, 'resources/read', { uri: 'ui://elsewhere/x' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.data.reason).toBe('unknown_uri');
  });

  it('reports a missing view asset in a 200 the client can actually read', async () => {
    // Ours to fix, not the host's — a deploy that shipped without the entry.
    // The status is deliberately NOT 502: Cloudflare replaces a 502 from a
    // Pages Function with its own plain-text error page, and the client then
    // sees "error code: 502" instead of the reason (staging, 2026-09-29).
    const env = makeEnv();
    const token = await tokenFor(env.store);
    const res = await call(env, token, 'resources/read', { uri: 'ui://zenuml/diagram' }, async () =>
      new Response('', { status: 404 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error.data.reason).toBe('fetch_failed');
    expect(body.error.code).toBe(-32003);
  });

  it('still requires a token for the view', async () => {
    const env = makeEnv();
    const res = await call(env, null, 'resources/read', { uri: 'ui://zenuml/diagram' });
    expect(res.status).toBe(401);
  });

  it('acknowledges notifications with 202 and no body', async () => {
    const env = makeEnv();
    const token = await tokenFor(env.store);
    const res = await call(env, token, 'notifications/initialized');
    expect(res.status).toBe(202);
  });

  it('lists the sites the grant reaches', async () => {
    const env = makeEnv();
    await saveGrant(env.store, 'grant-key', ACCOUNT, {
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAtMs: Date.now() + 3_600_000,
      scope: 'read:page:confluence',
    });
    const token = await tokenFor(env.store);
    const res = await call(env, token, 'tools/call', { name: 'list_sites', arguments: {} });
    const body = (await res.json()) as { result: { structuredContent: { sites: Array<{ cloudId: string }> } } };
    expect(body.result.structuredContent.sites[0].cloudId).toBe('cloud-1');
  });

  it('reads a diagram and surfaces the version an update would need', async () => {
    const env = makeEnv();
    await saveGrant(env.store, 'grant-key', ACCOUNT, {
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAtMs: Date.now() + 3_600_000,
      scope: 'read:page:confluence',
    });
    const token = await tokenFor(env.store);
    const res = await call(env, token, 'tools/call', { name: 'read_diagram', arguments: { cloudId: 'cloud-1', contentId: 'cc-1' } });
    const body = (await res.json()) as { result: { structuredContent: { source: string; version: number } } };
    expect(body.result.structuredContent.source).toBe('A.method()');
    expect(body.result.structuredContent.version).toBe(7);
  });

  it('refuses a cloudId the user cannot reach, before calling Confluence', async () => {
    const env = makeEnv();
    await saveGrant(env.store, 'grant-key', ACCOUNT, {
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAtMs: Date.now() + 3_600_000,
      scope: 'read:page:confluence',
    });
    const token = await tokenFor(env.store);
    const { fetchImpl, calls } = atlassianFetch();
    const res = await call(env, token, 'tools/call', { name: 'read_diagram', arguments: { cloudId: 'someone-elses-cloud', contentId: 'cc-1' } }, fetchImpl);
    const body = (await res.json()) as { error: { data: { code: string } } };
    expect(body.error.data.code).toBe('unknown_site');
    expect(calls.some((c) => c.includes('/ex/confluence/someone-elses-cloud'))).toBe(false);
  });

  it('tells the user to authorize again when the grant is gone', async () => {
    const env = makeEnv();
    const token = await tokenFor(env.store); // no grant saved for ACCOUNT
    const res = await call(env, token, 'tools/call', { name: 'list_sites', arguments: {} });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata');
  });

  it('rejects an unknown tool without touching Atlassian', async () => {
    const env = makeEnv();
    const token = await tokenFor(env.store);
    const { fetchImpl, calls } = atlassianFetch();
    const res = await call(env, token, 'tools/call', { name: 'delete_everything', arguments: {} }, fetchImpl);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32601);
    expect(calls).toHaveLength(0);
  });

  it('refuses a token that was not granted read scope', async () => {
    const env = makeEnv();
    const token = await tokenFor(env.store, 'diagram.write');
    const res = await call(env, token, 'tools/call', { name: 'list_sites', arguments: {} });
    expect(res.status).toBe(403);
  });
});

describe('challenge construction', () => {
  it('names the metadata document for this origin', () => {
    expect(challengeFor(MCP, 'missing')).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`,
    );
  });
});

/**
 * The handshake itself. Before this, initialize answered a hardcoded
 * '2024-11-05' however new the client was, which is the wrong end of a
 * negotiation for a server whose whole point here is an extension defined in a
 * much later revision.
 */
describe('initialize', () => {
  it('echoes a protocol version it supports rather than pinning 2024-11-05', async () => {
    const env = makeEnv();
    const token = await tokenFor(env.store);
    const res = await call(env, token, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } },
      clientInfo: { name: 'probe', version: '1' },
    });
    const body = await res.json();
    expect(body.result.protocolVersion).toBe('2025-06-18');
  });

  it('falls back to its newest when the client asks for one it does not know', async () => {
    const env = makeEnv();
    const token = await tokenFor(env.store);
    const res = await call(env, token, 'initialize', { protocolVersion: '1999-01-01' });
    const body = await res.json();
    expect(body.result.protocolVersion).toBe('2025-06-18');
  });

  // The regression that broke every connection: '2026-01-26' is the MCP Apps
  // EXTENSION spec date, not a protocol revision. Answering it told clients to
  // speak something that does not exist.
  it('never answers an extension-spec date as a protocol version', async () => {
    const env = makeEnv();
    const token = await tokenFor(env.store);
    for (const asked of ['2026-01-26', undefined, '1999-01-01']) {
      const res = await call(env, token, 'initialize', asked ? { protocolVersion: asked } : {});
      const body = await res.json();
      expect(body.result.protocolVersion).not.toBe('2026-01-26');
      expect(['2025-06-18', '2025-03-26', '2024-11-05']).toContain(body.result.protocolVersion);
    }
  });
});

describe('clientDeclaresUi', () => {
  // The diagnostic that tells "host never offered MCP Apps" apart from "offered
  // and did not render". It must not be used to gate _meta.ui.
  it('is true when the client advertises the ui extension', () => {
    expect(clientDeclaresUi({ capabilities: { extensions: { 'io.modelcontextprotocol/ui': {} } } })).toBe(true);
  });

  it('is false for a client that advertises nothing', () => {
    expect(clientDeclaresUi({ capabilities: {} })).toBe(false);
    expect(clientDeclaresUi(undefined)).toBe(false);
  });
});
