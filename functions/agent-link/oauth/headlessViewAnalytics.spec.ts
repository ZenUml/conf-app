// What the MCP Apps view events say about a fetch. On 2026-09-29 eight
// agent_link_app_view_failed events carried only `reason`, so which host asked
// and what went wrong could only be reconstructed by lining their hour up
// against git history. These pin the two properties that make a failure
// explain itself: the requesting OAuth client, and the resolver's `detail`.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleHeadlessRpc } from './headlessMcp';
import { issueAccessToken, saveClient, type GrantStoreLike } from './asStore';
import { resourceFor } from './asMetadata';

const ORIGIN = 'https://conf-stg-lite.zenuml.com';
const MCP = `${ORIGIN}/agent-link/mcp`;
const ACCOUNT = '712020:abc';
const VIEW_HTML = '<!doctype html><html><head><meta name="mcp-app" content="zenuml-diagram"></head><body></body></html>';

function makeEnv() {
  const kv = new Map<string, string>();
  const store: GrantStoreLike = {
    get: async (k) => kv.get(k) ?? null,
    put: async (k, v) => {
      kv.set(k, v);
    },
    delete: async (k) => {
      kv.delete(k);
    },
  };
  return {
    store,
    env: {
      ATLASSIAN_OAUTH_CLIENT_ID: 'client-id',
      ATLASSIAN_OAUTH_CLIENT_SECRET: 'client-secret',
      ATLASSIAN_OAUTH_REDIRECT_URI: `${ORIGIN}/agent-link/oauth/callback`,
      OAUTH_GRANT_KV: store,
      OAUTH_GRANT_SECRET: 'grant-key',
      MIXPANEL_TOKEN: 'mp-token',
    },
  };
}

/** mixpanelService posts with the GLOBAL fetch, so that is where an emit is observable. */
function captureEvents() {
  const events: Array<Record<string, any>> = [];
  vi.stubGlobal('fetch', async (url: any, init: any) => {
    if (String(url).includes('mixpanel.com')) {
      try {
        const parsed = JSON.parse(String(init?.body ?? '[]'));
        for (const e of Array.isArray(parsed) ? parsed : [parsed]) events.push(e);
      } catch {
        // the identify call posts a different shape
      }
      return new Response('1', { status: 200 });
    }
    return new Response('unexpected', { status: 500 });
  });
  return events;
}

async function readView(
  env: ReturnType<typeof makeEnv>,
  opts: { uri?: string; asset: () => Response; clientName?: string },
) {
  if (opts.clientName !== undefined) {
    await saveClient(env.store, {
      clientId: 'client-A',
      redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
      clientName: opts.clientName,
      createdAtMs: Date.now(),
    });
  }
  const { token } = await issueAccessToken(
    env.store,
    { userId: ACCOUNT, clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN) },
    Date.now(),
  );
  const request = new Request(MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri: opts.uri ?? 'ui://zenuml/diagram' },
    }),
  });
  return handleHeadlessRpc(request, env.env, await request.clone().json(), {
    fetchImpl: async () => opts.asset(),
  });
}

const viewEvents = (events: Array<Record<string, any>>) =>
  events.filter((e) => String(e.event).startsWith('agent_link_app_view_'));

describe('MCP Apps view analytics', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('names the OAuth client that fetched the view', async () => {
    const env = makeEnv();
    const events = captureEvents();
    await readView(env, { clientName: 'Claude', asset: () => new Response(VIEW_HTML, { status: 200 }) });

    const [event] = viewEvents(events);
    expect(event.event).toBe('agent_link_app_view_requested');
    expect(event.properties.oauth_client_id).toBe('client-A');
    expect(event.properties.oauth_client_name).toBe('Claude');
    expect(event.properties).not.toHaveProperty('detail');
  });

  it('says what the guard found when the view asset is the SPA shell', async () => {
    // The 2026-09-29 shape: Pages answers a missing entry with the app shell and a 200.
    const env = makeEnv();
    const events = captureEvents();
    await readView(env, {
      clientName: 'Claude',
      asset: () => new Response('<!doctype html><title>ZenUML Forge Addon</title><script></script>', { status: 200 }),
    });

    const [event] = viewEvents(events);
    expect(event.event).toBe('agent_link_app_view_failed');
    expect(event.properties.reason).toBe('fetch_failed');
    expect(event.properties.detail).toMatch(/did not carry/);
    expect(event.properties.detail.length).toBeLessThanOrEqual(120);
    expect(event.properties.oauth_client_name).toBe('Claude');
  });

  it('records the URI a client asked for when it is not one we publish', async () => {
    const env = makeEnv();
    const events = captureEvents();
    await readView(env, { uri: 'ui://elsewhere/x', asset: () => new Response(VIEW_HTML, { status: 200 }) });

    const [event] = viewEvents(events);
    expect(event.properties.reason).toBe('unknown_uri');
    expect(event.properties.detail).toBe('ui://elsewhere/x');
  });

  it('caps a long detail so an event never carries a page of text', async () => {
    const env = makeEnv();
    const events = captureEvents();
    await readView(env, { uri: `ui://${'x'.repeat(500)}`, asset: () => new Response(VIEW_HTML, { status: 200 }) });

    expect(viewEvents(events)[0].properties.detail.length).toBeLessThanOrEqual(120);
  });

  it('still emits, with an unknown name, when the client registration is gone', async () => {
    const env = makeEnv();
    const events = captureEvents();
    await readView(env, { asset: () => new Response(VIEW_HTML, { status: 200 }) });

    const [event] = viewEvents(events);
    expect(event.properties.oauth_client_id).toBe('client-A');
    expect(event.properties.oauth_client_name).toBe('unknown');
  });

  it('tags the handshake with the same client id the view events carry', async () => {
    const env = makeEnv();
    const events = captureEvents();
    const { token } = await issueAccessToken(
      env.store,
      { userId: ACCOUNT, clientId: 'client-A', scope: 'diagram.read', resource: resourceFor(ORIGIN) },
      Date.now(),
    );
    const request = new Request(MCP, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1' } },
      }),
    });
    await handleHeadlessRpc(request, env.env, await request.clone().json(), {
      fetchImpl: async () => new Response('', { status: 500 }),
    });

    const handshake = events.find((e) => e.event === 'agent_link_mcp_initialized');
    expect(handshake?.properties.oauth_client_id).toBe('client-A');
  });
});
