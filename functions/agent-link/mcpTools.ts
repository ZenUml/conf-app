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
import { COMBINED_DSL_TOOL_HINT, selectToolHint } from './dslGuides';
import { guardUpdateDiagram } from './updateDiagramGuard';
import type { DiagramSnapshot } from './updateDiagramGuard';

/**
 * The tools exposed to the paired agent. Two axes:
 *   - WRITE (bound-only): update_diagram — the one op that changes anything,
 *     scoped to the bound contentId (see the write invariant below).
 *   - READ (user-permissioned, may reach beyond the bound diagram): read_page,
 *     read_diagram, get_status, plus the Track U discovery surface
 *     search_diagrams / list_diagrams. Discovery widens what the agent can SEE,
 *     never what it can write (design §3 trust boundary, §S3/S4/S5).
 */
export type ToolName =
  | 'read_page'
  | 'read_diagram'
  | 'update_diagram'
  | 'get_status'
  | 'search_diagrams'
  | 'list_diagrams';

export interface ToolProperty {
  type: string;
  description?: string;
  /** For `type: 'array'` properties — the element schema (e.g. search_diagrams.types). */
  items?: { type: string };
}

export interface ToolDescriptor {
  name: ToolName;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, ToolProperty>;
    required?: string[];
  };
}

// Diagram-type filter values accepted by search_diagrams/list_diagrams `types`.
// Lowercased logical names — the macro-side executor maps these to the coarse
// custom-content types for the CQL clause AND post-filters on the body's exact
// diagramType (sequence/mermaid/plantuml/openapi share ONE content type — see
// forgeBridge). Kept in the description so the agent knows the vocabulary.
const DIAGRAM_TYPE_FILTER_HINT =
  "one or more of 'sequence', 'mermaid', 'plantuml', 'graph', 'openapi', 'asyncapi'";

/**
 * Error codes surfaced by `dispatchTool`; `mcp.ts` maps these to JSON-RPC
 * errors. 'guardrail' = the update_diagram pre-forward guardrail rejected the
 * DSL (parse error or catastrophic data-loss) BEFORE any macro round-trip —
 * `data` carries the structured reason/errors/lengths so the agent can fix and
 * retry.
 */
export type ToolErrorCode = 'unknown_tool' | 'bad_args' | 'guardrail';

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  /** Optional structured payload surfaced as the JSON-RPC error `data` (guardrail rejections). */
  readonly data?: unknown;

  constructor(code: ToolErrorCode, message: string, data?: unknown) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.data = data;
  }
}

/**
 * The result forwarded back from the macro side. Usually an object (read/update/
 * status), but search_diagrams / list_diagrams resolve to a ROW ARRAY (design §3),
 * so the union admits arrays too.
 */
export type ForwardResult = Record<string, unknown> | unknown[];

/**
 * Injected by the caller (mcp.ts) so it can be a stub today and a real
 * relay-to-DO call later, without this module or its tests changing.
 */
export interface DispatchContext {
  forwardToMacro(op: ToolName, payload: Record<string, unknown>): Promise<ForwardResult>;
  session: SessionRecord;
  /**
   * Last-known {diagramType, dsl} for the bound diagram, cached by the
   * AgentLinkSession DO from the agent's read_diagram / prior update_diagram
   * (see updateDiagramGuard.ts). Undefined in local-dev/stub (no DO) or before
   * the agent reads the diagram — the update_diagram guardrail then degrades to
   * pass-through (documented in the guard).
   */
  diagramSnapshot?: DiagramSnapshot;
}

const UPDATE_DIAGRAM_BASE_DESCRIPTION =
  "Replace the bound diagram's DSL. The macro renders it live and persists it via its own Forge bridge. ";

/**
 * Call-time reinforcement of the minimal-edit contract (ported from the
 * offline eval, diagramly.ai-agent-link-eval Track E1 — the single biggest
 * validated win, +60pp class improvement on mermaid/plantuml; see that repo's
 * reports/E1-nonclean-attribution.md + reports/E1-ROUND23-SYNTHESIS.md). The
 * dialect guides carry the full contract; this is the terse restatement that
 * sits directly on the tool the model is about to call, not just in a guide
 * it may have read once at connect time. Only appended when a dialect hint is
 * present (i.e. never for non-DSL types like Graph/AsyncApi — see `hint`
 * below), matching the existing "no guidance pushed onto non-DSL diagrams"
 * design.
 */
const MINIMAL_EDIT_HINT =
  "Make the SMALLEST edit that fixes the reported problem, not a redesign — " +
  "and if you can't find the problem, don't return the DSL byte-for-byte " +
  'unchanged (make one small, safe cosmetic touch instead of a no-op). ';

/**
 * Build the update_diagram descriptor with a DSL hint chosen for `hint`. A
 * known non-DSL diagram type resolves to `undefined` (base description only,
 * no dialect hint); an unknown type gets the combined cross-dialect hint.
 */
function updateDiagramDescriptor(hint: string | undefined): ToolDescriptor {
  return {
    name: 'update_diagram',
    description: UPDATE_DIAGRAM_BASE_DESCRIPTION + (hint ? MINIMAL_EDIT_HINT + hint : ''),
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
  };
}

export const TOOLS: ToolDescriptor[] = [
  {
    name: 'read_page',
    description: "Read the bound Confluence page's title and text, for context.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_diagram',
    description:
      "Read a diagram's DSL and metadata. With no arguments, reads the diagram this link is bound to (unchanged default). Pass a `contentId` — e.g. one returned by search_diagrams or list_diagrams — to read ANY diagram you have Confluence permission to see. Returns { dsl, diagramType, title, pageId, contentId, version }.",
    inputSchema: {
      type: 'object',
      properties: {
        contentId: {
          type: 'string',
          description:
            'Optional. The contentId of a diagram to read (from search_diagrams / list_diagrams). Omit to read the bound diagram.',
        },
      },
    },
  },
  // Default (dialect not yet known): the combined cross-dialect hint. mcp.ts
  // passes the bound diagramType to getToolSchemas() to sharpen this per request.
  updateDiagramDescriptor(COMBINED_DSL_TOOL_HINT),
  {
    name: 'get_status',
    description: 'Get the current link status: connection, bound diagram type/page, and token TTL remaining.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_diagrams',
    description:
      "Search every diagram and API spec in this Confluence site by topic — full-text over diagram bodies AND titles, across all spaces you can access. Use it to ground your work in an existing diagram (\"do we already have a payment-callback sequence diagram?\"). Returns candidate rows { contentId, title, diagramType, spaceKey, pageId, excerpt, lastModified } ordered by recency; re-rank them yourself for relevance, then open the best hit with read_diagram { contentId }. Read-only — it never edits anything.",
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Topic or keywords to search for, matched against diagram titles and bodies.',
        },
        types: {
          type: 'array',
          description: `Optional. Restrict to these diagram types: ${DIAGRAM_TYPE_FILTER_HINT}.`,
          items: { type: 'string' },
        },
        spaceKey: {
          type: 'string',
          description: 'Optional. Restrict to a single Confluence space key.',
        },
        limit: {
          type: 'number',
          description: 'Optional. Max rows to return (default 10, capped at 25).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_diagrams',
    description:
      'List diagrams and API specs, most-recently-modified first — scoped to one space (spaceKey), one page (pageId), or the whole site if neither is given. Use it to browse when you know where to look. Same row shape as search_diagrams; open one with read_diagram { contentId }. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        spaceKey: {
          type: 'string',
          description: 'Optional. Restrict to one Confluence space key.',
        },
        pageId: {
          type: 'string',
          description: 'Optional. Restrict to the diagrams on one page id.',
        },
        types: {
          type: 'array',
          description: `Optional. Restrict to these diagram types: ${DIAGRAM_TYPE_FILTER_HINT}.`,
          items: { type: 'string' },
        },
        limit: {
          type: 'number',
          description: 'Optional. Max rows to return (default 10, capped at 25).',
        },
      },
    },
  },
];

const TOOL_NAMES: ReadonlySet<string> = new Set(TOOLS.map((t) => t.name));

/**
 * Returns the tool descriptors for an MCP `tools/list` response. When the
 * bound `diagramType` is known (the agent has read the diagram), the
 * update_diagram description carries that dialect's hint; otherwise the static
 * `TOOLS` (combined hint) is returned unchanged.
 */
export function getToolSchemas(diagramType?: string): ToolDescriptor[] {
  if (diagramType === undefined) return TOOLS;
  const hint = selectToolHint(diagramType);
  return TOOLS.map((t) => (t.name === 'update_diagram' ? updateDiagramDescriptor(hint) : t));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates an optional `string[]` arg (used by search/list `types`). Returns it, or undefined when absent. */
function validateOptionalStringArray(
  value: unknown,
  tool: string,
  field: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new ToolError('bad_args', `${tool} "${field}" must be an array of strings when provided`);
  }
  return value as string[];
}

function validateOptionalString(value: unknown, tool: string, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new ToolError('bad_args', `${tool} "${field}" must be a string when provided`);
  }
  return value;
}

function validateOptionalNumber(value: unknown, tool: string, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolError('bad_args', `${tool} "${field}" must be a number when provided`);
  }
  return value;
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
    case 'get_status':
      return ctx.forwardToMacro(toolName, {});

    case 'read_diagram': {
      // S5: default (no contentId) reads the bound diagram — unchanged, so the
      // wire payload stays `{}` for that case. A `contentId` reads any diagram
      // the user can see (still user-permissioned macro-side).
      const contentId = validateOptionalString(providedArgs.contentId, 'read_diagram', 'contentId');
      return ctx.forwardToMacro('read_diagram', contentId !== undefined ? { contentId } : {});
    }

    case 'search_diagrams': {
      // S3: one CQL primitive (macro-side), agent re-ranks. `query` required.
      const { query } = providedArgs;
      if (typeof query !== 'string' || query.trim() === '') {
        throw new ToolError('bad_args', 'search_diagrams requires a non-empty "query" string');
      }
      const types = validateOptionalStringArray(providedArgs.types, 'search_diagrams', 'types');
      const spaceKey = validateOptionalString(providedArgs.spaceKey, 'search_diagrams', 'spaceKey');
      const limit = validateOptionalNumber(providedArgs.limit, 'search_diagrams', 'limit');
      const payload: Record<string, unknown> = { query };
      if (types !== undefined) payload.types = types;
      if (spaceKey !== undefined) payload.spaceKey = spaceKey;
      if (limit !== undefined) payload.limit = limit;
      return ctx.forwardToMacro('search_diagrams', payload);
    }

    case 'list_diagrams': {
      // S4: recency-ordered browse over the same plumbing; all args optional.
      const spaceKey = validateOptionalString(providedArgs.spaceKey, 'list_diagrams', 'spaceKey');
      const pageId = validateOptionalString(providedArgs.pageId, 'list_diagrams', 'pageId');
      const types = validateOptionalStringArray(providedArgs.types, 'list_diagrams', 'types');
      const limit = validateOptionalNumber(providedArgs.limit, 'list_diagrams', 'limit');
      const payload: Record<string, unknown> = {};
      if (spaceKey !== undefined) payload.spaceKey = spaceKey;
      if (pageId !== undefined) payload.pageId = pageId;
      if (types !== undefined) payload.types = types;
      if (limit !== undefined) payload.limit = limit;
      return ctx.forwardToMacro('list_diagrams', payload);
    }

    case 'update_diagram': {
      const { dsl, summary } = providedArgs;
      if (typeof dsl !== 'string') {
        throw new ToolError('bad_args', 'update_diagram requires a "dsl" string');
      }
      if (summary !== undefined && typeof summary !== 'string') {
        throw new ToolError('bad_args', 'update_diagram "summary" must be a string when provided');
      }

      // Guardrail (charter §4-C): parse-validate the DSL and check for
      // catastrophic data-loss BEFORE forwarding. A rejection short-circuits
      // here — nothing is forwarded, nothing is persisted.
      const guard = await guardUpdateDiagram(dsl, ctx.diagramSnapshot);
      if (!guard.ok) {
        throw new ToolError('guardrail', guard.message, {
          code: 'guardrail',
          reason: guard.reason,
          errors: guard.errors,
          input_len: guard.input_len,
          output_len: guard.output_len,
        });
      }

      const result = await ctx.forwardToMacro('update_diagram', { dsl, summary });
      // Attach the semantic before/after diff (info only) so the agent can
      // detect unintended drift — rendered:true doesn't mean semantically
      // correct. Absent when the dialect isn't one we can count (PlantUML /
      // unvalidated) or there's no baseline snapshot.
      return guard.diff ? { ...result, diff: guard.diff } : result;
    }
  }
}
