import { describe, it, expect, vi } from 'vitest';
import { onRequestPost, onRequestOptions } from './mcp';
import { onRequestPost as sessionPost } from './session';
import { sessionRegistry } from './registrySingleton';
import { TOKEN_TTL_MS } from './sessionToken';
import type { BoundContext } from './sessionToken';

const CTX: BoundContext = { cloudId: 'cloud-1', pageId: 'page-1', contentId: 'content-1' };

function rpc(method: string, params?: unknown, id: number | string = 1) {
  return { jsonrpc: '2.0', id, method, params };
}

function makeRequest(
  body: unknown,
  opts: { token?: string; viaQuery?: boolean; rawBody?: string } = {},
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

  return new Request(url, {
    method: 'POST',
    headers,
    body: opts.rawBody ?? JSON.stringify(body),
  });
}

async function post(body: unknown, opts?: { token?: string; viaQuery?: boolean; rawBody?: string }) {
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
    record.issuedAtMs = Date.now() - TOKEN_TTL_MS - 1;

    const { res, json } = await post(rpc('tools/list'), { token: record.token });

    expect(res.status).toBe(403);
    expect(json.error.data?.code).toBe('expired');
  });

  it('tools/list returns the 4 tools for a valid token', async () => {
    const record = sessionRegistry.create(CTX);

    const { res, json } = await post(rpc('tools/list'), { token: record.token });

    expect(res.status).toBe(200);
    expect(json.result.tools).toHaveLength(4);
    expect(json.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(
      ['get_status', 'read_diagram', 'read_page', 'update_diagram'].sort(),
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
    expect(json.result.stubbed).toBe(true);
    expect(json.result.pageId).toBe(CTX.pageId);
  });

  it('tools/call update_diagram returns the stubbed ok/version/rendered shape', async () => {
    const record = sessionRegistry.create(CTX);

    const { res, json } = await post(
      rpc('tools/call', { name: 'update_diagram', arguments: { dsl: 'A->B: hi' } }),
      { token: record.token },
    );

    expect(res.status).toBe(200);
    expect(json.result).toMatchObject({ ok: true, rendered: true, stubbed: true });
    expect(typeof json.result.version).toBe('number');
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

  it('initialize returns a protocol/capabilities stub', async () => {
    const record = sessionRegistry.create(CTX);

    const { res, json } = await post(rpc('initialize'), { token: record.token });

    expect(res.status).toBe(200);
    expect(json.result.protocolVersion).toBeTruthy();
    expect(json.result.capabilities).toBeDefined();
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
    expect(json.result.tools).toHaveLength(4);
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
      if (url.endsWith('/session')) {
        return responses.session ? responses.session() : new Response(null, { status: 404 });
      }
      if (url.endsWith('/agent-op')) {
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

function sessionInfoResponse(overrides: Partial<{ state: string; issuedAtMs: number }> = {}): Response {
  return new Response(
    JSON.stringify({
      state: overrides.state ?? 'created',
      boundContext: CTX,
      issuedAtMs: overrides.issuedAtMs ?? Date.now(),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
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
    expect(json.result).toEqual({ pageId: 'page-1', title: 'Real title', text: 'Real text' });
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
});
