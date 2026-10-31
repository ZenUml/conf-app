// The public half of the MCP surface: POST /mcp/render (route: functions/mcp/render.ts).
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
// same view the headless tools use; PlantUML goes from that frame to
// www.plantuml.com, as it does in Confluence.
//
// What the server adds over a plain echo is the parse check (parseDsl.ts): the
// agent gets ZenUML and Mermaid errors with line and column, and a structural
// check for PlantUML and OpenAPI, instead of a picture that silently failed.

import { parseDsl, type DslError } from './parseDsl';
import { detectDiagramType } from './detectDiagramType';
import { getGuideByUri, listGuideResources } from './dslGuides';
import {
  DIAGRAM_VIEW_URI,
  readUiResource,
  uiCapability,
  uiMeta,
  uiResourceList,
} from './oauth/mcpApps';
import { clientDeclaresUi, negotiateProtocolVersion, withTimeout } from './oauth/headlessMcp';
import { checkRenderRate, RENDER_LIMIT, RENDER_WINDOW_SECONDS, type RateEnv } from './renderRateLimit';
import { mixpanelTrack } from '../service/mixpanelService';
import { json } from '../OkResponse';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Protocol-Version',
};
export const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json' };

const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_TOOL_ERROR = -32003;

type JsonRpcId = string | number | null;

/**
 * The types the view can draw (mcpApps.ts RENDERABLE_TYPES), under the names
 * the agent sends. Lower case, because that is what the view compares against.
 */
export const RENDER_TYPES = ['sequence', 'mermaid', 'plantuml', 'graph', 'openapi'] as const;
export type RenderType = (typeof RENDER_TYPES)[number];

/**
 * Larger than any diagram we have seen stored, small enough that a public
 * endpoint cannot be made to parse a novel. DrawIO XML is the largest kind.
 */
export const MAX_SOURCE_CHARS = 500_000;
const MAX_TITLE_CHARS = 200;

export const RENDER_TOOL = {
  name: 'render_diagram',
  title: 'Render diagram',
  description:
    'Draw a diagram from its source and show it to the user. Nothing is saved anywhere. The source may be ' +
    'a ZenUML sequence diagram, Mermaid, PlantUML (@startuml … @enduml), draw.io / diagrams.net XML, or an OpenAPI or ' +
    'Swagger spec (YAML or JSON). diagramType is optional: leave it out and the language is detected from the source ' +
    '(a source with no recognised header is read as ZenUML), or pass it to be explicit. The result says which type was ' +
    'used and whether the source parsed; when it did not, ' +
    'it lists the errors with line and column, so fix them and call again.',
  annotations: {
    title: 'Render diagram',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      diagramType: {
        type: 'string',
        enum: [...RENDER_TYPES],
        description: 'Optional. The language `source` is written in; detected from the source when omitted.',
      },
      source: { type: 'string', description: 'The complete diagram source.' },
      title: { type: 'string', description: 'Optional. Shown with the diagram.' },
    },
    required: ['source'],
  },
} as const;

const INSTRUCTIONS =
  'Use render_diagram to draw a diagram for the user from its source: a ZenUML sequence diagram, Mermaid, PlantUML, ' +
  'draw.io XML, or an OpenAPI spec. No Atlassian site or sign-in is involved and nothing is saved. Prefer `sequence` ' +
  '(ZenUML) for sequence diagrams. If the result reports parse errors, fix the source and call render_diagram again. ' +
  'The zenuml://, mermaid://, plantuml:// and openapi:// dsl-guide resources give the rules of each language.';

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

export interface RenderResult {
  diagramType: RenderType;
  source: string;
  title?: string;
  /** True when diagramType was left out and inferred from the source. */
  detected?: true;
  /** False when the parser reported errors; true when it accepted the source or has no parser for this type. */
  valid: boolean;
  /** True for a type with no parser here (graph). */
  unvalidated?: true;
  errors?: DslError[];
}

class RenderParamsError extends Error {
  constructor(message: string, readonly code: 'bad_params' | 'too_large') {
    super(message);
  }
}

function rpcResult(id: JsonRpcId, value: unknown): Response {
  return json({ jsonrpc: '2.0', id, result: value }, { status: 200, headers: JSON_HEADERS });
}

export function rpcError(status: number, id: JsonRpcId, code: number, message: string, data?: unknown): Response {
  const body: Record<string, unknown> = { code, message };
  if (data !== undefined) body.data = data;
  return json({ jsonrpc: '2.0', id, error: body }, { status, headers: JSON_HEADERS });
}

function readParams(args: Record<string, unknown>): { diagramType: RenderType; detected: boolean; source: string; title?: string } {
  const rawType = typeof args.diagramType === 'string' ? args.diagramType.trim().toLowerCase() : '';
  // A type that is given but not one of ours is refused, not replaced by a
  // guess: the agent meant something, and it should learn the list.
  const givenType = rawType ? RENDER_TYPES.find((t) => t === rawType) : undefined;
  if (rawType && !givenType) {
    throw new RenderParamsError(
      `diagramType must be one of: ${RENDER_TYPES.join(', ')}, or left out to detect it from the source.`,
      'bad_params',
    );
  }
  if (typeof args.source !== 'string' || args.source.trim() === '') {
    throw new RenderParamsError('source is required and must be a non-empty string.', 'bad_params');
  }
  if (args.source.length > MAX_SOURCE_CHARS) {
    throw new RenderParamsError(`source is longer than ${MAX_SOURCE_CHARS} characters.`, 'too_large');
  }
  const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim().slice(0, MAX_TITLE_CHARS) : undefined;
  return { diagramType: givenType ?? detectDiagramType(args.source), detected: !givenType, source: args.source, title };
}

/** Parse-check the source and shape what the view and the agent both read. */
export async function renderDiagram(args: Record<string, unknown>): Promise<RenderResult> {
  const { diagramType, detected, source, title } = readParams(args);
  const parsed = await parseDsl(diagramType, source);
  const base = { diagramType, source, ...(title ? { title } : {}), ...(detected ? { detected: true as const } : {}) };
  if (!parsed.ok) return { ...base, valid: false, errors: parsed.errors };
  return { ...base, valid: true, ...(parsed.unvalidated ? { unvalidated: true as const } : {}) };
}

/** What the agent reads first. The source itself rides structuredContent, for the view. */
function summaryFor(r: RenderResult): string {
  const detected = r.detected ? ` (detected from the source; pass diagramType if that is wrong)` : '';
  if (!r.valid) {
    const lines = (r.errors ?? []).map((e) => `- line ${e.line}, column ${e.col}: ${e.message}`);
    return `The ${r.diagramType} source${detected} did not parse, so the diagram may not draw. Fix these and call render_diagram again:\n${lines.join('\n')}`;
  }
  if (r.unvalidated) return `Sent the ${r.diagramType} diagram${detected} to the view. This type is not syntax-checked here.`;
  return `Rendered the ${r.diagramType} diagram${detected}. The source parsed.`;
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
        track(env, {
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
        serverInfo: { name: 'zenuml-render', version: '0.1.0' },
        instructions: INSTRUCTIONS,
      });
    }

    case 'ping':
      return rpcResult(id, {});

    case 'tools/list':
      return rpcResult(id, { tools: [{ ...RENDER_TOOL, _meta: uiMeta(origin) }] });

    case 'resources/list':
      return rpcResult(id, { resources: [...uiResourceList(origin), ...listGuideResources()] });

    case 'resources/read': {
      const uri = (body.params as { uri?: unknown } | undefined)?.uri;
      if (uri === DIAGRAM_VIEW_URI) {
        const read = await readUiResource(uri, origin, (u) => fetchImpl(u));
        await defer(
          track(env, {
            event: read.ok ? 'agent_link_app_view_requested' : 'agent_link_app_view_failed',
            ...(read.ok ? {} : { reason: read.reason, ...(read.detail ? { detail: read.detail.slice(0, 120) } : {}) }),
          }),
        );
        // A JSON-RPC error inside a 200, as headlessMcp.ts explains: Cloudflare
        // replaces a 502 body from a Pages Function with its own page.
        if (!read.ok) return rpcError(200, id, RPC_TOOL_ERROR, read.reason, { reason: read.reason, detail: read.detail });
        return rpcResult(id, { contents: read.contents });
      }
      const guide = typeof uri === 'string' ? getGuideByUri(uri) : undefined;
      if (!guide) return rpcError(400, id, RPC_INVALID_PARAMS, `Unknown resource: ${typeof uri === 'string' ? uri.slice(0, 120) : '(none)'}`);
      return rpcResult(id, { contents: [{ uri: guide.uri, mimeType: 'text/markdown', text: guide.text }] });
    }

    case 'tools/call': {
      const params = (body.params ?? {}) as { name?: unknown; arguments?: unknown };
      if (typeof params.name !== 'string') return rpcError(400, id, RPC_INVALID_PARAMS, 'params.name is required');
      const startedMs = now();
      const trackCall = (outcome: ToolOutcome, extra: Record<string, unknown> = {}) =>
        defer(
          track(env, {
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
        const value = await renderDiagram((params.arguments ?? {}) as Record<string, unknown>);
        await trackCall('success', {
          macro_type: value.diagramType,
          render_validation: value.unvalidated ? 'unvalidated' : value.valid ? 'valid' : 'invalid',
          render_type_source: value.detected ? 'detected' : 'given',
          ...rateUnavailable,
        });
        // The view reads structuredContent (extractDiagram in
        // src/mcp-app-view.ts matches `diagramType` + `source`); the model
        // reads the text, which is a summary rather than its own source back.
        return rpcResult(id, {
          content: [{ type: 'text', text: summaryFor(value) }],
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
