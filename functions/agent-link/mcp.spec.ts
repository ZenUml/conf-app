import { describe, it, expect, vi } from 'vitest';
import { onRequestDelete, onRequestGet, onRequestPost, onRequestOptions } from './mcp';
import { onRequestPost as sessionPost } from './session';
import { sessionRegistry } from './registrySingleton';
import { IDLE_TTL_MS } from './sessionToken';
import type { BoundContext } from './sessionToken';
import { getToolSchemas } from './mcpTools';
import { mcpBindingRegistry } from './mcpBindingRegistry';

const CTX: BoundContext = { cloudId: 'cloud-1', pageId: 'page-1', contentId: 'content-1' };

function rpc(method: string, params?: unknown, id: number | string = 1) {
  return { jsonrpc: '2.0', id, method, params };
}

function makeRequest(
  body: unknown,
  opts: { token?: string; viaQuery?: boolean; rawBody?: string; mcpSessionId?: string } = {},
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let url = 'https://example.com/agent-link/mcp';

  if (opts.token) {
    if (opts.viaQuery) {
      url += `?token=${encodeURIComponent(opts.token)}`;
    } else {
      headers['Authorization'] = `Bearer ${opts.token}`;
    }
  }
  if (opts.mcpSessionId) headers['Mcp-Session-Id'] = opts.mcpSessionId;

  return new Request(url, {
    method: 'POST',
    headers,
    body: opts.rawBody ?? JSON.stringify(body),
  });
}

async function post(
  body: unknown,
  opts?: { token?: string; viaQuery?: boolean; rawBody?: string; mcpSessionId?: string },
) {
  const requestOpts = { ...opts };
  if (opts?.token) {
    const mcpSessionId = `test:${opts.token}`;
    mcpBindingRegistry.bind(mcpSessionId, opts.token);
    requestOpts.mcpSessionId = mcpSessionId;
    delete requestOpts.token;
    delete requestOpts.viaQuery;
  }
  const res = await onRequestPost({ request: makeRequest(body, requestOpts) } as any);
  const json = await res.json();
  return { res, json };
}

describe('POST /agent-link/mcp', () => {
  it('initializes without Agent Link credentials and issues an MCP session id', async () => {
    const { res, json } = await post(
      rpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1' },
      }),
    );

    expect(res.status).toBe(200);
    expect(json.result.serverInfo.name).toBe('conf-agent-link');
    expect(res.headers.get('Mcp-Session-Id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('lists connect on an unpaired MCP session without Agent Link credentials', async () => {
    const { res, json } = await post(rpc('tools/list'), {
      mcpSessionId: '55d92b0c-a875-4f52-9520-7758667eed09',
    });

    expect(res.status).toBe(200);
    expect(json.result.tools.map((tool: { name: string }) => tool.name)).toContain('connect');
  });

  it('lists static DSL resources before pairing', async () => {
    const { res, json } = await post(rpc('resources/list'), {
      mcpSessionId: '77bfdd2a-0b93-4ec8-a0ec-f59c1e357e7f',
    });

    expect(res.status).toBe(200);
    expect(json.result.resources.map((resource: { uri: string }) => resource.uri)).toContain(
      'zenuml://dsl-guide',
    );
  });

  it('accepts the initialized notification on an unpaired MCP session', async () => {
    const request = makeRequest(rpc('notifications/initialized'), {
      mcpSessionId: 'b59bd32d-925a-4310-b73a-a957bb574a2d',
    });

    const res = await onRequestPost({ request } as any);

    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('connects an MCP session with a live one-time code', async () => {
    const link = sessionRegistry.create(CTX);
    const { res, json } = await post(
      rpc('tools/call', { name: 'connect', arguments: { code: link.token } }),
      { mcpSessionId: '6c63738f-d61c-4acc-8e25-50118ee95fd3' },
    );

    expect(res.status).toBe(200);
    expect(json.error).toBeUndefined();
    expect(json.result.structuredContent).toMatchObject({ connected: true });
  });

  it('uses the MCP session binding for later tools without resending the code', async () => {
    const link = sessionRegistry.create(CTX);
    const mcpSessionId = '5b6b553c-f3ee-49ce-b959-30d280030efd';
    await post(rpc('tools/call', { name: 'connect', arguments: { code: link.token } }), {
      mcpSessionId,
    });

    const { res, json } = await post(rpc('tools/call', { name: 'read_page', arguments: {} }), {
      mcpSessionId,
    });

    expect(res.status).toBe(200);
    expect(json.result.structuredContent).toMatchObject({ pageId: CTX.pageId, stubbed: true });
  });

  it('returns not_paired when a diagram tool is called before connect', async () => {
    const { res, json } = await post(
      rpc('tools/call', { name: 'read_page', arguments: {} }),
      { mcpSessionId: 'f21784a4-3910-4480-87b5-9ea6d4ce0757' },
    );

    expect(res.status).toBe(200);
    expect(json.error.data.code).toBe('not_paired');
  });

  it('does not accept the one-time code as a reusable Bearer credential', async () => {
    const link = sessionRegistry.create(CTX);
    const request = makeRequest(
      rpc('tools/call', { name: 'read_page', arguments: {} }),
      { token: link.token },
    );

    const res = await onRequestPost({ request } as any);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error.data.code).toBe('mcp_session_missing');
  });

  it('allows discovery without an MCP session so clients do not start OAuth discovery', async () => {
    const { res, json } = await post(rpc('tools/list'));

    expect(res.status).toBe(200);
    expect(json.result.tools.map((tool: { name: string }) => tool.name)).toContain('connect');
  });

  it('answers the public MCP ping used by client connectivity probes', async () => {
    const { res, json } = await post(rpc('ping'));

    expect(res.status).toBe(200);
    expect(json.result).toEqual({});
  });

  it('answers Claude Code server discovery without advertising OAuth', async () => {
    const { res, json } = await post(rpc('server/discover'));

    expect(res.status).toBe(200);
    expect(json.result).toEqual({});
  });

  it('reads static DSL resources before pairing', async () => {
    const { res, json } = await post(
      rpc('resources/read', { uri: 'zenuml://dsl-guide' }),
      { mcpSessionId: '67855920-2a19-4418-97ae-1ca38a99a809' },
    );

    expect(res.status).toBe(200);
    expect(json.result.contents[0]).toMatchObject({
      uri: 'zenuml://dsl-guide',
      mimeType: 'text/markdown',
    });
  });

  it('returns 401 when an MCP binding points to an unknown target', async () => {
    const { res, json } = await post(
      rpc('tools/call', { name: 'read_page', arguments: {} }),
      { token: 'CL-0000-0000' },
    );

    expect(res.status).toBe(401);
    expect(json.error.data?.code).toBe('invalid');
  });

  it('returns 403 when a paired target expires', async () => {
    const record = sessionRegistry.create(CTX);
    record.issuedAtMs = Date.now() - IDLE_TTL_MS - 1;
    record.lastActivityMs = record.issuedAtMs; // no bumping yet — idle window is what expires

    const { res, json } = await post(
      rpc('tools/call', { name: 'read_page', arguments: {} }),
      { token: record.token },
    );

    expect(res.status).toBe(403);
    expect(json.error.data?.code).toBe('expired');
  });

  it('tools/list returns connect plus the 6 diagram tools', async () => {
    const record = sessionRegistry.create(CTX);

    const { res, json } = await post(rpc('tools/list'), { token: record.token });

    expect(res.status).toBe(200);
    expect(json.result.tools).toHaveLength(7);
    expect(json.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(
      ['connect', 'get_status', 'list_diagrams', 'read_diagram', 'read_page', 'search_diagrams', 'update_diagram'].sort(),
    );
  });

  it('does not accept the one-time code through the legacy ?token= query parameter', async () => {
    const record = sessionRegistry.create(CTX);
    const request = makeRequest(rpc('tools/list'), { token: record.token, viaQuery: true });
    const res = await onRequestPost({ request } as any);

    expect(res.status).toBe(401);
  });

  it('tools/call read_page returns the stubbed result', async () => {
    const record = sessionRegistry.create(CTX);

    const { res, json } = await post(
      rpc('tools/call', { name: 'read_page', arguments: {} }),
      { token: record.token },
    );

    expect(res.status).toBe(200);
    // MCP-compliant CallToolResult: a `content` text array wrapping the
    // payload, echoed as structuredContent for typed clients.
    expect(Array.isArray(json.result.content)).toBe(true);
    expect(json.result.content[0].type).toBe('text');
    expect(json.result.structuredContent.stubbed).toBe(true);
    expect(json.result.structuredContent.pageId).toBe(CTX.pageId);
  });

  it('tools/call update_diagram returns the stubbed ok/version/rendered shape', async () => {
    const record = sessionRegistry.create(CTX);

    const { res, json } = await post(
      rpc('tools/call', { name: 'update_diagram', arguments: { dsl: 'A->B: hi' } }),
      { token: record.token },
    );

    expect(res.status).toBe(200);
    expect(json.result.content[0].type).toBe('text');
    expect(json.result.structuredContent).toMatchObject({ ok: true, rendered: true, stubbed: true });
    expect(typeof json.result.structuredContent.version).toBe('number');
  });

  it('tools/call with an unknown tool name returns a JSON-RPC error, not a thrown exception', async () => {
    const record = sessionRegistry.create(CTX);

    const { res, json } = await post(
      rpc('tools/call', { name: 'delete_everything', arguments: {} }),
      { token: record.token },
    );

    expect(json.error).toBeDefined();
    expect(json.error.data?.code).toBe('unknown_tool');
    expect(res.status).toBe(200); // JSON-RPC-level error, transport succeeded
  });

  it('tools/call with bad args (missing dsl) returns a JSON-RPC invalid-params error', async () => {
    const record = sessionRegistry.create(CTX);

    const { json } = await post(
      rpc('tools/call', { name: 'update_diagram', arguments: {} }),
      { token: record.token },
    );

    expect(json.error).toBeDefined();
    expect(json.error.data?.code).toBe('bad_args');
  });

  it('initialize returns protocol/capabilities + ZenUML DSL instructions', async () => {
    const record = sessionRegistry.create(CTX);

    const { res, json } = await post(rpc('initialize'), { token: record.token });

    expect(res.status).toBe(200);
    expect(json.result.protocolVersion).toBeTruthy();
    expect(json.result.capabilities.tools).toBeDefined();
    expect(json.result.capabilities.resources).toBeDefined();
    // The ZenUML DSL guide is surfaced so any MCP client writes valid syntax.
    expect(json.result.instructions).toMatch(/ZenUML/);
    expect(json.result.instructions).toMatch(/update_diagram/);
  });

  it('resources/list advertises all four guides (three dialect DSLs + OpenAPI)', async () => {
    const record = sessionRegistry.create(CTX);

    const { res, json } = await post(rpc('resources/list'), { token: record.token });

    expect(res.status).toBe(200);
    expect(json.result.resources).toHaveLength(4);
    expect(json.result.resources.map((r: { uri: string }) => r.uri).sort()).toEqual(
      ['mermaid://dsl-guide', 'openapi://dsl-guide', 'plantuml://dsl-guide', 'zenuml://dsl-guide'].sort(),
    );
  });

  it('resources/read returns the ZenUML DSL guide text', async () => {
    const record = sessionRegistry.create(CTX);

    const { res, json } = await post(rpc('resources/read', { uri: 'zenuml://dsl-guide' }), { token: record.token });

    expect(res.status).toBe(200);
    expect(json.result.contents[0].uri).toBe('zenuml://dsl-guide');
    expect(json.result.contents[0].text).toMatch(/This is ZenUML/);
    expect(json.result.contents[0].text).toMatch(/if \(cond\)/);
  });

  it('resources/read serves the Mermaid and PlantUML guides too', async () => {
    const record = sessionRegistry.create(CTX);

    const mermaid = await post(rpc('resources/read', { uri: 'mermaid://dsl-guide' }), { token: record.token });
    expect(mermaid.res.status).toBe(200);
    expect(mermaid.json.result.contents[0].text).toMatch(/This is Mermaid/);

    const plantuml = await post(rpc('resources/read', { uri: 'plantuml://dsl-guide' }), { token: record.token });
    expect(plantuml.res.status).toBe(200);
    expect(plantuml.json.result.contents[0].text).toMatch(/This is PlantUML/);
  });

  it('resources/read rejects an unknown uri', async () => {
    const record = sessionRegistry.create(CTX);

    const { res, json } = await post(rpc('resources/read', { uri: 'zenuml://nope' }), { token: record.token });

    expect(res.status).toBe(400);
    expect(json.error).toBeDefined();
  });

  it('returns an error for an unsupported top-level method', async () => {
    const record = sessionRegistry.create(CTX);

    const { res, json } = await post(rpc('not/a/real/method'), { token: record.token });

    expect(json.error).toBeDefined();
    expect(res.status).not.toBe(200);
  });

  it('acknowledges `notifications/initialized` with 202 + empty body (real MCP client handshake)', async () => {
    // A spec-compliant MCP client (Claude Code / the MCP SDK) POSTs this
    // notification right after `initialize`. It must NOT get a JSON-RPC error
    // (that aborts the handshake) — call onRequestPost directly since `post`
    // would choke on the empty 202 body.
    const res = await onRequestPost({
      request: makeRequest(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { mcpSessionId: 'f6eca506-d0e3-421f-bff8-92ed298cb4aa' },
      ),
    } as any);

    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('returns an error for malformed JSON-RPC (invalid JSON body)', async () => {
    const record = sessionRegistry.create(CTX);

    const { res, json } = await post(undefined, { token: record.token, rawBody: '{not json' });

    expect(res.status).toBe(400);
    expect(json.error).toBeDefined();
  });

  it('returns an error when the body has no "method"', async () => {
    const record = sessionRegistry.create(CTX);

    const { res, json } = await post({ jsonrpc: '2.0', id: 1 }, { token: record.token });

    expect(res.status).toBe(400);
    expect(json.error).toBeDefined();
  });

  it('resolves a token minted via POST /agent-link/session (shared registry)', async () => {
    const sessionReq = new Request('https://example.com/agent-link/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CTX),
    });
    const sessionRes = await sessionPost({ request: sessionReq } as any);
    const { token } = (await sessionRes.json()) as { token: string };

    const { res, json } = await post(rpc('tools/list'), { token });

    expect(res.status).toBe(200);
    expect(json.result.tools).toHaveLength(7);
  });

  it('onRequestOptions returns CORS headers for preflight', async () => {
    const res = await onRequestOptions();

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('returns an explicit non-HTML response to Streamable HTTP GET probes', async () => {
    const res = await onRequestGet();

    expect(res.status).toBe(405);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(await res.text()).toContain('POST');
  });

  it('DELETE releases the local MCP-session binding and one-time claim', async () => {
    const link = sessionRegistry.create(CTX);
    const firstSessionId = 'fc66af34-09c5-488a-8c6b-3079ac3c79b5';
    await post(rpc('tools/call', { name: 'connect', arguments: { code: link.token } }), {
      mcpSessionId: firstSessionId,
    });

    const deleted = await onRequestDelete({
      request: new Request('https://example.com/agent-link/mcp', {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': firstSessionId },
      }),
    } as any);

    expect(deleted.status).toBe(200);
    const afterDelete = await post(rpc('tools/call', { name: 'read_page', arguments: {} }), {
      mcpSessionId: firstSessionId,
    });
    expect(afterDelete.json.error.data.code).toBe('not_paired');

    const secondSession = await post(
      rpc('tools/call', { name: 'connect', arguments: { code: link.token } }),
      { mcpSessionId: '98d9900f-a100-4afb-b476-44c720d8c815' },
    );
    expect(secondSession.json.result.structuredContent.connected).toBe(true);
  });

  it('DELETE remains idempotent when a production binding is already unavailable', async () => {
    const res = await onRequestDelete({
      request: new Request('https://example.com/agent-link/mcp', {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': 'gone-session' },
      }),
      env: {
        AGENT_LINK: {
          idFromName: (name: string) => ({ name }),
          get: () => ({ fetch: async () => { throw new Error('DO unavailable') } }),
        },
      },
    } as any);

    expect(res.status).toBe(200);
  });
});

// --- env.AGENT_LINK (Durable Object) present: real forwarding path ---------
//
// These mock the DO stub's `.fetch` directly (no real Workers runtime
// needed — same approach as channel.spec.ts's "forwards to the Durable
// Object stub" test) rather than exercising AgentLinkSession itself; that
// class's own `/session` + `/agent-op` routes are covered by
// AgentLinkSession.spec.ts. This block only proves mcp.ts's contract with
// whatever the DO returns: a canned payload flows back as the JSON-RPC
// result, a DO auth rejection maps to 401/403, and a 409/504 from the DO
// maps to a JSON-RPC error with the matching HTTP status.

type FakeDoResponses = {
  session?: () => Response;
  agentOp?: (body: { id: string; op: string; args: unknown }) => Response;
};

function makeDoEnv(responses: FakeDoResponses) {
  const stub = {
    fetch: async (url: string, init?: RequestInit) => {
      // `?bump=1` may ride the /session auth URL (sliding-TTL) — match on the
      // path only so a bumped auth still routes to the session handler.
      const path = url.split('?')[0];
      if (path.endsWith('/mcp-binding')) {
        return new Response(JSON.stringify({ token: 'CL-TEST-TOKN', expiresAtMs: Date.now() + 600_000 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith('/session')) {
        return responses.session ? responses.session() : new Response(null, { status: 404 });
      }
      if (path.endsWith('/agent-op')) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        return responses.agentOp ? responses.agentOp(body) : new Response(null, { status: 404 });
      }
      return new Response(null, { status: 404 });
    },
  };

  return {
    AGENT_LINK: {
      idFromName: (name: string) => ({ name }),
      get: () => stub,
    },
  };
}

function sessionInfoResponse(
  overrides: Partial<{ state: string; issuedAtMs: number; diagramType: string }> = {},
): Response {
  const body: Record<string, unknown> = {
    state: overrides.state ?? 'created',
    boundContext: CTX,
    issuedAtMs: overrides.issuedAtMs ?? Date.now(),
  };
  // Mirrors the DO's GET /session: lastDiagram is present only once the agent
  // has read the diagram at least once, and carries the bound diagramType.
  if (overrides.diagramType) body.lastDiagram = { diagramType: overrides.diagramType, dsl: 'A->B: x' };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Like `makeDoEnv`, but RECORDS every URL the stub is fetched with
 * (`fetchedUrls`) and the parsed bodies of any `POST /activity` reports
 * (`activityBodies`) — the observable signals for sliding-TTL bump-worthiness
 * (`/session?bump=1`) and guardrail-reject reporting (spec 2026-07-13 §3/§4.2).
 */
function makeRecordingDoEnv(responses: FakeDoResponses) {
  const fetchedUrls: string[] = [];
  const activityBodies: any[] = [];
  const stub = {
    fetch: async (url: string, init?: RequestInit) => {
      fetchedUrls.push(url);
      const path = url.split('?')[0];
      if (path.endsWith('/mcp-binding')) {
        return new Response(JSON.stringify({ token: 'CL-TEST-TOKN', expiresAtMs: Date.now() + 600_000 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith('/session')) {
        return responses.session ? responses.session() : new Response(null, { status: 404 });
      }
      if (path.endsWith('/agent-op')) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        return responses.agentOp ? responses.agentOp(body) : new Response(null, { status: 404 });
      }
      if (path.endsWith('/activity')) {
        if (init?.body) activityBodies.push(JSON.parse(init.body as string));
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 404 });
    },
  };
  return {
    env: {
      AGENT_LINK: {
        idFromName: (name: string) => ({ name }),
        get: () => stub,
      },
    },
    fetchedUrls,
    activityBodies,
  };
}

async function postWithEnv(
  body: unknown,
  env: unknown,
  opts: { token?: string; viaQuery?: boolean; rawBody?: string } = {},
) {
  const token = opts.token ?? 'CL-TEST-TOKN';
  const res = await onRequestPost({
    request: makeRequest(body, { rawBody: opts.rawBody, mcpSessionId: `test:${token}` }),
    env,
  } as any);
  const json = await res.json();
  return { res, json };
}

describe('POST /agent-link/mcp with an AGENT_LINK Durable Object binding', () => {
  it('claims a code and persists the MCP-session binding through Durable Objects', async () => {
    const code = 'CL-LIVE-CODE';
    const mcpSessionId = 'ef150863-1f19-4b75-bdb6-dd946f94ece5';
    const calls: Array<{ name: string; path: string; body?: unknown }> = [];
    const env = {
      AGENT_LINK: {
        idFromName: (name: string) => ({ name }),
        get: (id: { name: string }) => ({
          fetch: async (url: string, init?: RequestInit) => {
            const path = new URL(url).pathname;
            const body = init?.body ? JSON.parse(String(init.body)) : undefined;
            calls.push({ name: id.name, path, body });
            if (id.name === code && path === '/mcp-claim') {
              return new Response(JSON.stringify({ ok: true, expiresAtMs: Date.now() + 600_000 }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            if (id.name === `mcp:${mcpSessionId}` && path === '/mcp-binding') {
              return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            return new Response(null, { status: 404 });
          },
        }),
      },
    };

    const request = makeRequest(
      rpc('tools/call', { name: 'connect', arguments: { code } }),
      { mcpSessionId },
    );
    const res = await onRequestPost({ request, env } as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.result.structuredContent.connected).toBe(true);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: code, path: '/mcp-claim' }),
        expect.objectContaining({ name: `mcp:${mcpSessionId}`, path: '/mcp-binding' }),
      ]),
    );
  });

  it('resolves a Durable Object binding for later tools without the code', async () => {
    const code = 'CL-LIVE-BOUND';
    const mcpSessionId = '90fc7bd2-e10e-4109-b876-5a23d0723675';
    const env = {
      AGENT_LINK: {
        idFromName: (name: string) => ({ name }),
        get: (id: { name: string }) => ({
          fetch: async (url: string, init?: RequestInit) => {
            const path = new URL(url).pathname;
            if (id.name === `mcp:${mcpSessionId}` && path === '/mcp-binding') {
              return new Response(JSON.stringify({ token: code, expiresAtMs: Date.now() + 600_000 }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            if (id.name === code && path === '/session') return sessionInfoResponse();
            if (id.name === code && path === '/agent-op') {
              const body = init?.body ? JSON.parse(String(init.body)) : {};
              expect(body.op).toBe('read_page');
              return new Response(
                JSON.stringify({ ok: true, payload: { pageId: 'page-1', title: 'Bound target' } }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
              );
            }
            return new Response(null, { status: 404 });
          },
        }),
      },
    };

    const request = makeRequest(rpc('tools/call', { name: 'read_page', arguments: {} }), {
      mcpSessionId,
    });
    const res = await onRequestPost({ request, env } as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.result.structuredContent.title).toBe('Bound target');
  });

  it('tools/call read_page returns the DO-forwarded payload verbatim', async () => {
    const env = makeDoEnv({
      session: () => sessionInfoResponse(),
      agentOp: (body) => {
        expect(body.op).toBe('read_page');
        return new Response(
          JSON.stringify({ ok: true, payload: { pageId: 'page-1', title: 'Real title', text: 'Real text' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });

    const { res, json } = await postWithEnv(rpc('tools/call', { name: 'read_page', arguments: {} }), env);

    expect(res.status).toBe(200);
    expect(json.result.structuredContent).toEqual({ pageId: 'page-1', title: 'Real title', text: 'Real text' });
    expect(json.result.content[0].text).toBe(JSON.stringify({ pageId: 'page-1', title: 'Real title', text: 'Real text' }));
  });

  it('maps a 409 (macro not connected) from the DO to a JSON-RPC error with HTTP 409', async () => {
    const env = makeDoEnv({
      session: () => sessionInfoResponse(),
      agentOp: () => new Response(JSON.stringify({ error: 'macro_not_connected' }), { status: 409 }),
    });

    const { res, json } = await postWithEnv(rpc('tools/call', { name: 'get_status', arguments: {} }), env);

    expect(res.status).toBe(409);
    expect(json.error).toBeDefined();
    expect(json.error.data?.code).toBe('macro_not_connected');
  });

  it('maps a 409 macro_disconnected (suspended session) to a structured, retriable JSON-RPC error', async () => {
    const resumeDeadline = Date.now() + 120_000;
    const env = makeDoEnv({
      session: () => sessionInfoResponse({ state: 'suspended' }),
      agentOp: () =>
        new Response(JSON.stringify({ error: 'macro_disconnected', resume_deadline: resumeDeadline }), {
          status: 409,
        }),
    });

    const { res, json } = await postWithEnv(
      rpc('tools/call', { name: 'update_diagram', arguments: { dsl: 'A->B: hi' } }),
      env,
    );

    expect(res.status).toBe(409);
    expect(json.error.data).toEqual({ reason: 'macro_disconnected', resume_deadline: resumeDeadline });
  });

  it('maps a 504 (macro timeout) from the DO to a JSON-RPC error with HTTP 504', async () => {
    const env = makeDoEnv({
      session: () => sessionInfoResponse(),
      agentOp: () => new Response(JSON.stringify({ error: 'macro_timeout' }), { status: 504 }),
    });

    const { res, json } = await postWithEnv(
      rpc('tools/call', { name: 'update_diagram', arguments: { dsl: 'A->B: hi' } }),
      env,
    );

    expect(res.status).toBe(504);
    expect(json.error).toBeDefined();
    expect(json.error.data?.code).toBe('macro_timeout');
  });

  it('a paired target the DO reports as unknown (401) fails auth with code "invalid"', async () => {
    const env = makeDoEnv({
      session: () => new Response(JSON.stringify({ error: 'invalid' }), { status: 401 }),
    });

    const { res, json } = await postWithEnv(rpc('tools/call', { name: 'read_page', arguments: {} }), env);

    expect(res.status).toBe(401);
    expect(json.error.data?.code).toBe('invalid');
  });

  it('a paired target the DO reports as expired/closed (403) fails auth with code "expired"', async () => {
    const env = makeDoEnv({
      session: () => new Response(JSON.stringify({ error: 'expired' }), { status: 403 }),
    });

    const { res, json } = await postWithEnv(rpc('tools/call', { name: 'read_page', arguments: {} }), env);

    expect(res.status).toBe(403);
    expect(json.error.data?.code).toBe('expired');
  });

  it('anonymous discovery stays local without touching the DO', async () => {
    const doFetch = vi.fn();
    const env = {
      AGENT_LINK: { idFromName: (name: string) => ({ name }), get: () => ({ fetch: doFetch }) },
    };

    const res = await onRequestPost({ request: makeRequest(rpc('tools/list')), env } as any);

    expect(res.status).toBe(200);
    expect(doFetch).not.toHaveBeenCalled();
  });

  // --- sliding-TTL: bump-worthiness rides the auth round-trip, and a
  // guardrail reject is surfaced to the status bus (spec 2026-07-13 §3/§4.2) --
  describe('sliding-TTL bump + guardrail reporting', () => {
    it('tools/call (non-get_status) auths with ?bump=1', async () => {
      const { env, fetchedUrls } = makeRecordingDoEnv({
        session: () => sessionInfoResponse(),
        agentOp: () =>
          new Response(JSON.stringify({ ok: true, payload: {} }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      });

      await postWithEnv(rpc('tools/call', { name: 'read_diagram', arguments: {} }), env);

      expect(fetchedUrls.some((u) => u.includes('bump=1'))).toBe(true);
    });

    it('static resources/read is public and does not bump the target session', async () => {
      const { env, fetchedUrls } = makeRecordingDoEnv({ session: () => sessionInfoResponse() });

      await postWithEnv(rpc('resources/read', { uri: 'zenuml://dsl-guide' }), env);

      expect(fetchedUrls).toEqual([]);
    });

    it('get_status and tools/list auth WITHOUT bump', async () => {
      const { env, fetchedUrls } = makeRecordingDoEnv({
        session: () => sessionInfoResponse(),
        agentOp: () =>
          new Response(JSON.stringify({ ok: true, payload: {} }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      });

      await postWithEnv(rpc('tools/call', { name: 'get_status', arguments: {} }), env);
      await postWithEnv(rpc('tools/list'), env);

      expect(fetchedUrls.every((u) => !u.includes('bump=1'))).toBe(true);
      // sanity: auth still happened (path matched despite no bump)
      expect(fetchedUrls.some((u) => u.split('?')[0].endsWith('/session'))).toBe(true);
    });

    it('a guardrail rejection reports POST /activity {type:guardrail_rejected} without masking the RPC error', async () => {
      const { env, activityBodies } = makeRecordingDoEnv({
        // A cached Sequence snapshot makes updateDiagramGuard parse the new DSL
        // against it; `A.method(` is unparseable ZenUML → reason 'parse_error'.
        session: () => sessionInfoResponse({ diagramType: 'Sequence' }),
      });

      const { res, json } = await postWithEnv(
        rpc('tools/call', { name: 'update_diagram', arguments: { dsl: 'A.method(' } }),
        env,
      );

      // The RPC reply is still the guardrail error, unchanged.
      expect(res.status).toBe(200); // JSON-RPC-level error, transport succeeded
      expect(json.error.code).toBe(-32004); // RPC_GUARDRAIL_REJECTED
      // …and the reject was reported to the DO's status bus.
      expect(activityBodies).toHaveLength(1);
      expect(activityBodies[0].type).toBe('guardrail_rejected');
      expect(activityBodies[0].detail).toBe('parse_error');
    });
  });

  // --- cross-session isolation (multi-user / multi-page "串台" check) -------
  //
  // Session isolation is DO-per-token by construction: mcp.ts addresses the
  // relay's Durable Object via `env.AGENT_LINK.idFromName(token)` for both
  // auth (authenticateViaDo) and forwarding (doForwardToMacro) — there is no
  // shared mutable state between two different tokens' requests. This block
  // is a REGRESSION TEST that locks that invariant in, not a discovery of a
  // bug: it proves two concurrent tokens, routed to two independently-mocked
  // DO stubs (one per token, exactly like two real AgentLinkSession
  // instances), never see each other's payload — and that update_diagram's
  // schema has no client-suppliable target override that could ever let one
  // session redirect a write at another session's diagram/page/tenant.
  describe('cross-session isolation (multi-user / multi-page)', () => {
    const TOKEN_A = 'CL-AAAA-1111';
    const TOKEN_B = 'CL-BBBB-2222';

    /** One independently-stateful stub PER token — `idFromName(token)` (mcp.ts's
     * real addressing scheme) routes each token to its own stub, mirroring two
     * separate AgentLinkSession DO instances rather than one shared mock. */
    function makePerTokenDoEnv(
      byToken: Record<string, { session: () => Response; agentOp: (body: { id: string; op: string; args: unknown }) => Response }>,
    ) {
      const stubs = new Map(
        Object.entries(byToken).map(([token, cfg]) => [
          token,
          {
            fetch: async (url: string, init?: RequestInit) => {
              // Path-only match so a bumped auth (`/session?bump=1`) still routes here.
              const path = url.split('?')[0];
              if (path.endsWith('/session')) return cfg.session();
              if (path.endsWith('/agent-op')) {
                const body = init?.body ? JSON.parse(init.body as string) : {};
                return cfg.agentOp(body);
              }
              return new Response(null, { status: 404 });
            },
          },
        ]),
      );
      return {
        AGENT_LINK: {
          idFromName: (name: string) => ({ name }),
          get: (id: { name: string }) => {
            if (id.name.startsWith('mcp:test:')) {
              const token = id.name.slice('mcp:test:'.length);
              return {
                fetch: async () =>
                  new Response(JSON.stringify({ token, expiresAtMs: Date.now() + 600_000 }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                  }),
              };
            }
            return stubs.get(id.name) ?? { fetch: async () => new Response(null, { status: 404 }) };
          },
        },
      };
    }

    it('two concurrent tokens each get back their OWN diagram — no cross-session swap', async () => {
      const env = makePerTokenDoEnv({
        [TOKEN_A]: {
          session: () => sessionInfoResponse(),
          agentOp: (body) => {
            expect(body.op).toBe('read_diagram');
            return new Response(JSON.stringify({ ok: true, payload: { contentId: 'A-diagram' } }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          },
        },
        [TOKEN_B]: {
          session: () => sessionInfoResponse(),
          agentOp: (body) => {
            expect(body.op).toBe('read_diagram');
            return new Response(JSON.stringify({ ok: true, payload: { contentId: 'B-diagram' } }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          },
        },
      });

      const [respA, respB] = await Promise.all([
        postWithEnv(rpc('tools/call', { name: 'read_diagram', arguments: {} }), env, { token: TOKEN_A }),
        postWithEnv(rpc('tools/call', { name: 'read_diagram', arguments: {} }), env, { token: TOKEN_B }),
      ]);

      expect(respA.res.status).toBe(200);
      expect(respB.res.status).toBe(200);
      expect(respA.json.result.structuredContent).toEqual({ contentId: 'A-diagram' });
      expect(respB.json.result.structuredContent).toEqual({ contentId: 'B-diagram' });
    });

    it('update_diagram\'s inputSchema has no contentId/pageId/cloudId — no client-controllable write target override', () => {
      const tools = getToolSchemas();
      const updateDiagram = tools.find((t) => t.name === 'update_diagram');
      expect(updateDiagram).toBeDefined();

      const props = Object.keys(updateDiagram!.inputSchema.properties);
      expect(props).not.toContain('contentId');
      expect(props).not.toContain('pageId');
      expect(props).not.toContain('cloudId');
      expect(props.sort()).toEqual(['dsl', 'summary'].sort());
    });
  });
});

// --- presence stage rides the DO auth GET (spec 2026-08-15) ----------------
//
// derivePresence()/deriveClientName() are pure functions of the request body
// (+ bumpWorthy); this block only proves mcp.ts's OBSERVABLE contract — the
// exact query string it fetches the DO's `GET /session` with — not the DO's
// behavior (Task 3, not yet built; the DO currently ignores unknown query
// params, which is exactly the backward-tolerance this relies on).
describe('POST /agent-link/mcp — presence stage on the DO auth GET', () => {
  // Reset per test so `lastDoUrl()` always reflects the single postMcp() call
  // that test made, matching the brief's one-call-then-assert shape.
  let fetchedUrls: string[];

  function postMcp(body: unknown, opts: { token?: string } = {}) {
    const recorded = makeRecordingDoEnv({
      session: () => sessionInfoResponse(),
      agentOp: () =>
        new Response(JSON.stringify({ ok: true, payload: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    fetchedUrls = recorded.fetchedUrls;
    // Not postWithEnv(): `notifications/initialized` replies 202 with an
    // empty body, which postWithEnv's res.json() would choke on — this block
    // only asserts the DO fetch URL, so skip response parsing entirely.
    return onRequestPost({
      request: makeRequest(body, { mcpSessionId: `test:${opts.token ?? 'CL-TEST-TOKN'}` }),
      env: recorded.env,
    } as any);
  }

  function lastDoUrl(): string {
    const sessionUrls = fetchedUrls.filter((u) => u.split('?')[0].endsWith('/session'));
    return sessionUrls[sessionUrls.length - 1] ?? '';
  }

  it.each(['initialize', 'notifications/initialized', 'tools/list', 'resources/list'])(
    'unpaired handshake method %s does not touch a Macro target',
    async (method) => {
      await postMcp(rpc(method), { token: 'CL-X' });
      expect(lastDoUrl()).toBe('');
    },
  );

  it('tools/call get_status reports presence=verified without bump', async () => {
    await postMcp(rpc('tools/call', { name: 'get_status' }), { token: 'CL-X' });
    expect(lastDoUrl()).toContain('presence=verified');
    expect(lastDoUrl()).not.toContain('bump=1');
  });

  it('bump-worthy tools/call reports presence=working AND bump=1', async () => {
    await postMcp(rpc('tools/call', { name: 'read_page' }), { token: 'CL-X' });
    expect(lastDoUrl()).toContain('presence=working');
    expect(lastDoUrl()).toContain('bump=1');
  });

  it('paired work does not invent a client name absent from connect metadata', async () => {
    await postMcp(rpc('tools/call', { name: 'get_status' }), { token: 'CL-X' });
    expect(lastDoUrl()).not.toContain('client=');
  });
});

// --- Guide serving before pairing -------------------------------------------
// The Remote MCP transport initializes before it knows which Macro the user
// will pair, so initialization and the first tools/list must be safe across
// dialects. Dialect-specific resources remain available after read_diagram.
describe('POST /agent-link/mcp — per-dialect guide serving', () => {
  it('initialization serves the combined cross-dialect guide before pairing', async () => {
    const env = makeDoEnv({ session: () => sessionInfoResponse() });

    const init = await postWithEnv(rpc('initialize'), env);
    expect(init.json.result.instructions).toMatch(/DO NOT blend/);
  });

  it('the first tools/list carries a cross-dialect update hint', async () => {
    const env = makeDoEnv({ session: () => sessionInfoResponse() });
    const list = await postWithEnv(rpc('tools/list'), env);
    const update = list.json.result.tools.find((t: { name: string }) => t.name === 'update_diagram');
    expect(update.description).toMatch(/must match the bound diagram type/);
  });
});
