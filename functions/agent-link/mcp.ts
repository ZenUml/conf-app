// POST /agent-link/mcp — the hosted MCP endpoint the local agent's
// conf-agent MCP client connects to. Token-authenticated (design §8: "Token
// = auth"), routes a minimal JSON-RPC 2.0 envelope to the 4-tool surface
// (design §6).
//
// See docs/superpowers/specs/2026-07-08-live-agent-link-design.md §5.2
// (relay components), §5.3 (conf-agent MCP remote-HTTP mode), §6 (MCP tool
// surface).
//
// Real macro-forwarding: when `env.AGENT_LINK` is bound (staging/prod — see
// wrangler-stg.toml), both authentication and `tools/call` forwarding go
// through the AgentLinkSession Durable Object for this token
// (`env.AGENT_LINK.get(idFromName(token))` — the same DO instance the macro
// bootstrapped via its `GET /channel` connect, regardless of which Worker
// isolate this HTTP request landed on). That's the fix for the bug this
// replaces: the old `sessionRegistry` was a per-isolate in-memory Map, so a
// token minted on one isolate 401'd whenever the mcp request landed on a
// different one.
//
// `env.AGENT_LINK` absent (local dev / unit tests — no companion Worker
// bound, see channel.ts's matching fallback): falls back to the original
// in-memory `sessionRegistry` + a canned-response stub for
// `forwardToMacro`, so local dev and this file's own tests that don't wire
// up a DO stub keep working unchanged.
// TODO(agent-link): once every environment (incl. wrangler-dev.toml) has a
// companion Worker + AGENT_LINK binding, drop this fallback branch.

import { authenticateSession } from './mcpAuth';
import type { AuthResult } from './mcpAuth';
import { dispatchTool, getToolSchemas, ToolError } from './mcpTools';
import type { DispatchContext, ForwardResult, ToolName } from './mcpTools';
import { sessionRegistry } from './registrySingleton';
import { TOKEN_TTL_MS } from './sessionToken';
import type { SessionRecord, SessionState } from './sessionToken';

interface Env {
  AGENT_LINK?: DurableObjectNamespace;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

type JsonRpcId = string | number | null;

interface JsonRpcRequestBody {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

// JSON-RPC 2.0 reserved error codes, plus two relay-specific codes in the
// (-32000..-32099) "server error" range reserved for implementation-defined errors.
const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_AUTH_ERROR = -32001;
const RPC_UNKNOWN_TOOL = -32002;
const RPC_MACRO_ERROR = -32003;

function jsonRpcResult(id: JsonRpcId, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

/**
 * `status` is the HTTP status: transport-level failures (auth, malformed
 * body) get a non-200 so the agent's HTTP client can short-circuit; a
 * JSON-RPC-level error once the request was well-formed and authenticated
 * (e.g. an unknown tool name) still returns HTTP 200 with an `error` envelope,
 * per JSON-RPC-over-HTTP convention.
 */
function jsonRpcError(
  status: number,
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): Response {
  const error: Record<string, unknown> = { code, message };
  if (data !== undefined) error.data = data;
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, error }), { status, headers: JSON_HEADERS });
}

function authErrorMessage(code: 'missing' | 'invalid' | 'expired'): string {
  switch (code) {
    case 'missing':
      return 'Missing session token';
    case 'invalid':
      return 'Invalid session token';
    case 'expired':
      return 'Session token expired';
  }
}

function extractToken(request: Request, url: URL): string | undefined {
  const authHeader = request.headers.get('Authorization');
  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
  const bearerToken = bearerMatch?.[1]?.trim();
  if (bearerToken) return bearerToken;

  const queryToken = url.searchParams.get('token');
  return queryToken?.trim() || undefined;
}

/** The DO's `POST /agent-op` response body shape, once auth (checked separately) has passed. */
interface AgentOpResponseBody {
  ok: boolean;
  payload: ForwardResult;
}

/** The DO's `GET /session` response body shape for a live session. */
interface DoSessionInfo {
  state: SessionState;
  boundContext: SessionRecord['boundContext'];
  issuedAtMs: number;
}

export type MacroForwardErrorCode = 'macro_not_connected' | 'macro_timeout' | 'bad_response';

/** Thrown by `doForwardToMacro` when the DO round-trip itself fails (as opposed to `ToolError`, which is a bad request). */
export class MacroForwardError extends Error {
  readonly code: MacroForwardErrorCode;

  constructor(code: MacroForwardErrorCode, message: string) {
    super(message);
    this.name = 'MacroForwardError';
    this.code = code;
  }
}

/**
 * Authenticates `token` against the AgentLinkSession DO for this exact
 * token (`idFromName(token)` — the same DO instance the macro's `GET
 * /channel` connect bootstrapped a SessionRecord into, regardless of which
 * Worker isolate this request landed on). This is the fix for the
 * cross-isolate 401: `sessionRegistry` below is a per-isolate in-memory Map
 * and cannot see a session minted on a different isolate; the DO can, since
 * Durable Objects are single-instance-per-id across the whole account.
 */
async function authenticateViaDo(agentLink: DurableObjectNamespace, token: string): Promise<AuthResult> {
  const stub = agentLink.get(agentLink.idFromName(token));
  const res = await stub.fetch('https://agent-link-do/session', { method: 'GET' });

  if (res.status === 401) return { ok: false, code: 'invalid' };
  if (res.status === 403) return { ok: false, code: 'expired' };
  if (!res.ok) return { ok: false, code: 'invalid' }; // defensive: unexpected status treated as unauthenticated

  const info = (await res.json()) as DoSessionInfo;
  const session: SessionRecord = {
    token,
    boundContext: info.boundContext,
    scope: 'read-page+write-diagram',
    issuedAtMs: info.issuedAtMs,
    state: info.state,
  };
  return { ok: true, session };
}

/**
 * Real macro-forwarding: sends `op`/`args` to the AgentLinkSession DO's
 * `POST /agent-op`, which relays it to the paired macro's WebSocket and
 * awaits the matching `result`/`error` envelope (see AgentLinkSession.ts).
 * One call per tool invocation mints a fresh `id` so the DO can correlate
 * this specific request with the macro's eventual reply.
 */
function doForwardToMacro(agentLink: DurableObjectNamespace, token: string) {
  return async (op: ToolName, payload: Record<string, unknown>): Promise<ForwardResult> => {
    const stub = agentLink.get(agentLink.idFromName(token));
    const id = crypto.randomUUID();

    const res = await stub.fetch('https://agent-link-do/agent-op', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, op, args: payload }),
    });

    if (res.status === 409) {
      throw new MacroForwardError('macro_not_connected', 'The paired macro is not currently connected.');
    }
    if (res.status === 504) {
      throw new MacroForwardError('macro_timeout', 'The paired macro did not respond in time.');
    }
    if (!res.ok) {
      throw new MacroForwardError('bad_response', `Unexpected relay response: HTTP ${res.status}`);
    }

    let body: AgentOpResponseBody;
    try {
      body = (await res.json()) as AgentOpResponseBody;
    } catch {
      throw new MacroForwardError('bad_response', 'Relay response was not valid JSON');
    }
    return body.payload;
  };
}

/**
 * STUB macro-forwarding: returns a fixed shape per op so the endpoint's
 * request/response contract is fully exercisable when no AGENT_LINK DO
 * binding is available (local dev / this file's own tests that don't wire
 * up a DO stub — see file header).
 */
function stubForwardToMacro(session: SessionRecord) {
  return async (op: ToolName, payload: Record<string, unknown>): Promise<ForwardResult> => {
    switch (op) {
      case 'read_page':
        return {
          pageId: session.boundContext.pageId,
          title: 'Stub page title',
          text: 'Stub page text — macro-forwarding is not yet wired up.',
          stubbed: true,
        };

      case 'read_diagram':
        return {
          contentId: session.boundContext.contentId,
          diagramType: 'Sequence',
          dsl: 'A->B: stub',
          stubbed: true,
        };

      case 'update_diagram':
        return {
          ok: true,
          version: 1,
          rendered: true,
          stubbed: true,
        };

      case 'get_status': {
        const expiresInSec = Math.max(
          0,
          Math.round((session.issuedAtMs + TOKEN_TTL_MS - Date.now()) / 1000),
        );
        return {
          connected: true,
          diagramType: 'Sequence',
          page: session.boundContext.pageId,
          expiresInSec,
          stubbed: true,
        };
      }

      default:
        // Unreachable: dispatchTool only calls forwardToMacro for known ops.
        return { stubbed: true, op, payload };
    }
  };
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: CORS_HEADERS });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const token = extractToken(request, url);

  // Cheap, local, no-I/O check — a blank/absent token can never authenticate
  // anywhere, so there's no reason to round-trip to the DO (or the fallback
  // registry) to find that out. Real token *validity* (known vs. unknown,
  // expired vs. live) is answered below by whichever backing store is live
  // in this environment.
  if (!token || token.trim().length === 0) {
    return jsonRpcError(401, null, RPC_AUTH_ERROR, authErrorMessage('missing'), { code: 'missing' });
  }

  const auth = env?.AGENT_LINK
    ? await authenticateViaDo(env.AGENT_LINK, token)
    : authenticateSession(token, sessionRegistry, Date.now());
  if (!auth.ok) {
    const status = auth.code === 'expired' ? 403 : 401;
    return jsonRpcError(status, null, RPC_AUTH_ERROR, authErrorMessage(auth.code), { code: auth.code });
  }

  let body: JsonRpcRequestBody;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(400, null, RPC_PARSE_ERROR, 'Parse error: invalid JSON body');
  }

  if (!body || typeof body !== 'object' || typeof body.method !== 'string') {
    return jsonRpcError(400, body?.id ?? null, RPC_INVALID_REQUEST, 'Invalid Request: missing "method"');
  }

  const id = body.id ?? null;

  // JSON-RPC notifications (`notifications/*`) expect NO response. A
  // spec-compliant MCP client (Claude Code, the MCP SDK) POSTs
  // `notifications/initialized` immediately after `initialize` — falling
  // through to the switch's `default` returns 400 "Unknown method" and aborts
  // the client's connect handshake. This is why `claude mcp add …/agent-link/mcp`
  // fails even though raw `tools/call` works (curl skips the notification; a
  // real MCP SDK client surfaced it). Acknowledge with 202 Accepted + empty
  // body, per the Streamable HTTP transport.
  if (body.method.startsWith('notifications/')) {
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  switch (body.method) {
    case 'initialize':
      return jsonRpcResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'conf-agent-link', version: '0.1.0' },
      });

    case 'tools/list':
      return jsonRpcResult(id, { tools: getToolSchemas() });

    case 'tools/call': {
      const params = (body.params ?? {}) as { name?: unknown; arguments?: unknown };
      if (typeof params.name !== 'string') {
        return jsonRpcError(400, id, RPC_INVALID_PARAMS, 'tools/call requires a "name" string');
      }

      const ctx: DispatchContext = {
        session: auth.session,
        forwardToMacro: env?.AGENT_LINK
          ? doForwardToMacro(env.AGENT_LINK, token)
          : stubForwardToMacro(auth.session),
      };

      try {
        const result = await dispatchTool(params.name, params.arguments, ctx);
        return jsonRpcResult(id, result);
      } catch (err) {
        if (err instanceof ToolError) {
          const code = err.code === 'bad_args' ? RPC_INVALID_PARAMS : RPC_UNKNOWN_TOOL;
          return jsonRpcError(200, id, code, err.message, { code: err.code });
        }
        if (err instanceof MacroForwardError) {
          const status = err.code === 'macro_not_connected' ? 409 : err.code === 'macro_timeout' ? 504 : 502;
          return jsonRpcError(status, id, RPC_MACRO_ERROR, err.message, { code: err.code });
        }
        throw err;
      }
    }

    default:
      return jsonRpcError(400, id, RPC_METHOD_NOT_FOUND, `Unknown method: ${body.method}`);
  }
};
