// /agent-link/mcp — the fixed hosted endpoint installed once in a coding
// agent. A public Streamable HTTP handshake issues Mcp-Session-Id; the
// `connect(code)` tool consumes one Macro-minted linking capability and binds
// that transport session to the open Macro. Later tool calls carry only the
// MCP session id — never the one-time code as a persistent credential.
//
// See docs/superpowers/specs/2026-07-08-live-agent-link-design.md §5.2
// (relay components), §5.3 (conf-agent MCP remote-HTTP mode), §6 (MCP tool
// surface).
//
// Real macro-forwarding: when `env.AGENT_LINK` is bound (staging/prod — see
// wrangler-stg.toml), both authentication and `tools/call` forwarding go
// through the AgentLinkSession Durable Object for the paired target token
// (`env.AGENT_LINK.get(idFromName(token))` — the same DO instance the macro
// bootstrapped via its `GET /channel` connect, regardless of which Worker
// isolate this HTTP request landed on). That's the fix for the bug this
// replaces: the old `sessionRegistry` was a per-isolate in-memory Map, so a
// token minted on one isolate 401'd whenever the mcp request landed on a
// different one.
//
// `env.AGENT_LINK` absent (local dev / unit tests — no companion Worker
// bound, see channel.ts's matching fallback): falls back to the in-memory
// session and MCP-binding registries + a canned-response stub for
// `forwardToMacro`, so local dev and this file's own tests that don't wire
// up a DO stub keep working unchanged.
// TODO(agent-link): once every environment (incl. wrangler-dev.toml) has a
// companion Worker + AGENT_LINK binding, drop this fallback branch.

import { authenticateSession } from './mcpAuth';
import type { AuthResult } from './mcpAuth';
import { mcpBindingRegistry } from './mcpBindingRegistry';
import { negotiateMcpCompatibility, normalizeAgentClientLabel, isSupportedMcpProtocolVersion, LATEST_MCP_PROTOCOL_VERSION, SUPPORTED_MCP_PROTOCOL_VERSIONS } from './mcpProtocol';
import { dispatchTool, getToolSchemas, ToolError } from './mcpTools';
import type { DispatchContext, ForwardResult, ToolName } from './mcpTools';
import type { DiagramSnapshot } from './updateDiagramGuard';
import { getGuideByUri, listGuideResources, selectInstructions } from './dslGuides';
import { sessionRegistry } from './registrySingleton';
import { effectiveExpiryMs } from './sessionToken';
import type { SessionRecord, SessionState } from './sessionToken';

interface Env {
  AGENT_LINK?: DurableObjectNamespace;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
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
// The update_diagram guardrail rejected the DSL (parse error / data-loss)
// before any macro round-trip — see mcpTools.ts + updateDiagramGuard.ts.
const RPC_GUARDRAIL_REJECTED = -32004;

function jsonRpcResult(id: JsonRpcId, result: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { ...JSON_HEADERS, ...headers },
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
  /** Last bump-worthy activity (sliding-TTL, spec 2026-07-13 §3). Absent on
   * records persisted by pre-sliding-TTL code — falls back to issuedAtMs. */
  lastActivityMs?: number;
  /**
   * Last-known {diagramType, dsl} the DO cached from the agent's read_diagram
   * / prior update_diagram — the synchronous baseline the update_diagram
   * guardrail (updateDiagramGuard.ts) parses and length-checks against. Absent
   * until the agent has read the diagram at least once.
   */
  lastDiagram?: DiagramSnapshot;
}

type PairingResult =
  | { ok: true; expiresAtMs: number }
  | {
      ok: false;
      code: 'invalid_code' | 'expired_code' | 'code_already_used' | 'target_unavailable' | 'binding_failed';
    };

async function pairViaDo(
  agentLink: DurableObjectNamespace,
  code: string,
  mcpSessionId: string,
  clientName?: string,
): Promise<PairingResult> {
  const previousToken = await resolveBindingViaDo(agentLink, mcpSessionId);
  const target = agentLink.get(agentLink.idFromName(code));
  const claim = await target.fetch('https://agent-link-do/mcp-claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mcpSessionId, clientName }),
  });
  if (!claim.ok) {
    let error = '';
    try {
      error = ((await claim.json()) as { error?: string }).error ?? '';
    } catch {
      // The stable code below is derived from the HTTP status.
    }
    if (error === 'code_already_used') return { ok: false, code: 'code_already_used' };
    if (error === 'target_unavailable') return { ok: false, code: 'target_unavailable' };
    if (claim.status === 403) return { ok: false, code: 'expired_code' };
    return { ok: false, code: 'invalid_code' };
  }

  try {
    const claimBody = (await claim.json()) as { expiresAtMs?: unknown; bindingExpiresAtMs?: unknown };
    if (typeof claimBody.expiresAtMs !== 'number' || !Number.isFinite(claimBody.expiresAtMs)) throw new Error('invalid claim');
    // A mapping lives until the absolute cap. Target auth checks the current
    // sliding idle deadline on every call; caching the initial idle deadline
    // here used to disconnect an actively-used link at minute ten.
    const binding = agentLink.get(agentLink.idFromName(`mcp:${mcpSessionId}`));
    const stored = await binding.fetch('https://agent-link-do/mcp-binding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: code, expiresAtMs: claimBody.bindingExpiresAtMs ?? claimBody.expiresAtMs, expectedToken: previousToken ?? null }),
    });
    if (!stored.ok) throw new Error('binding write failed');
    // Report successful pairing only after the transport mapping is durable.
    const confirmed = await target.fetch(`https://agent-link-do/session?${new URLSearchParams({
      presence: 'verified', mcpSessionId, ...(clientName ? { client: clientName } : {}),
    })}`, { method: 'GET' });
    if (!confirmed.ok) throw new Error('pairing confirmation failed');
    if (previousToken && previousToken !== code) {
      await agentLink.get(agentLink.idFromName(previousToken)).fetch('https://agent-link-do/mcp-release', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpSessionId }),
      }).catch(() => {});
    }
    return { ok: true, expiresAtMs: claimBody.expiresAtMs };
  } catch {
    // Claiming a code without storing its mapping must remain retryable.
    // This release is owner-aware, so a late failure cannot revoke a new owner.
    try {
      if (previousToken !== code) await target.fetch('https://agent-link-do/mcp-release', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpSessionId }),
      });
    } catch { /* target TTL bounds an unavailable rollback */ }
    return { ok: false, code: 'binding_failed' };
  }
}

async function resolveBindingViaDo(
  agentLink: DurableObjectNamespace,
  mcpSessionId: string,
): Promise<string | undefined> {
  const binding = agentLink.get(agentLink.idFromName(`mcp:${mcpSessionId}`));
  const res = await binding.fetch('https://agent-link-do/mcp-binding', { method: 'GET' });
  if (!res.ok) return undefined;
  const body = (await res.json()) as { token?: unknown };
  return typeof body.token === 'string' && body.token ? body.token : undefined;
}

// 'macro_disconnected' (Track G, design §7 decision #4): the session is
// 'suspended' — the macro dropped without an explicit disconnect and hasn't
// reattached yet. RETRIABLE, unlike the other codes here: the agent should
// retry after `resume_deadline` rather than treat this as a dead session.
export type MacroForwardErrorCode = 'macro_not_connected' | 'macro_timeout' | 'bad_response' | 'macro_disconnected';

/** Thrown by `doForwardToMacro` when the DO round-trip itself fails (as opposed to `ToolError`, which is a bad request). */
export class MacroForwardError extends Error {
  readonly code: MacroForwardErrorCode;
  /**
   * Structured JSON-RPC error `data` override for this specific error. Only
   * set for 'macro_disconnected' — design's exact contract is
   * `{reason:'macro_disconnected', resume_deadline}` (note: `reason`, not the
   * `{code}` shape every other MacroForwardError falls back to below).
   */
  readonly data?: Record<string, unknown>;

  constructor(code: MacroForwardErrorCode, message: string, data?: Record<string, unknown>) {
    super(message);
    this.name = 'MacroForwardError';
    this.code = code;
    this.data = data;
  }
}

// Presence stage, spec 2026-08-15: "how far has a real client got" through
// the MCP handshake/tool surface, derived per request from the method — NOT
// from bump-worthiness (presence never slides the idle TTL; Task 3 enforces
// that DO-side, and `bump` below keeps the byte-identical 2026-07-13
// definition). Task 3's DO endpoint reads this off the auth GET's query
// string and pushes it to the paired macro's status bus.
export type PresenceStage = 'initialized' | 'discovered' | 'verified' | 'working';

function derivePresence(body: JsonRpcRequestBody, bumpWorthy: boolean): PresenceStage {
  if (bumpWorthy) return 'working';
  const m = body.method ?? '';
  if (m === 'initialize' || m.startsWith('notifications/')) return 'initialized';
  if (m === 'tools/call') return 'verified'; // only get_status reaches here non-bump
  return 'discovered'; // tools/list, resources/list
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
async function authenticateViaDo(
  agentLink: DurableObjectNamespace,
  token: string,
  bump: boolean,
  presence: PresenceStage,
  clientName?: string,
  mcpSessionId?: string,
): Promise<{ auth: AuthResult; diagram?: DiagramSnapshot }> {
  const stub = agentLink.get(agentLink.idFromName(token));
  // `?bump=1` iff this request is bump-worthy (real agent work): the DO slides
  // the idle window and pushes a fresh status on the same auth round-trip that
  // already happens on every request, so no extra network hop (spec §3/§4.2).
  // `presence` always rides along (Task 3's DO endpoint currently ignores
  // unknown query params, so this is backward-tolerant); `client` only on
  // `initialize`, when the MCP client first announces itself.
  const qs = new URLSearchParams();
  if (bump) qs.set('bump', '1');
  qs.set('presence', presence);
  if (mcpSessionId) qs.set('mcpSessionId', mcpSessionId);
  if (clientName !== undefined) qs.set('client', clientName);
  const res = await stub.fetch(`https://agent-link-do/session?${qs.toString()}`, {
    method: 'GET',
  });

  if (res.status === 401) return { auth: { ok: false, code: 'invalid' } };
  if (res.status === 403) return { auth: { ok: false, code: 'expired' } };
  if (!res.ok) return { auth: { ok: false, code: 'invalid' } }; // defensive: unexpected status treated as unauthenticated

  const info = (await res.json()) as DoSessionInfo;
  const session: SessionRecord = {
    token,
    boundContext: info.boundContext,
    scope: 'read-page+write-diagram',
    issuedAtMs: info.issuedAtMs,
    lastActivityMs: typeof info.lastActivityMs === 'number' ? info.lastActivityMs : info.issuedAtMs,
    state: info.state,
  };
  // The diagram snapshot rides back on the auth round-trip that already happens
  // on every request, so the update_diagram guardrail stays synchronous with no
  // extra network hop (see updateDiagramGuard.ts's design note).
  return { auth: { ok: true, session }, diagram: info.lastDiagram };
}

/**
 * Real macro-forwarding: sends `op`/`args` to the AgentLinkSession DO's
 * `POST /agent-op`, which relays it to the paired macro's WebSocket and
 * awaits the matching `result`/`error` envelope (see AgentLinkSession.ts).
 * One call per tool invocation mints a fresh `id` so the DO can correlate
 * this specific request with the macro's eventual reply.
 */
function doForwardToMacro(agentLink: DurableObjectNamespace, token: string, mcpSessionId?: string) {
  return async (op: ToolName, payload: Record<string, unknown>): Promise<ForwardResult> => {
    const stub = agentLink.get(agentLink.idFromName(token));
    const id = crypto.randomUUID();

    const res = await stub.fetch('https://agent-link-do/agent-op', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, op, args: payload, mcpSessionId }),
    });

    if (res.status === 409) {
      // Two distinct 409s from the DO (handleAgentOp): 'macro_not_connected'
      // (no macro has ever paired, or it's genuinely gone) vs
      // 'macro_disconnected' (the session is 'suspended' — the macro dropped
      // but may still reattach within the resume window). Inspect the body
      // to tell them apart rather than collapsing both to the same code.
      let body: { error?: string; resume_deadline?: number } = {};
      try {
        body = await res.json();
      } catch {
        // Fall through to the generic code below.
      }
      if (body.error === 'macro_disconnected') {
        throw new MacroForwardError(
          'macro_disconnected',
          'The macro disconnected; waiting for it to reconnect.',
          { reason: 'macro_disconnected', resume_deadline: body.resume_deadline },
        );
      }
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
          // Echo the requested contentId when the agent asked for a specific
          // one (S5), else the bound diagram — so the stub reflects the arg.
          contentId:
            typeof payload.contentId === 'string' ? payload.contentId : session.boundContext.contentId,
          diagramType: 'Sequence',
          title: 'Stub diagram',
          pageId: session.boundContext.pageId,
          dsl: 'A->B: stub',
          version: 1,
          stubbed: true,
        };

      case 'search_diagrams':
      case 'list_diagrams':
        // No live macro/Confluence in local-dev/stub — return an empty ROW
        // ARRAY (the real result shape, design §3) so the contract is exercisable.
        return [];

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
          Math.round((effectiveExpiryMs(session.issuedAtMs, session.lastActivityMs) - Date.now()) / 1000),
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

export async function onRequestGet(): Promise<Response> {
  return new Response(JSON.stringify({ error: 'Use POST for MCP messages.' }), {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: 'POST, DELETE, OPTIONS' },
  });
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const mcpSessionId = request.headers.get('Mcp-Session-Id')?.trim();
  if (!mcpSessionId) {
    return new Response(JSON.stringify({ error: 'Mcp-Session-Id is required' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const protocol = request.headers.get('MCP-Protocol-Version');
  if (protocol && !isSupportedMcpProtocolVersion(protocol)) {
    return new Response(JSON.stringify({ error: 'Unsupported MCP-Protocol-Version' }), { status: 400, headers: JSON_HEADERS });
  }
  if (env?.AGENT_LINK) {
    try {
      const binding = env.AGENT_LINK.get(env.AGENT_LINK.idFromName(`mcp:${mcpSessionId}`));
      const terminated = await binding.fetch('https://agent-link-do/mcp-transport', { method: 'DELETE' });
      if (!terminated.ok) return new Response(null, { status: terminated.status === 404 ? 404 : 503, headers: CORS_HEADERS });
      const { token } = await terminated.json() as { token?: string };
      if (token) {
        // The mapping was atomically removed with the transport. New writes
        // now fail, and an in-flight claim rolls itself back on that failure.
        await env.AGENT_LINK.get(env.AGENT_LINK.idFromName(token)).fetch('https://agent-link-do/mcp-release', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mcpSessionId }),
        }).catch(() => {});
      }
    } catch {
      return new Response(null, { status: 503, headers: CORS_HEADERS });
    }
  } else {
    if (!mcpBindingRegistry.getClient(mcpSessionId)) return new Response(null, { status: 404, headers: CORS_HEADERS });
    mcpBindingRegistry.release(mcpSessionId);
    mcpBindingRegistry.forgetClient(mcpSessionId);
  }
  return new Response(null, { status: 200, headers: CORS_HEADERS });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const legacyToken = extractToken(request, url);
  let token: string | undefined;

  // Parse before auth: only actual tool activity extends the target deadline.
  let body: JsonRpcRequestBody;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(400, null, RPC_PARSE_ERROR, 'Parse error: invalid JSON body');
  }

  if (!body || typeof body !== 'object' || typeof body.method !== 'string') {
    return jsonRpcError(400, body?.id ?? null, RPC_INVALID_REQUEST, 'Invalid Request: missing "method"');
  }

  // A linking code is a one-time pairing capability, never a reusable MCP
  // transport credential. Reject the old setup shape explicitly so a copied
  // code cannot bypass the one-session claim by being replayed as Bearer auth.
  if (legacyToken && !request.headers.get('Mcp-Session-Id') && body.method !== 'initialize') {
    return jsonRpcError(401, body.id ?? null, RPC_AUTH_ERROR, 'Mcp-Session-Id is required', {
      code: 'mcp_session_missing',
    });
  }

  // A fixed Remote MCP endpoint must be able to complete its transport
  // handshake before the user has a Macro linking code. The server-issued
  // MCP session id is the stable client-session identity that `connect(code)`
  // binds when the user supplies a one-time linking code.
  if (body.method === 'initialize') {
    const compatibility = negotiateMcpCompatibility(body.params);
    if (!compatibility.ok) {
      return jsonRpcError(400, body.id ?? null, RPC_INVALID_PARAMS, compatibility.message, { code: compatibility.code });
    }
    const mcpSessionId = crypto.randomUUID();
    const clientName = normalizeAgentClientLabel(body.params);
    if (env?.AGENT_LINK) {
      const transport = env.AGENT_LINK.get(env.AGENT_LINK.idFromName(`mcp:${mcpSessionId}`));
      const stored = await transport.fetch('https://agent-link-do/mcp-transport', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName, expiresAtMs: Date.now() + 24 * 60 * 60 * 1000 }),
      });
      if (!stored.ok) return jsonRpcError(503, body.id ?? null, RPC_AUTH_ERROR, 'Unable to start MCP session');
    } else {
      mcpBindingRegistry.rememberClient(mcpSessionId, clientName);
    }
    return jsonRpcResult(body.id ?? null, {
      protocolVersion: compatibility.protocolVersion,
      capabilities: compatibility.capabilities,
      serverInfo: { name: 'conf-agent-link', version: '0.1.0' },
      instructions: selectInstructions(undefined),
    }, { 'Mcp-Session-Id': mcpSessionId });
  }

  const mcpSessionId = request.headers.get('Mcp-Session-Id')?.trim();
  let clientName: string | undefined;
  if (mcpSessionId) {
    if (env?.AGENT_LINK) {
      const metadata = await env.AGENT_LINK.get(env.AGENT_LINK.idFromName(`mcp:${mcpSessionId}`))
        .fetch('https://agent-link-do/mcp-transport', { method: 'GET' });
      if (metadata.ok) clientName = ((await metadata.json()) as { clientName?: string }).clientName;
    } else clientName = mcpBindingRegistry.getClient(mcpSessionId);
    if (!clientName) return jsonRpcError(404, body.id ?? null, RPC_AUTH_ERROR, 'MCP session ended. Initialize a new session.', { code: 'mcp_session_expired' });
  }


  const protocolHeader = request.headers.get('MCP-Protocol-Version')?.trim();
  if (protocolHeader && !isSupportedMcpProtocolVersion(protocolHeader)) {
    const mcpSessionId = request.headers.get('Mcp-Session-Id')?.trim();
    if (env?.AGENT_LINK && mcpSessionId) {
      const pairedToken = await resolveBindingViaDo(env.AGENT_LINK, mcpSessionId);
      if (pairedToken) {
        const target = env.AGENT_LINK.get(env.AGENT_LINK.idFromName(pairedToken));
        try {
          await target.fetch('https://agent-link-do/activity', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'protocol_incompatible', mcpSessionId }),
          });
        } catch { /* diagnostics never replace the protocol response */ }
      }
    }
    return jsonRpcError(400, body.id ?? null, RPC_INVALID_PARAMS, 'Unsupported MCP protocol version. Start a new agent session.', {
      code: 'protocol_version_mismatch', supported: [...SUPPORTED_MCP_PROTOCOL_VERSIONS], latest: LATEST_MCP_PROTOCOL_VERSION,
    });
  }

  // Clients probe a configured endpoint before initialize. Claude Code 2.1.240
  // uses `server/discover`; other MCP clients use the standard `ping`.
  // Keeping both public prevents a credential-free server from being mistaken
  // for an OAuth challenge.
  if (
    (!token || token.trim().length === 0) &&
    (body.method === 'ping' || body.method === 'server/discover')
  ) {
    return jsonRpcResult(body.id ?? null, {});
  }

  if (
    (!token || token.trim().length === 0) &&
    body.method === 'tools/list'
  ) {
    return jsonRpcResult(body.id ?? null, { tools: getToolSchemas() });
  }

  if (
    (!token || token.trim().length === 0) &&
    body.method === 'resources/list'
  ) {
    return jsonRpcResult(body.id ?? null, { resources: listGuideResources() });
  }

  if (
    (!token || token.trim().length === 0) &&
    body.method === 'resources/read'
  ) {
    const rparams = (body.params ?? {}) as { uri?: unknown };
    const guide = typeof rparams.uri === 'string' ? getGuideByUri(rparams.uri) : undefined;
    if (!guide) {
      return jsonRpcError(
        400,
        body.id ?? null,
        RPC_INVALID_PARAMS,
        `Unknown resource: ${String(rparams.uri)}`,
      );
    }
    return jsonRpcResult(body.id ?? null, {
      contents: [{ uri: guide.uri, mimeType: 'text/markdown', text: guide.text }],
    });
  }

  if (
    (!token || token.trim().length === 0) &&
    body.method.startsWith('notifications/')
  ) {
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  const unpairedCall = (body.params ?? {}) as { name?: unknown; arguments?: unknown };
  if (
    (!token || token.trim().length === 0) &&
    body.method === 'tools/call' &&
    unpairedCall.name === 'connect'
  ) {
    const mcpSessionId = request.headers.get('Mcp-Session-Id')?.trim();
    if (!mcpSessionId) {
      return jsonRpcError(400, body.id ?? null, RPC_INVALID_PARAMS, 'connect requires Mcp-Session-Id', {
        code: 'mcp_session_missing',
      });
    }
    const args = unpairedCall.arguments as { code?: unknown } | undefined;
    const code = typeof args?.code === 'string' ? args.code.trim() : '';
    if (!code) {
      return jsonRpcError(200, body.id ?? null, RPC_INVALID_PARAMS, 'connect requires a non-empty code', {
        code: 'invalid_code',
      });
    }

    // Local development mirrors pairing without Cloudflare bindings.
    if (!env?.AGENT_LINK) {
      const linkAuth = authenticateSession(code, sessionRegistry, Date.now());
      if (!linkAuth.ok) {
        const reason = linkAuth.code === 'expired' ? 'expired_code' : 'invalid_code';
        return jsonRpcError(200, body.id ?? null, RPC_AUTH_ERROR, `Unable to connect: ${reason}`, {
          code: reason,
        });
      }
      const claim = mcpBindingRegistry.bind(mcpSessionId, code);
      if (!claim.ok) {
        return jsonRpcError(200, body.id ?? null, RPC_AUTH_ERROR, 'This linking code was already used', {
          code: claim.code,
        });
      }
      const expiresInSec = Math.max(
        0,
        Math.round(
          (effectiveExpiryMs(linkAuth.session.issuedAtMs, linkAuth.session.lastActivityMs) - Date.now()) /
            1000,
        ),
      );
      const result = { connected: true, expiresInSec };
      return jsonRpcResult(body.id ?? null, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      });
    }

    // A failed switch keeps the existing pairing; successful replacement
    // releases the previous target after the new binding is committed.
    const pairing = await pairViaDo(env.AGENT_LINK, code, mcpSessionId, clientName);
    if (!pairing.ok) {
      return jsonRpcError(200, body.id ?? null, RPC_AUTH_ERROR, `Unable to connect: ${pairing.code}`, {
        code: pairing.code,
      });
    }
    const result = {
      connected: true,
      expiresInSec: Math.max(0, Math.round((pairing.expiresAtMs - Date.now()) / 1000)),
    };
    return jsonRpcResult(body.id ?? null, {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
    });
  }

  // After a successful local-dev `connect(code)`, normal tools resolve the
  // target from the stable MCP transport session rather than asking the
  // client to resend or persist the linking code.
  if ((!token || token.trim().length === 0) && !env?.AGENT_LINK) {
    const mcpSessionId = request.headers.get('Mcp-Session-Id')?.trim();
    if (mcpSessionId) token = mcpBindingRegistry.getToken(mcpSessionId);
  }
  if ((!token || token.trim().length === 0) && env?.AGENT_LINK) {
    const mcpSessionId = request.headers.get('Mcp-Session-Id')?.trim();
    if (mcpSessionId) token = await resolveBindingViaDo(env.AGENT_LINK, mcpSessionId);
  }

  if (
    (!token || token.trim().length === 0) &&
    request.headers.get('Mcp-Session-Id') &&
    body.method === 'tools/call'
  ) {
    return jsonRpcError(200, body.id ?? null, RPC_AUTH_ERROR, 'Call connect with a linking code first', {
      code: 'not_paired',
    });
  }

  if (!token || token.trim().length === 0) {
    return jsonRpcError(401, null, RPC_AUTH_ERROR, authErrorMessage('missing'), { code: 'missing' });
  }

  // Bump-worthiness (spec 2026-07-13 §3): real work slides the idle window;
  // passive/handshake traffic (get_status polls, tools/list, initialize,
  // resources/list) must not keep a dead session alive.
  const bumpParams = (body.params ?? {}) as { name?: unknown };
  const bumpWorthy =
    (body.method === 'tools/call' && bumpParams.name !== 'get_status') ||
    body.method === 'resources/read';

  let auth: AuthResult;
  let diagramSnapshot: DiagramSnapshot | undefined;
  if (env?.AGENT_LINK) {
    const doResult = await authenticateViaDo(
      env.AGENT_LINK,
      token,
      bumpWorthy,
      derivePresence(body, bumpWorthy),
      undefined,
      request.headers.get('Mcp-Session-Id') ?? undefined,
    );
    auth = doResult.auth;
    diagramSnapshot = doResult.diagram;
  } else {
    // Local dev / unit tests with no DO bound: no cached diagram snapshot, so
    // the update_diagram guardrail degrades to pass-through (documented in
    // updateDiagramGuard.ts). The fallback never bumps — sliding-TTL lives in
    // the DO, absent here.
    auth = authenticateSession(token, sessionRegistry, Date.now());
  }
  if (!auth.ok) {
    const status = auth.code === 'expired' ? 403 : 401;
    return jsonRpcError(status, null, RPC_AUTH_ERROR, authErrorMessage(auth.code), { code: auth.code });
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

  // The bound diagram's dialect, known only after the agent's first
  // read_diagram (the DO caches it into lastDiagram → diagramSnapshot). Drives
  // per-dialect serving below: a known DSL type gets that dialect's guide/hint,
  // a not-yet-known type gets the combined cross-dialect guide, and a known
  // non-DSL type (Graph/OpenApi/AsyncApi/Embed) gets no guide (generic). See
  // dslGuides.ts.
  const boundDiagramType = diagramSnapshot?.diagramType;

  switch (body.method) {
    case 'tools/list':
      // Sharpen the update_diagram hint to the bound dialect when known.
      return jsonRpcResult(id, { tools: getToolSchemas(boundDiagramType) });

    case 'resources/list':
      // Advertise all three dialect guides so the agent can pull whichever
      // matches its bound diagram type.
      return jsonRpcResult(id, { resources: listGuideResources() });

    case 'resources/read': {
      const rparams = (body.params ?? {}) as { uri?: unknown };
      const guide = typeof rparams.uri === 'string' ? getGuideByUri(rparams.uri) : undefined;
      if (!guide) {
        return jsonRpcError(400, id, RPC_INVALID_PARAMS, `Unknown resource: ${String(rparams.uri)}`);
      }
      return jsonRpcResult(id, {
        contents: [{ uri: guide.uri, mimeType: 'text/markdown', text: guide.text }],
      });
    }

    case 'tools/call': {
      const params = (body.params ?? {}) as { name?: unknown; arguments?: unknown };
      if (typeof params.name !== 'string') {
        return jsonRpcError(400, id, RPC_INVALID_PARAMS, 'tools/call requires a "name" string');
      }

      const ctx: DispatchContext = {
        session: auth.session,
        forwardToMacro: env?.AGENT_LINK
          ? doForwardToMacro(env.AGENT_LINK, token, request.headers.get('Mcp-Session-Id') ?? undefined)
          : stubForwardToMacro(auth.session),
        diagramSnapshot,
      };

      try {
        const result = await dispatchTool(params.name, params.arguments, ctx);
        // MCP `CallToolResult` REQUIRES a `content` array — a real MCP client
        // (Claude Code / the SDK) rejects a tool result without it with a
        // schema-validation error ("expected array, received undefined"). Raw
        // curl doesn't validate, which hid this until a real client connected.
        // Wrap the tool payload as a text block, and echo it as
        // structuredContent for clients that consume typed output.
        // structuredContent must be a JSON object per MCP — a search/list ROW
        // ARRAY result (design §3) is carried by the `content` text block only.
        const isRecordResult =
          result !== null && typeof result === 'object' && !Array.isArray(result);
        return jsonRpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          ...(isRecordResult ? { structuredContent: result as Record<string, unknown> } : {}),
        });
      } catch (err) {
        if (err instanceof ToolError) {
          if (err.code === 'guardrail' && env?.AGENT_LINK) {
            // Surface the reject to the user via the DO's status bus — the
            // macro never saw this op (the guard runs before forwarding), which
            // was the worst dead-air case (spec 2026-07-13 §1/§4.2).
            // Best-effort: a failed report must not mask the RPC error reply.
            try {
              const stub = env.AGENT_LINK.get(env.AGENT_LINK.idFromName(token));
              await stub.fetch('https://agent-link-do/activity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  type: 'guardrail_rejected',
                  detail: (err.data as { reason?: string } | undefined)?.reason ?? 'guardrail',
                }),
              });
            } catch {
              // swallow — see above
            }
          }
          let code = RPC_UNKNOWN_TOOL;
          if (err.code === 'bad_args') code = RPC_INVALID_PARAMS;
          else if (err.code === 'guardrail') code = RPC_GUARDRAIL_REJECTED;
          // Guardrail rejections carry rich structured `data` (reason, parse
          // errors with line/col, current/new lengths) so the agent can fix and
          // retry; other ToolErrors just echo their code.
          const data = err.data ?? { code: err.code };
          return jsonRpcError(200, id, code, err.message, data);
        }
        if (err instanceof MacroForwardError) {
          const status =
            err.code === 'macro_not_connected' || err.code === 'macro_disconnected'
              ? 409
              : err.code === 'macro_timeout'
                ? 504
                : 502;
          // 'macro_disconnected' carries its own {reason, resume_deadline}
          // data shape (design §7 decision #4); every other code falls back
          // to the existing {code} shape.
          return jsonRpcError(status, id, RPC_MACRO_ERROR, err.message, err.data ?? { code: err.code });
        }
        throw err;
      }
    }

    default:
      return jsonRpcError(400, id, RPC_METHOD_NOT_FOUND, `Unknown method: ${body.method}`);
  }
};
