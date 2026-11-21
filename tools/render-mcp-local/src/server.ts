// The render_diagram MCP server, run on the user's own machine over stdio.
//
// The public server at https://zenuml.com/mcp receives every diagram's source
// in its tools/call request: that is how MCP works for a remote server, and the
// MCP Apps view cannot change it. This package answers tools/call locally
// instead, so the source goes agent -> host -> this process -> host -> the
// view's iframe, and never to us.
//
// What still reaches zenuml.com, and why it carries no diagram content:
//   - resources/read fetches the built view (mcp-app/view.html) from
//     `viewOrigin`. That is a plain GET with no diagram in it.
//   - The host then loads the view's script, CSS and font chunks, and for Graph
//     the DrawIO viewer and its stencil XML, from the same origin (the CSP below
//     names it). Which renderer chunk loads reveals the diagram TYPE, not its
//     source.
//   - The view posts enum-only events to /mcp/view-event (functions/agent-link/
//     viewEvent.ts drops anything that is not one of its enums).
// This process sends no analytics of its own.

import { getGuideByUri, listGuideResources } from '../../../functions/agent-link/dslGuides';
import {
  DIAGRAM_VIEW_URI,
  readUiResource,
  uiCapability,
  uiMeta,
  uiResourceList,
} from '../../../functions/agent-link/oauth/mcpApps';
import { negotiateProtocolVersion } from '../../../functions/agent-link/mcpProtocol';
import {
  INSTRUCTIONS,
  RENDER_TOOL,
  RenderParamsError,
  chainSummaryFor,
  renderDiagram,
  withChain,
} from '../../../functions/agent-link/renderTool';

export const DEFAULT_VIEW_ORIGIN = 'https://zenuml.com';

const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_INTERNAL_ERROR = -32603;
const RPC_TOOL_ERROR = -32003;

type JsonRpcId = string | number | null;

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface LocalServerOptions {
  /** Where the view and its assets are served from. */
  viewOrigin?: string;
  /** Injected so tests need no network; used only to fetch the view. */
  fetchImpl?: (url: string) => Promise<Response>;
  version?: string;
}

const LOCAL_INSTRUCTIONS =
  `${INSTRUCTIONS} This server runs on the user's machine: the diagram source is checked locally and is not sent to ZenUML.`;

/**
 * Accept only an https origin, or http on a loopback address for local testing.
 * The view's CSP names this origin, so it decides where the host loads code from.
 */
export function resolveViewOrigin(raw: string | undefined): string {
  if (!raw) return DEFAULT_VIEW_ORIGIN;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`ZENUML_VIEW_ORIGIN is not a URL: ${raw}`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('ZENUML_VIEW_ORIGIN must be https (or http on localhost).');
  }
  return url.origin;
}

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function fail(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
}

/**
 * Answer one parsed JSON-RPC message. Returns null for a notification, which
 * gets no reply.
 */
export function createLocalServer(options: LocalServerOptions = {}) {
  const origin = options.viewOrigin ?? DEFAULT_VIEW_ORIGIN;
  const fetchImpl = options.fetchImpl ?? ((url: string) => fetch(url));
  const version = options.version ?? '0.0.0';

  return async function handle(message: unknown): Promise<JsonRpcResponse | null> {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return fail(null, RPC_INVALID_REQUEST, 'Invalid Request: expected a JSON-RPC object');
    }
    const body = message as { id?: JsonRpcId; method?: unknown; params?: unknown };
    const isNotification = !('id' in body);
    const id = body.id ?? null;
    if (typeof body.method !== 'string') {
      // A response to a request we never send, or garbage: nothing to answer.
      return isNotification ? null : fail(id, RPC_INVALID_REQUEST, 'Invalid Request: missing "method"');
    }
    if (isNotification) return null;

    switch (body.method) {
      case 'initialize':
        return ok(id, {
          protocolVersion: negotiateProtocolVersion(
            (body.params as { protocolVersion?: unknown } | undefined)?.protocolVersion,
          ),
          capabilities: { tools: {}, resources: {}, extensions: uiCapability() },
          serverInfo: { name: 'zenuml-render-local', version },
          instructions: LOCAL_INSTRUCTIONS,
        });

      case 'ping':
        return ok(id, {});

      case 'tools/list':
        return ok(id, { tools: [{ ...RENDER_TOOL, _meta: uiMeta(origin) }] });

      case 'resources/list':
        return ok(id, { resources: [...uiResourceList(origin), ...listGuideResources()] });

      case 'resources/read': {
        const uri = (body.params as { uri?: unknown } | undefined)?.uri;
        if (uri === DIAGRAM_VIEW_URI) {
          const read = await readUiResource(uri, origin, fetchImpl);
          if (!read.ok) return fail(id, RPC_TOOL_ERROR, read.reason, { reason: read.reason, detail: read.detail });
          return ok(id, { contents: read.contents });
        }
        const guide = typeof uri === 'string' ? getGuideByUri(uri) : undefined;
        if (!guide) {
          return fail(id, RPC_INVALID_PARAMS, `Unknown resource: ${typeof uri === 'string' ? uri.slice(0, 120) : '(none)'}`);
        }
        return ok(id, { contents: [{ uri: guide.uri, mimeType: 'text/markdown', text: guide.text }] });
      }

      case 'tools/call': {
        const params = (body.params ?? {}) as { name?: unknown; arguments?: unknown };
        if (typeof params.name !== 'string') return fail(id, RPC_INVALID_PARAMS, 'params.name is required');
        if (params.name !== RENDER_TOOL.name) return fail(id, RPC_METHOD_NOT_FOUND, `Unknown tool: ${params.name.slice(0, 64)}`);
        try {
          const args = (params.arguments ?? {}) as Record<string, unknown>;
          const { result: value, chain } = await withChain(await renderDiagram(args), args.revision);
          // Same shape as the public server: the view reads structuredContent,
          // the model reads the summary. Both stay between host and this process.
          return ok(id, { content: [{ type: 'text', text: chainSummaryFor(value, chain) }], structuredContent: value });
        } catch (e) {
          if (e instanceof RenderParamsError) {
            return ok(id, { content: [{ type: 'text', text: e.message }], isError: true });
          }
          return fail(id, RPC_INTERNAL_ERROR, e instanceof Error ? e.message : String(e));
        }
      }

      default:
        return fail(id, RPC_METHOD_NOT_FOUND, `Unknown method: ${body.method}`);
    }
  };
}

/**
 * The stdio transport: one JSON-RPC message per line in, one per line out.
 * stdout carries protocol only; anything human-readable goes to stderr.
 */
export function serveStdio(
  handle: ReturnType<typeof createLocalServer>,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  const write = (response: JsonRpcResponse) => output.write(`${JSON.stringify(response)}\n`);
  let buffer = '';
  let pending = Promise.resolve();

  const onLine = (line: string) => {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      write(fail(null, RPC_PARSE_ERROR, 'Parse error: invalid JSON'));
      return;
    }
    // Answer in arrival order, but do not let one slow parse block reading.
    pending = pending.then(async () => {
      try {
        const response = await handle(message);
        if (response) write(response);
      } catch (e) {
        const msgId = (message as { id?: JsonRpcId } | null)?.id ?? null;
        write(fail(msgId, RPC_INTERNAL_ERROR, e instanceof Error ? e.message : String(e)));
      }
    });
  };

  return new Promise((resolve) => {
    input.setEncoding?.('utf8');
    input.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        onLine(buffer.slice(0, newline).replace(/\r$/, ''));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    });
    input.on('end', () => {
      if (buffer) onLine(buffer);
      void pending.then(() => resolve());
    });
  });
}
