// The headless half of POST /agent-link/mcp: same endpoint, same JSON-RPC
// envelope, different credential and a different tool surface.
//
// MODE SELECTION (design §11 Phase 5). The relay's session tokens are minted
// in one shape — `CL-XXXX-XXXX` (sessionToken.ts `mintToken`) — and ours are
// 43-character random handles, so the two can be told apart without a lookup
// and without either path having to fail first. A token that is neither is
// treated as headless, because that is the mode whose 401 carries the
// discovery challenge: an unknown credential should teach the client how to
// get a real one, not just refuse it.

import {
  authenticateHeadless,
  challengeFor,
  hasScope,
  type HeadlessAuthFailure,
} from './headlessAuth';
import {
  callHeadlessTool,
  HEADLESS_TOOLS,
  HeadlessToolError,
  type HeadlessContext,
} from './headlessTools';
import { loadAppConfig, loadGrantStore, OAuthConfigError, type OAuthEnv } from './appConfig';
import type { GateEnv } from './headlessGate';
import type { GrantEvent } from './tokenStore';
import { mixpanelTrack } from '../../service/mixpanelService';

/**
 * The tools that change something in Confluence, and so need diagram.write.
 *
 * A set rather than a condition: the first version was an || of two names and
 * silently left new write tools on the read scope when the page tools landed.
 */
const WRITE_TOOLS = new Set(['create_diagram', 'update_diagram', 'create_page', 'update_page']);

/** The relay's own token shape. Anything else is ours to answer. */
const RELAY_TOKEN_RE = /^CL-[A-Z0-9]{4}-[A-Z0-9]{4}$/i;

export function looksLikeRelayToken(token: string | null | undefined): boolean {
  return !!token && RELAY_TOKEN_RE.test(token.trim());
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json' };

const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_AUTH_ERROR = -32001;
const RPC_TOOL_ERROR = -32003;

type JsonRpcId = string | number | null;

function result(id: JsonRpcId, value: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: value }), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

function error(status: number, id: JsonRpcId, code: number, message: string, extra?: { headers?: Record<string, string>; data?: unknown }): Response {
  const body: Record<string, unknown> = { code, message };
  if (extra?.data !== undefined) body.data = extra.data;
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: body }), {
    status,
    headers: { ...JSON_HEADERS, ...(extra?.headers ?? {}) },
  });
}

function authMessage(reason: HeadlessAuthFailure): string {
  switch (reason) {
    case 'missing':
      return 'Authorization required. Authorize this agent with ZenUML, then retry.';
    case 'wrong_audience':
      return 'This token was issued for a different ZenUML server.';
    default:
      return 'The access token is unknown or has expired. Authorize again.';
  }
}

export interface HeadlessEnv extends OAuthEnv, GateEnv {
  MIXPANEL_TOKEN?: string;
}

/**
 * Emit the write events (design §10).
 *
 * The one that matters is `paywall_gate` on a create: the §9.1 gate fails OPEN
 * when a space's macro count cannot be read, so the share of creates reporting
 * 'count_unknown' is the only measure of how often the Lite limit is skipped
 * rather than applied. Nothing else answers that — the frontend's gate never
 * runs on this path, so its own paywall_gate_evaluated is silent here.
 *
 * Analytics never fails a write and never delays one: the tool has already
 * succeeded by the time this runs, so a slow or unreachable Mixpanel must not
 * hold the response — or, worse, time the request out and make an agent retry
 * a diagram it already created. The call is therefore bounded and its result
 * is not awaited by the caller.
 */
const ANALYTICS_TIMEOUT_MS = 2_000;

/** Which event each write tool reports under. Absent = not a write, so nothing is emitted. */
const WRITE_EVENT_BY_TOOL: Record<string, string | undefined> = {
  create_diagram: 'agent_link_diagram_created',
  update_diagram: 'agent_link_diagram_updated',
  create_page: 'agent_link_page_created',
  update_page: 'agent_link_page_updated',
};

/** Bound a fire-and-forget analytics call so it cannot outlive the request it describes. */
function withTimeout(work: Promise<unknown>): Promise<void> {
  return Promise.race([
    work.then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, ANALYTICS_TIMEOUT_MS)),
  ]).catch(() => undefined);
}

async function trackWrite(env: HeadlessEnv, tool: string, userId: string, value: unknown): Promise<void> {
  if (!env.MIXPANEL_TOKEN) return;
  const out = (value ?? {}) as { result?: unknown; gate?: unknown };
  const event = WRITE_EVENT_BY_TOOL[tool];
  if (!event) return;
  try {
    await withTimeout(mixpanelTrack(
      {
        event,
        user_account_id: userId,
        feature_area: 'agent_link',
        surface: 'backend',
        result: typeof out.result === 'string' ? out.result : undefined,
        paywall_gate: typeof out.gate === 'string' ? out.gate : undefined,
      },
      env.MIXPANEL_TOKEN,
    ));
  } catch {
    // analytics must never fail a write that already happened
  }
}

/**
 * The upstream grant's end of life. Without these a user's Atlassian
 * authorization can die (90 days idle, revoked at Atlassian, a rejected
 * rotation) and the only trace is their agent failing.
 */
async function trackGrantEvent(env: HeadlessEnv, userId: string, event: GrantEvent): Promise<void> {
  if (!env.MIXPANEL_TOKEN) return;
  await withTimeout(mixpanelTrack(
    {
      event: event.type === 'revoked' ? 'agent_link_oauth_revoked' : 'agent_link_oauth_refresh_failed',
      user_account_id: userId,
      feature_area: 'agent_link',
      surface: 'backend',
      // Closed vocabularies only: the GrantFailure code, or the revoke reason.
      reason: event.type === 'revoked' ? event.reason : event.failure,
    },
    env.MIXPANEL_TOKEN,
  ));
}

/**
 * A refusal is as informative as a success here: 'limit_reached' is the gate
 * actually biting, and `guardrail_rejected` is the write guard refusing a
 * truncation. Both are invisible if only successes are counted.
 */
async function trackWriteRefusal(
  env: HeadlessEnv,
  tool: string,
  userId: string,
  failure: HeadlessToolError,
): Promise<void> {
  if (!env.MIXPANEL_TOKEN) return;
  const event = WRITE_EVENT_BY_TOOL[tool];
  if (!event) return;
  try {
    await withTimeout(mixpanelTrack(
      {
        event,
        user_account_id: userId,
        feature_area: 'agent_link',
        surface: 'backend',
        // The closed-vocabulary refusal code only — never the message, which
        // can quote a Confluence error.
        reason: failure.code,
        guardrail_rejected: failure.code === 'guardrail_rejected' || undefined,
        paywall_gate: failure.code === 'limit_reached' ? 'limit_reached' : undefined,
      },
      env.MIXPANEL_TOKEN,
    ));
  } catch {
    // never fail the response on analytics
  }
}

/** How one tools/call ended — AgentLinkMcpToolOutcome in the frontend catalog. */
type ToolOutcome = 'success' | 'tool_error' | 'scope_denied' | 'unknown_tool' | 'exception';

/** Client-supplied text, bounded before it reaches Mixpanel. */
function clip(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 64) : undefined;
}

/**
 * One event per authenticated tools/call, for every tool. The write events
 * above only see the four writes; reads, scope refusals and unexpected throws
 * are otherwise invisible on the headless path. Arguments and results are
 * never sent — only the tool's name, how it ended, and how long it took.
 */
async function trackToolCall(
  env: HeadlessEnv,
  userId: string,
  call: { tool: string; outcome: ToolOutcome; reason?: string; durationMs: number },
): Promise<void> {
  if (!env.MIXPANEL_TOKEN) return;
  await withTimeout(mixpanelTrack(
    {
      event: 'agent_link_mcp_tool_called',
      user_account_id: userId,
      feature_area: 'agent_link',
      surface: 'backend',
      mcp_mode: 'headless',
      mcp_tool: call.tool,
      mcp_tool_outcome: call.outcome,
      reason: call.reason,
      duration_ms: call.durationMs,
    },
    env.MIXPANEL_TOKEN,
  ));
}

/** Which agent connected: the MCP `clientInfo` from the initialize handshake. */
async function trackInitialized(env: HeadlessEnv, userId: string, params: unknown): Promise<void> {
  if (!env.MIXPANEL_TOKEN) return;
  const clientInfo = ((params ?? {}) as { clientInfo?: { name?: unknown; version?: unknown } }).clientInfo ?? {};
  await withTimeout(mixpanelTrack(
    {
      event: 'agent_link_mcp_initialized',
      user_account_id: userId,
      feature_area: 'agent_link',
      surface: 'backend',
      mcp_mode: 'headless',
      mcp_client_name: clip(clientInfo.name),
      mcp_client_version: clip(clientInfo.version),
    },
    env.MIXPANEL_TOKEN,
  ));
}

export interface HeadlessMcpDeps {
  /** Injected so tests need no network; production passes a wrapped global fetch. */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  nowMs?: () => number;
  /**
   * The Pages context's waitUntil. When given, usage events run after the
   * response is sent instead of delaying it; without it (tests) they are
   * awaited, still bounded by ANALYTICS_TIMEOUT_MS.
   */
  waitUntil?: (work: Promise<unknown>) => void;
}

/**
 * Handle one JSON-RPC request in headless mode.
 *
 * `body` is already parsed by the endpoint, which has to read `method` to pick
 * a mode; re-reading the stream here would fail.
 */
export async function handleHeadlessRpc(
  request: Request,
  env: HeadlessEnv,
  body: { id?: JsonRpcId; method?: string; params?: unknown },
  deps: HeadlessMcpDeps = {},
): Promise<Response> {
  const id = body.id ?? null;
  const fetchImpl = deps.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const now = deps.nowMs ?? Date.now;
  const defer = async (work: Promise<void>): Promise<void> => {
    const bounded = work.catch(() => undefined); // analytics never fails a response
    if (deps.waitUntil) deps.waitUntil(bounded);
    else await bounded;
  };

  let store;
  let app;
  try {
    ({ store } = loadGrantStore(env));
    app = loadAppConfig(env, request.url);
  } catch (e) {
    if (e instanceof OAuthConfigError) {
      // A half-configured environment must say so plainly rather than answer
      // 401, which would send a client round the authorization loop forever.
      return error(503, id, RPC_AUTH_ERROR, 'Headless mode is not configured on this server.', {
        data: { missing: e.missing },
      });
    }
    throw e;
  }

  const auth = await authenticateHeadless(request, store, now());
  if (!auth.ok) {
    return error(401, id, RPC_AUTH_ERROR, authMessage(auth.reason), {
      headers: { 'WWW-Authenticate': challengeFor(request.url, auth.reason) },
      data: { code: auth.reason },
    });
  }

  // Notifications expect no response body (Streamable HTTP); a spec-compliant
  // client sends notifications/initialized right after initialize, and
  // answering it with an error aborts the handshake.
  if (body.method?.startsWith('notifications/')) {
    return new Response(null, { status: 202, headers: CORS });
  }

  const ctx: HeadlessContext = {
    store,
    secret: loadGrantStore(env).secret,
    app,
    fetchImpl,
    userId: auth.token.userId,
    nowMs: now,
    // The gate reads its own KV bindings off the same env; passing the env
    // through rather than the two namespaces keeps create_diagram's check in
    // one place (headlessGate.ts) instead of spread across the endpoint.
    gateEnv: env,
    onGrantEvent: (event) => trackGrantEvent(env, auth.token.userId, event),
  };

  switch (body.method) {
    case 'initialize':
      await defer(trackInitialized(env, auth.token.userId, body.params));
      return result(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'conf-agent-link-headless', version: '0.1.0' },
        instructions:
          'These tools read and edit ZenUML diagrams in Confluence as you, with no browser tab open. Call list_sites first for the cloudId every other tool needs. Edits publish one version each, so page history can revert them.',
      });

    case 'tools/list':
      return result(id, { tools: HEADLESS_TOOLS });

    case 'tools/call': {
      const params = (body.params ?? {}) as { name?: unknown; arguments?: unknown };
      if (typeof params.name !== 'string') {
        return error(400, id, RPC_INVALID_PARAMS, 'params.name is required');
      }
      const tool = params.name;
      const startedMs = now();
      const trackCall = (outcome: ToolOutcome, reason?: string) =>
        defer(trackToolCall(env, auth.token.userId, {
          tool,
          outcome,
          reason,
          durationMs: Math.max(0, now() - startedMs),
        }));
      if (!HEADLESS_TOOLS.some((t) => t.name === tool)) {
        // Never the client's string: an unknown name is free text.
        await defer(trackToolCall(env, auth.token.userId, { tool: 'unknown', outcome: 'unknown_tool', durationMs: 0 }));
        return error(200, id, RPC_METHOD_NOT_FOUND, `Unknown tool: ${tool}`);
      }
      // Reads need diagram.read; the two write tools need diagram.write. A
      // client that asked for only one scope gets only that half of the
      // surface, which is the point of having two.
      const needsWrite = WRITE_TOOLS.has(params.name);
      const required = needsWrite ? 'diagram.write' : 'diagram.read';
      if (!hasScope(auth.token, required)) {
        await trackCall('scope_denied', required);
        return error(403, id, RPC_AUTH_ERROR, `This token was not granted ${required} access.`);
      }

      try {
        const value = await callHeadlessTool(
          params.name,
          (params.arguments ?? {}) as Record<string, unknown>,
          ctx,
        );
        await trackWrite(env, params.name, auth.token.userId, value);
        await trackCall('success');
        // MCP's content envelope: clients render `content`, and a structured
        // copy keeps the data usable without re-parsing the text.
        return result(id, {
          content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
          structuredContent: value,
        });
      } catch (e) {
        if (e instanceof HeadlessToolError) {
          await trackWriteRefusal(env, params.name, auth.token.userId, e);
          await trackCall('tool_error', e.code);
          // A dead grant is the one failure the user can act on, so it is a
          // 401 with the challenge rather than a tool-level error buried in a
          // 200 that a client will just print.
          if (e.code === 'no_grant') {
            return error(401, id, RPC_AUTH_ERROR, e.message, {
              headers: { 'WWW-Authenticate': challengeFor(request.url, 'invalid') },
              data: { code: e.code, detail: e.detail },
            });
          }
          return error(200, id, RPC_TOOL_ERROR, e.message, { data: { code: e.code, detail: e.detail } });
        }
        await trackCall('exception');
        throw e;
      }
    }

    default:
      return error(400, id, RPC_INVALID_REQUEST, `Unknown method: ${body.method ?? '(none)'}`);
  }
}
