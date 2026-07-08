// POST /agent-link/mcp — the hosted MCP endpoint the local agent's
// conf-agent MCP client connects to. Token-authenticated (design §8: "Token
// = auth"), routes a minimal JSON-RPC 2.0 envelope to the 4-tool surface
// (design §6).
//
// See docs/superpowers/specs/2026-07-08-live-agent-link-design.md §5.2
// (relay components), §5.3 (conf-agent MCP remote-HTTP mode), §6 (MCP tool
// surface).
//
// Scope of THIS task: everything here is real EXCEPT the actual
// macro-forwarding, which is stubbed (`stubForwardToMacro` below) — the live
// Durable-Object/WS link that would carry a tool call to the paired macro
// and back is a later task (see AgentLinkSession.ts).

import { authenticateSession } from './mcpAuth';
import { dispatchTool, getToolSchemas, ToolError } from './mcpTools';
import type { DispatchContext, ForwardResult, ToolName } from './mcpTools';
import { sessionRegistry } from './registrySingleton';
import { TOKEN_TTL_MS } from './sessionToken';
import type { SessionRecord } from './sessionToken';

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

/**
 * STUB macro-forwarding: returns a fixed shape per op so the endpoint's
 * request/response contract is fully exercisable before the live
 * relay<->macro link exists.
 *
 * TODO(agent-link): forward to the paired macro via AgentLinkSession DO
 * (see AgentLinkSession.ts's planned `fetch` behavior) instead of returning
 * canned data.
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

export const onRequestPost: PagesFunction = async ({ request }) => {
  const url = new URL(request.url);
  const token = extractToken(request, url);

  const auth = authenticateSession(token, sessionRegistry, Date.now());
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
        forwardToMacro: stubForwardToMacro(auth.session),
      };

      try {
        const result = await dispatchTool(params.name, params.arguments, ctx);
        return jsonRpcResult(id, result);
      } catch (err) {
        if (err instanceof ToolError) {
          const code = err.code === 'bad_args' ? RPC_INVALID_PARAMS : RPC_UNKNOWN_TOOL;
          return jsonRpcError(200, id, code, err.message, { code: err.code });
        }
        throw err;
      }
    }

    default:
      return jsonRpcError(400, id, RPC_METHOD_NOT_FOUND, `Unknown method: ${body.method}`);
  }
};
