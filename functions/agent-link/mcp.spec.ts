import { describe, it, expect, vi } from 'vitest';
import { onRequestPost, onRequestOptions } from './mcp';
import { onRequestPost as sessionPost } from './session';
import { sessionRegistry } from './registrySingleton';
import { IDLE_TTL_MS } from './sessionToken';
import type { BoundContext } from './sessionToken';
import { getToolSchemas } from './mcpTools';
import {
  AGENT_LINK_MCP_CAPABILITIES,
  LATEST_MCP_PROTOCOL_VERSION,
  SUPPORTED_MCP_PROTOCOL_VERSIONS,
} from './mcpProtocol';

const CTX: BoundContext = { cloudId: 'cloud-1', pageId: 'page-1', contentId: 'content-1' };

function rpc(method: string, params?: unknown, id: number | string = 1) {
  return { jsonrpc: '2.0', id, method, params };
}

function initializeRpc(
  protocolVersion: string = LATEST_MCP_PROTOCOL_VERSION,
  capabilities: Record<string, unknown> = {},
  clientInfo: Record<string, unknown> = { name: 'agent-link-test-client', version: '1.0.0' },
) {
  return rpc('initialize', {
    protocolVersion,
    capabilities,
    clientInfo,
  });
}

function makeRequest(
  body: unknown,
  opts: { token?: string; viaQuery?: boolean; rawBody?: string; protocolVersion?: string } = {},
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
  if (opts.protocolVersion) headers['MCP-Protocol-Version'] = opts.protocolVersion;

  return new Request(url, {
    method: 'POST',
    headers,
    body: opts.rawBody ?? JSON.stringify(body),
  });
}

async function post(
  body: unknown,
  opts?: { token?: string; viaQuery?: boolean; rawBody?: string; protocolVersion?: string },
) {
  const res = await onRequestPost({ request: makeRequest(body, opts) } as any);
  const json = await res.json();
  return { res, json };
}

describe('POST /agent-link/mcp', () => {
  it('returns 401 when no token is presented', async () => {
    const { res, json } = await post(rpc('tools/list'));

    expect(res.status).toBe(401);
    expect(json.error).toBeDefined();
    expect(json.error.data?.code).toBe('missing');
  });

  it('returns 401 for a bogus token', async () => {
    const { res, json } = await post(rpc('tools/list'), { token: 'CL-0000-0000' });

    expect(res.status).toBe(401);
    expect(json.error.data?.code).toBe('invalid');
  });

  it('returns 403 for an expired token', async () => {
    const record = sessionRegistry.create(CTX);
    record.issuedAtMs = Date.now() - IDLE_TTL_MS - 1;
    record.lastActivityMs = record.issuedAtMs; // no bumping yet — idle window is what expires

    const { res, json } = await post(rpc('tools/list'), { token: record.token });

    expect(res.status).toBe(403);
    expect(json.error.data?.code).toBe('expired');
  });

  it('tools/list returns the 6 tools for a valid token', async () => {
    const record = sessionRegistry.create(CTX);

    const { res, json } = await post(rpc('tools/list'), { token: record.token });

    expect(res.status).toBe(200);
    expect(json.result.tools).toHaveLength(6);
    expect(json.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(
      ['get_status', 'list_diagrams', 'read_diagram', 'read_page', 'search_diagrams', 'update_diagram'].sort(),
    );
  });

  it('accepts the token via ?token= query param instead of the Authorization header', async () => {
    const record = sessionRegistry.create(CTX);

    const { res } = await post(rpc('tools/list'), { token: record.token, viaQuery: true });

    expect(res.status).toBe(200);
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

  it('initialize negotiates a matching protocol and exposes stable server capabilities', async () => {
    const record = sessionRegistry.create(CTX);

    const { res, json } = await post(initializeRpc(), { token: record.token });

    expect(res.status).toBe(200);
    expect(json.result.protocolVersion).toBe(LATEST_MCP_PROTOCOL_VERSION);
    expect(json.result.capabilities).toEqual(AGENT_LINK_MCP_CAPABILITIES);
    // The ZenUML DSL guide is surfaced so any MCP client writes valid syntax.
    expect(json.result.instructions).toMatch(/ZenUML/);
    expect(json.result.instructions).toMatch(/update_diagram/);
  });

  it('initialize preserves a supported older client revision rather than silently upgrading it', async () => {
    const record = sessionRegistry.create(CTX);
    const supportedOlderVersion = SUPPORTED_MCP_PROTOCOL_VERSIONS.at(-1)!;

    const { res, json } = await post(initializeRpc(supportedOlderVersion), { token: record.token });

    expect(res.status).toBe(200);
    expect(json.result.protocolVersion).toBe(supportedOlderVersion);
  });

  it('initialize rejects an incompatible protocol with an actionable machine-readable mismatch', async () => {
    const record = sessionRegistry.create(CTX);

    const { res, json } = await post(initializeRpc('2099-01-01'), { token: record.token });

    expect(res.status).toBe(200);
    expect(json.result).toBeUndefined();
    expect(json.error.code).toBe(-32602);
    expect(json.error.message).toMatch(/Update your AI agent.*Agent Link MCP configuration.*new agent session/i);
    expect(json.error.data).toEqual({
      code: 'protocol_version_mismatch',
      requested: '2099-01-01',
      supported: [...SUPPORTED_MCP_PROTOCOL_VERSIONS],
      latest: LATEST_MCP_PROTOCOL_VERSION,
    });
  });

  it('initialize negotiates only server-supported capabilities instead of mirroring client features', async () => {
    const record = sessionRegistry.create(CTX);
    const clientCapabilities = { roots: { listChanged: true }, sampling: {}, experimental: { x: {} } };

    const { res, json } = await post(initializeRpc(LATEST_MCP_PROTOCOL_VERSION, clientCapabilities), {
      token: record.token,
    });

    expect(res.status).toBe(200);
    expect(json.result.capabilities).toEqual(AGENT_LINK_MCP_CAPABILITIES);
    expect(json.result.capabilities).not.toHaveProperty('roots');
    expect(json.result.capabilities).not.toHaveProperty('sampling');
    expect(json.result.capabilities).not.toHaveProperty('experimental');
  });

  it('initialize rejects a missing client version/capability contract before partial connection', async () => {
    const record = sessionRegistry.create(CTX);

    const missingVersion = await post(rpc('initialize', { capabilities: {} }), { token: record.token });
    expect(missingVersion.json.error.data.code).toBe('protocol_version_required');

    const missingCapabilities = await post(
      rpc('initialize', { protocolVersion: LATEST_MCP_PROTOCOL_VERSION }),
      { token: record.token },
    );
    expect(missingCapabilities.json.error.data.code).toBe('client_capabilities_required');
  });

  it('rejects an incompatible negotiated-version header on later requests', async () => {
    const record = sessionRegistry.create(CTX);

    const { res, json } = await post(rpc('tools/list'), {
      token: record.token,
      protocolVersion: '2099-01-01',
    });

    expect(res.status).toBe(400);
    expect(json.error.data).toMatchObject({
      code: 'protocol_version_mismatch',
      requested: '2099-01-01',
      supported: [...SUPPORTED_MCP_PROTOCOL_VERSIONS],
    });
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
    const record = sessionRegistry.create(CTX);

    // A spec-compliant MCP client (Claude Code / the MCP SDK) POSTs this
    // notification right after `initialize`. It must NOT get a JSON-RPC error
    // (that aborts the handshake) — call onRequestPost directly since `post`
    // would choke on the empty 202 body.
    const res = await onRequestPost({
      request: makeRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, { token: record.token }),
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
    expect(json.result.tools).toHaveLength(6);
  });

  it('onRequestOptions returns CORS headers for preflight', async () => {
    const res = await onRequestOptions();

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
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
  const res = await onRequestPost({ request: makeRequest(body, { token: 'CL-TEST-TOKN', ...opts }), env } as any);
  const json = await res.json();
  return { res, json };
}

describe('POST /agent-link/mcp with an AGENT_LINK Durable Object binding', () => {
  it.each([
    ['openai-codex', 'Codex'],
    ['claude-code', 'Claude Code'],
    ['Cursor', 'Cursor'],
    ['untrusted-client-secret-name', 'an AI agent'],
  ])('compatible initialize reduces clientInfo %s to the safe label %s', async (name, label) => {
    const { env, activityBodies } = makeRecordingDoEnv({
      session: () => sessionInfoResponse(),
    });

    const { res, json } = await postWithEnv(
      initializeRpc(LATEST_MCP_PROTOCOL_VERSION, {}, { name, version: 'sensitive-version' }),
      env,
    );

    expect(res.status).toBe(200);
    expect(json.result.protocolVersion).toBe(LATEST_MCP_PROTOCOL_VERSION);
    expect(activityBodies).toEqual([{ type: 'client_identified', detail: label }]);
    expect(JSON.stringify(activityBodies)).not.toContain('sensitive-version');
    expect(JSON.stringify(activityBodies)).not.toContain('untrusted-client-secret-name');
  });

  it('an incompatible initialize reports the lifecycle state without raw clientInfo', async () => {
    const { env, activityBodies } = makeRecordingDoEnv({
      session: () => sessionInfoResponse(),
    });
    const { json } = await postWithEnv(
      initializeRpc('2099-01-01', {}, { name: 'raw-client-secret', version: 'raw-version' }),
      env,
    );

    expect(json.error.data.code).toBe('protocol_version_mismatch');
    expect(activityBodies).toEqual([{ type: 'protocol_incompatible' }]);
    expect(JSON.stringify(activityBodies)).not.toContain('raw-client-secret');
    expect(JSON.stringify(activityBodies)).not.toContain('2099-01-01');
  });

  it('a client missing the initialization contract also reports incompatibility to the rail', async () => {
    const { env, activityBodies } = makeRecordingDoEnv({
      session: () => sessionInfoResponse(),
    });
    const { json } = await postWithEnv(rpc('initialize', { clientInfo: { name: 'legacy' } }), env);

    expect(json.error.data.code).toBe('protocol_version_required');
    expect(activityBodies).toEqual([{ type: 'protocol_incompatible' }]);
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

  it('a token the DO reports as unknown (401) fails auth with code "invalid"', async () => {
    const env = makeDoEnv({
      session: () => new Response(JSON.stringify({ error: 'invalid' }), { status: 401 }),
    });

    const { res, json } = await postWithEnv(rpc('tools/list'), env);

    expect(res.status).toBe(401);
    expect(json.error.data?.code).toBe('invalid');
  });

  it('a token the DO reports as expired/closed (403) fails auth with code "expired"', async () => {
    const env = makeDoEnv({
      session: () => new Response(JSON.stringify({ error: 'expired' }), { status: 403 }),
    });

    const { res, json } = await postWithEnv(rpc('tools/list'), env);

    expect(res.status).toBe(403);
    expect(json.error.data?.code).toBe('expired');
  });

  it('a missing token still 401s locally without ever touching the DO', async () => {
    const doFetch = vi.fn();
    const env = {
      AGENT_LINK: { idFromName: (name: string) => ({ name }), get: () => ({ fetch: doFetch }) },
    };

    const res = await onRequestPost({ request: makeRequest(rpc('tools/list')), env } as any);

    expect(res.status).toBe(401);
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

      expect(fetchedUrls.some((u) => u.endsWith('/session?bump=1'))).toBe(true);
    });

    it('resources/read auths WITH bump', async () => {
      const { env, fetchedUrls } = makeRecordingDoEnv({ session: () => sessionInfoResponse() });

      await postWithEnv(rpc('resources/read', { uri: 'zenuml://dsl-guide' }), env);

      expect(fetchedUrls.some((u) => u.endsWith('/session?bump=1'))).toBe(true);
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
      expect(fetchedUrls.some((u) => u.endsWith('/session'))).toBe(true);
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
          get: (id: { name: string }) => stubs.get(id.name) ?? { fetch: async () => new Response(null, { status: 404 }) },
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

// --- Per-dialect guide serving (the bound diagramType, cached by the DO into
// lastDiagram, selects which guide/hint the relay serves) --------------------
describe('POST /agent-link/mcp — per-dialect guide serving', () => {
  it('a bound mermaid session gets the Mermaid guide as initialize instructions + the Mermaid tool hint', async () => {
    const env = makeDoEnv({ session: () => sessionInfoResponse({ diagramType: 'Mermaid' }) });

    const init = await postWithEnv(initializeRpc(), env);
    expect(init.res.status).toBe(200);
    expect(init.json.result.instructions).toMatch(/This is Mermaid/);
    expect(init.json.result.instructions).not.toMatch(/This is ZenUML/);

    const list = await postWithEnv(rpc('tools/list'), env);
    const update = list.json.result.tools.find((t: { name: string }) => t.name === 'update_diagram');
    expect(update.description).toMatch(/Mermaid DSL/);
    expect(update.description).not.toMatch(/ZenUML DSL/);
  });

  it('a bound sequence (ZenUML) session gets the ZenUML guide + hint', async () => {
    const env = makeDoEnv({ session: () => sessionInfoResponse({ diagramType: 'Sequence' }) });

    const init = await postWithEnv(initializeRpc(), env);
    expect(init.json.result.instructions).toMatch(/This is ZenUML/);

    const list = await postWithEnv(rpc('tools/list'), env);
    const update = list.json.result.tools.find((t: { name: string }) => t.name === 'update_diagram');
    expect(update.description).toMatch(/ZenUML DSL/);
  });

  it('a bound plantuml session gets the PlantUML guide', async () => {
    const env = makeDoEnv({ session: () => sessionInfoResponse({ diagramType: 'PlantUml' }) });

    const init = await postWithEnv(initializeRpc(), env);
    expect(init.json.result.instructions).toMatch(/This is PlantUML/);
  });

  it('a bound Graph session gets NO instructions and a generic update_diagram description (never broken)', async () => {
    const env = makeDoEnv({ session: () => sessionInfoResponse({ diagramType: 'Graph' }) });

    const init = await postWithEnv(initializeRpc(), env);
    expect(init.res.status).toBe(200);
    expect(init.json.result.instructions).toBeUndefined();

    const list = await postWithEnv(rpc('tools/list'), env);
    expect(list.res.status).toBe(200);
    const update = list.json.result.tools.find((t: { name: string }) => t.name === 'update_diagram');
    // base description present, but no dialect-specific DSL hint
    expect(update.description).toMatch(/Replace the bound diagram's DSL/);
    expect(update.description).not.toMatch(/ZenUML DSL|Mermaid DSL|PlantUML DSL/);
  });

  it('a bound OpenApi session gets its own minimal spec guide (budget-permitting tier)', async () => {
    const env = makeDoEnv({ session: () => sessionInfoResponse({ diagramType: 'OpenApi' }) });

    const init = await postWithEnv(initializeRpc(), env);
    expect(init.json.result.instructions).toMatch(/This is a SPEC, not a diagram DSL/);

    const list = await postWithEnv(rpc('tools/list'), env);
    const update = list.json.result.tools.find((t: { name: string }) => t.name === 'update_diagram');
    expect(update.description).toMatch(/OpenAPI\/Swagger/);
  });

  it('an AsyncApi session still gets no guide (generic behavior — no guide authored for it)', async () => {
    const env = makeDoEnv({ session: () => sessionInfoResponse({ diagramType: 'AsyncApi' }) });

    const init = await postWithEnv(initializeRpc(), env);
    expect(init.json.result.instructions).toBeUndefined();
  });

  it('before any read_diagram (no lastDiagram) the combined cross-dialect guide is served', async () => {
    const env = makeDoEnv({ session: () => sessionInfoResponse() });

    const init = await postWithEnv(initializeRpc(), env);
    expect(init.json.result.instructions).toMatch(/DO NOT blend/);

    const list = await postWithEnv(rpc('tools/list'), env);
    const update = list.json.result.tools.find((t: { name: string }) => t.name === 'update_diagram');
    expect(update.description).toMatch(/must match the bound diagram type/);
  });
});
