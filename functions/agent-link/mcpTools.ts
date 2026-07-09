// Pure MCP tool definitions + dispatch for the Live Agent Link relay.
// See docs/superpowers/specs/2026-07-08-live-agent-link-design.md §6 (MCP tool
// surface, bound to one session).
//
// No I/O in this file — `dispatchTool` validates the tool name + argument
// shape and then calls the injected `forwardToMacro`, so this module is
// unit-testable without a Workers runtime or the (not-yet-built)
// AgentLinkSession Durable Object. The real macro-forwarding implementation
// is a later task; `mcp.ts` injects a stub today.

import type { SessionRecord } from './sessionToken';
import { ZENUML_DSL_TOOL_HINT } from './zenumlDslGuide';

/** The 4 tools exposed to the paired agent (design §6). No create/list/other-content writes. */
export type ToolName = 'read_page' | 'read_diagram' | 'update_diagram' | 'get_status';

export interface ToolDescriptor {
  name: ToolName;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

/** Error codes surfaced by `dispatchTool`; `mcp.ts` maps these to JSON-RPC errors. */
export type ToolErrorCode = 'unknown_tool' | 'bad_args';

export class ToolError extends Error {
  readonly code: ToolErrorCode;

  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

/** The result forwarded back from the (currently stubbed) macro side. */
export type ForwardResult = Record<string, unknown>;

/**
 * Injected by the caller (mcp.ts) so it can be a stub today and a real
 * relay-to-DO call later, without this module or its tests changing.
 */
export interface DispatchContext {
  forwardToMacro(op: ToolName, payload: Record<string, unknown>): Promise<ForwardResult>;
  session: SessionRecord;
}

export const TOOLS: ToolDescriptor[] = [
  {
    name: 'read_page',
    description: "Read the bound Confluence page's title and text, for context.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_diagram',
    description: "Read the bound diagram's current DSL and diagram type.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'update_diagram',
    description:
      "Replace the bound diagram's DSL. The macro renders it live and persists it via its own Forge bridge. " +
      ZENUML_DSL_TOOL_HINT,
    inputSchema: {
      type: 'object',
      properties: {
        dsl: { type: 'string', description: 'The full replacement diagram DSL.' },
        summary: {
          type: 'string',
          description: 'Optional one-line description of the change, shown in the activity feed.',
        },
      },
      required: ['dsl'],
    },
  },
  {
    name: 'get_status',
    description: 'Get the current link status: connection, bound diagram type/page, and token TTL remaining.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const TOOL_NAMES: ReadonlySet<string> = new Set(TOOLS.map((t) => t.name));

/** Returns the tool descriptors for an MCP `tools/list` response. */
export function getToolSchemas(): ToolDescriptor[] {
  return TOOLS;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates `name` + `args`, then forwards to the injected `ctx.forwardToMacro`
 * and returns its result verbatim. Throws `ToolError('unknown_tool')` for an
 * unrecognized tool name, `ToolError('bad_args')` for a shape mismatch.
 */
export async function dispatchTool(
  name: string,
  args: unknown,
  ctx: DispatchContext,
): Promise<ForwardResult> {
  if (!TOOL_NAMES.has(name)) {
    throw new ToolError('unknown_tool', `Unknown tool: ${name}`);
  }
  const toolName = name as ToolName;

  const providedArgs = args ?? {};
  if (!isPlainObject(providedArgs)) {
    throw new ToolError('bad_args', `Arguments for "${toolName}" must be an object`);
  }

  switch (toolName) {
    case 'read_page':
    case 'read_diagram':
    case 'get_status':
      return ctx.forwardToMacro(toolName, {});

    case 'update_diagram': {
      const { dsl, summary } = providedArgs;
      if (typeof dsl !== 'string') {
        throw new ToolError('bad_args', 'update_diagram requires a "dsl" string');
      }
      if (summary !== undefined && typeof summary !== 'string') {
        throw new ToolError('bad_args', 'update_diagram "summary" must be a string when provided');
      }
      return ctx.forwardToMacro('update_diagram', { dsl, summary });
    }
  }
}
