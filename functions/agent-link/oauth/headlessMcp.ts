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
import { mixpanelTrack } from '../../service/mixpanelService';

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
 * Analytics never fails a write: the tool already succeeded by the time this
 * runs, and a Mixpanel outage must not turn a published diagram into an error.
 */
async function trackWrite(env: HeadlessEnv, tool: string, userId: string, value: unknown): Promise<void> {
  if (!env.MIXPANEL_TOKEN) return;
  const out = (value ?? {}) as { result?: unknown; gate?: unknown };
  const event =
    tool === 'create_diagram'
      ? 'agent_link_diagram_created'
      : tool === 'update_diagram'
        ? 'agent_link_diagram_updated'
        : null;
  if (!event) return;
  try {
    await mixpanelTrack(
      {
        event,
        user_account_id: userId,
        feature_area: 'agent_link',
        surface: 'backend',
        result: typeof out.result === 'string' ? out.result : undefined,
        paywall_gate: typeof out.gate === 'string' ? out.gate : undefined,
      },
      env.MIXPANEL_TOKEN,
    );
  } catch {
    // analytics must never fail a write that already happened
  }
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
  if (tool !== 'create_diagram' && tool !== 'update_diagram') return;
  try {
    await mixpanelTrack(
      {
        event: tool === 'create_diagram' ? 'agent_link_diagram_created' : 'agent_link_diagram_updated',
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
    );
  } catch {
    // never fail the response on analytics
  }
}

export interface HeadlessMcpDeps {
  /** Injected so tests need no network; production passes a wrapped global fetch. */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  nowMs?: () => number;
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
  };

  switch (body.method) {
    case 'initialize':
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
      if (!HEADLESS_TOOLS.some((t) => t.name === params.name)) {
        return error(200, id, RPC_METHOD_NOT_FOUND, `Unknown tool: ${params.name}`);
      }
      // Reads need diagram.read; the two write tools need diagram.write. A
      // client that asked for only one scope gets only that half of the
      // surface, which is the point of having two.
      const needsWrite = params.name === 'update_diagram' || params.name === 'create_diagram';
      const required = needsWrite ? 'diagram.write' : 'diagram.read';
      if (!hasScope(auth.token, required)) {
        return error(403, id, RPC_AUTH_ERROR, `This token was not granted ${required} access.`);
      }

      try {
        const value = await callHeadlessTool(
          params.name,
          (params.arguments ?? {}) as Record<string, unknown>,
          ctx,
        );
        await trackWrite(env, params.name, auth.token.userId, value);
        // MCP's content envelope: clients render `content`, and a structured
        // copy keeps the data usable without re-parsing the text.
        return result(id, {
          content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
          structuredContent: value,
        });
      } catch (e) {
        if (e instanceof HeadlessToolError) {
          await trackWriteRefusal(env, params.name, auth.token.userId, e);
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
        throw e;
      }
    }

    default:
      return error(400, id, RPC_INVALID_REQUEST, `Unknown method: ${body.method ?? '(none)'}`);
  }
}
