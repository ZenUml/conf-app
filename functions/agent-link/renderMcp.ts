// The public half of the MCP surface: POST /mcp (functions/mcp/index.ts), also
// served at its original path /mcp/render (functions/mcp/render.ts).
//
// /agent-link/mcp reads and writes diagrams in Confluence, so every call there
// needs a token tied to an Atlassian account (headless OAuth, or the relay's
// session token). This endpoint does not touch Confluence at all. It takes a
// diagram's source from the agent and hands it back for the MCP Apps view
// (mcpApps.ts) to draw, so anyone can add it as a connector without an
// Atlassian site, an account, or a sign-in.
//
// WHY A SEPARATE ENDPOINT AND NOT AN ANONYMOUS TOOL ON /agent-link/mcp. A
// token-less request to /agent-link/mcp has to be answered 401 with the
// RFC 9728 challenge: that is what starts the OAuth flow in a host that has
// never connected. Answering `initialize` without a token there would make
// every host skip sign-in and then fail on the first Confluence tool.
//
// No diagram is stored. The only write is a per-address call counter in D1
// (renderRateLimit.ts), and the only outbound call is fetching our own built
// view. The diagram is drawn in the host's frame, by the
// same view the headless tools use, PlantUML included: no diagram source
// reaches a third party, and a diagram the engine cannot draw shows an error
// rather than falling back to plantuml.com as the Confluence macro does.
//
// What the server adds over a plain echo is the parse check (parseDsl.ts): the
// agent gets ZenUML and Mermaid errors with line and column, and a structural
// check for PlantUML and OpenAPI, instead of a picture that silently failed.
// For ZenUML it also names known mistakes (zenumlDslGuide.ts): `warnings` on a
// source that parsed but draws the wrong diagram, and `hints` that put a
// specific fix before the parser's errors on one that did not.

import {
  INSTRUCTIONS,
  RENDER_TOOL,
  chainSummaryFor,
  issueCodes,
  RenderParamsError,
  renderDiagram,
  withChain,
  type RenderResult,
} from './renderTool';
import { getGuideByUri, listGuideResources } from './dslGuides';
import {
  DIAGRAM_VIEW_URI,
  readUiResource,
  uiCapability,
  uiMeta,
  uiResourceList,
} from './oauth/mcpApps';
import { clientDeclaresUi, negotiateProtocolVersion, withTimeout } from './mcpProtocol';
import { checkRenderRate, RENDER_LIMIT, RENDER_WINDOW_SECONDS, type RateEnv } from './renderRateLimit';
import { mixpanelTrack } from '../service/mixpanelService';
// The same version /mcp/health reports: workers/render-mcp/build.mjs writes this
// package.json version into build-info.json. A named JSON import keeps only the
// one field in the bundle.
import { version as RENDER_SERVER_VERSION } from '../../package.json';
import { json } from '../OkResponse';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Protocol-Version',
};
export const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json' };

export {
  MAX_SOURCE_CHARS,
  RENDER_TOOL,
  RENDER_TYPES,
  renderDiagram,
  type RenderResult,
  type RenderType,
} from './renderTool';

const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_TOOL_ERROR = -32003;

type JsonRpcId = string | number | null;

export interface RenderEnv extends RateEnv {
  MIXPANEL_TOKEN?: string;
}

export interface RenderMcpDeps {
  /** Injected so tests need no network; used only to fetch our own view. */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  nowMs?: () => number;
  /** The Pages context's waitUntil; without it (tests) analytics is awaited. */
  waitUntil?: (work: Promise<unknown>) => void;
}

function rpcResult(id: JsonRpcId, value: unknown): Response {
  return json({ jsonrpc: '2.0', id, result: value }, { status: 200, headers: JSON_HEADERS });
}

export function rpcError(status: number, id: JsonRpcId, code: number, message: string, data?: unknown): Response {
  const body: Record<string, unknown> = { code, message };
  if (data !== undefined) body.data = data;
  return json({ jsonrpc: '2.0', id, error: body }, { status, headers: JSON_HEADERS });
}

/** render_issues / render_warnings_returned, for ZenUML sources only. */
function zenumlIssueProps(r: RenderResult): Record<string, unknown> {
  if (r.diagramType !== 'sequence') return {};
  const codes = issueCodes(r);
  return {
    render_warnings_returned: Boolean(r.warnings?.length),
    render_fix_suggested: Boolean(r.suggestedSource),
    ...(codes.length ? { render_issues: codes } : {}),
  };
}

type ToolOutcome = 'success' | 'tool_error' | 'unknown_tool' | 'exception' | 'rate_limited';

async function track(env: RenderEnv, props: Record<string, unknown>): Promise<void> {
  if (!env.MIXPANEL_TOKEN) return;
  try {
    // No user_account_id: there is no user on this path. mixpanelService then
    // files the event under unknown_user_account_id without an identify call.
    await withTimeout(
      mixpanelTrack(
        { feature_area: 'agent_link', surface: 'backend', mcp_mode: 'render', ...props } as never,
        env.MIXPANEL_TOKEN,
        env,
      ),
    );
  } catch {
    // analytics never fails a response
  }
}

/** Sent by scripts/ci/check-render-mcp.mjs. Spoofing it only hides the sender's own calls. */
const INTERNAL_PROBE_HEADER = 'x-zenuml-internal-probe';

function clip(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 64) : undefined;
}

/** Handle one JSON-RPC request. No credential is read or required. */
export async function handleRenderRpc(
  request: Request,
  env: RenderEnv,
  body: { id?: JsonRpcId; method?: string; params?: unknown },
  deps: RenderMcpDeps = {},
): Promise<Response> {
  // Our own smoke checks say so: this path has no user or site that could.
  const internalProbe = request.headers.get(INTERNAL_PROBE_HEADER) ? { internal_probe: true } : {};
  const trackEvent = (props: Record<string, unknown>) => track(env, { ...internalProbe, ...props });
  const id = body.id ?? null;
  const origin = new URL(request.url).origin;
  const fetchImpl = deps.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const now = deps.nowMs ?? Date.now;
  const defer = async (work: Promise<void>): Promise<void> => {
    const bounded = work.catch(() => undefined);
    if (deps.waitUntil) deps.waitUntil(bounded);
    else await bounded;
  };

  if (body.method?.startsWith('notifications/')) {
    return new Response(null, { status: 202, headers: CORS });
  }

  switch (body.method) {
    case 'initialize': {
      const negotiated = negotiateProtocolVersion(
        (body.params as { protocolVersion?: unknown } | undefined)?.protocolVersion,
      );
      const info = (body.params as { clientInfo?: { name?: unknown; version?: unknown } } | undefined)?.clientInfo;
      await defer(
        trackEvent({
          event: 'agent_link_mcp_initialized',
          client_declares_ui: clientDeclaresUi(body.params),
          protocol_version: negotiated,
          mcp_client_name: clip(info?.name) ?? 'unknown',
          mcp_client_version: clip(info?.version),
        }),
      );
      return rpcResult(id, {
        protocolVersion: negotiated,
        capabilities: { tools: {}, resources: {}, extensions: uiCapability() },
        serverInfo: { name: 'zenuml-render', version: RENDER_SERVER_VERSION },
        instructions: INSTRUCTIONS,
      });
    }

    case 'ping':
      return rpcResult(id, {});

    case 'tools/list':
      return rpcResult(id, { tools: [{ ...RENDER_TOOL, _meta: uiMeta(origin) }] });

    case 'resources/list':
      return rpcResult(id, { resources: [...uiResourceList(origin), ...listGuideResources('render')] });

    case 'resources/read': {
      const uri = (body.params as { uri?: unknown } | undefined)?.uri;
      if (uri === DIAGRAM_VIEW_URI) {
        const read = await readUiResource(uri, origin, (u) => fetchImpl(u));
        await defer(
          trackEvent({
            event: read.ok ? 'agent_link_app_view_requested' : 'agent_link_app_view_failed',
            ...(read.ok ? {} : { reason: read.reason, ...(read.detail ? { detail: read.detail.slice(0, 120) } : {}) }),
          }),
        );
        // A JSON-RPC error inside a 200, as headlessMcp.ts explains: Cloudflare
        // replaces a 502 body from a Pages Function with its own page.
        if (!read.ok) return rpcError(200, id, RPC_TOOL_ERROR, read.reason, { reason: read.reason, detail: read.detail });
        return rpcResult(id, { contents: read.contents });
      }
      const guide = typeof uri === 'string' ? getGuideByUri(uri, 'render') : undefined;
      if (!guide) return rpcError(400, id, RPC_INVALID_PARAMS, `Unknown resource: ${typeof uri === 'string' ? uri.slice(0, 120) : '(none)'}`);
      return rpcResult(id, { contents: [{ uri: guide.uri, mimeType: 'text/markdown', text: guide.text }] });
    }

    case 'tools/call': {
      const params = (body.params ?? {}) as { name?: unknown; arguments?: unknown };
      if (typeof params.name !== 'string') return rpcError(400, id, RPC_INVALID_PARAMS, 'params.name is required');
      const startedMs = now();
      const trackCall = (outcome: ToolOutcome, extra: Record<string, unknown> = {}) =>
        defer(
          trackEvent({
            event: 'agent_link_mcp_tool_called',
            mcp_tool: outcome === 'unknown_tool' ? 'unknown' : params.name,
            mcp_tool_outcome: outcome,
            duration_ms: Math.max(0, now() - startedMs),
            ...extra,
          }),
        );
      if (params.name !== RENDER_TOOL.name) {
        await trackCall('unknown_tool');
        return rpcError(200, id, RPC_METHOD_NOT_FOUND, `Unknown tool: ${params.name.slice(0, 64)}`);
      }
      // Counted before parsing, because parsing is the cost the limit exists
      // to bound. Only tools/call is counted: a handshake costs nothing to
      // speak of, and a host makes several per conversation.
      const rate = await checkRenderRate(env, request.headers.get('CF-Connecting-IP'), now());
      if (!rate.allowed) {
        await trackCall('rate_limited');
        // A tool result the model can read and relay, not an HTTP 429, which
        // MCP clients surface as a broken connection rather than a message.
        return rpcResult(id, {
          content: [{
            type: 'text',
            text: `Rate limit reached: at most ${RENDER_LIMIT} renders per ${RENDER_WINDOW_SECONDS} seconds from one address. Try again in ${rate.retryAfterSeconds} seconds.`,
          }],
          isError: true,
          _meta: { retryAfterSeconds: rate.retryAfterSeconds },
        });
      }
      const rateUnavailable = 'unavailable' in rate ? { reason: 'rate_limit_unavailable' } : {};
      try {
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        const { result: value, chain } = await withChain(await renderDiagram(args), args.revision);
        await trackCall('success', {
          macro_type: value.diagramType,
          render_validation: value.unvalidated ? 'unvalidated' : value.valid ? 'valid' : 'invalid',
          render_type_source: value.detected ? 'detected' : 'given',
          ...zenumlIssueProps(value),
          render_attempt: value.attempt,
          render_revision_state: chain.revisionState,
          ...(chain.fixApplied !== undefined ? { render_fix_applied: chain.fixApplied } : {}),
          render_next_actions: (value.nextActions ?? []).map((a) => a.action),
          ...rateUnavailable,
        });
        // The view reads structuredContent (extractDiagram in
        // src/mcp-app-view.ts matches `diagramType` + `source`); the model
        // reads the text, which is a summary rather than its own source back.
        return rpcResult(id, {
          content: [{ type: 'text', text: chainSummaryFor(value, chain) }],
          structuredContent: value,
        });
      } catch (e) {
        if (e instanceof RenderParamsError) {
          await trackCall('tool_error', { reason: e.code });
          // A tool-level error the model sees and can correct, per the MCP
          // spec, rather than a protocol error a client may just print.
          return rpcResult(id, { content: [{ type: 'text', text: e.message }], isError: true });
        }
        await trackCall('exception');
        throw e;
      }
    }

    default:
      return rpcError(400, id, RPC_INVALID_REQUEST, `Unknown method: ${body.method ?? '(none)'}`);
  }
}

/** Parse the body and dispatch; split from the route so tests can call it directly. */
export async function handleRenderRequest(
  request: Request,
  env: RenderEnv,
  deps: RenderMcpDeps = {},
): Promise<Response> {
  let body: { id?: JsonRpcId; method?: string; params?: unknown };
  try {
    body = await request.json();
  } catch {
    return rpcError(400, null, RPC_PARSE_ERROR, 'Parse error: invalid JSON body');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.method !== 'string') {
    return rpcError(400, (body as { id?: JsonRpcId } | null)?.id ?? null, RPC_INVALID_REQUEST, 'Invalid Request: missing "method"');
  }
  return handleRenderRpc(request, env, body, deps);
}
