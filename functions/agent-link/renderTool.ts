// The render_diagram tool itself, with no transport, rate limit or analytics.
//
// Shared by the public Worker (renderMcp.ts) and the local stdio package
// (packages/render-mcp-local), which runs this on the user's own machine so a
// diagram's source never reaches our servers. Keep it free of Cloudflare
// bindings and of Mixpanel: the local package bundles this file.

import { parseDsl, type DslError } from './parseDsl';
import { detectDiagramType } from './detectDiagramType';
import { lintZenuml, suggestZenumlFix, ZENUML_RENDER_CHEAT_SHEET, zenumlFailureHints, type ZenumlIssue } from './zenumlDslGuide';

/**
 * The types the view can draw (mcpApps.ts RENDERABLE_TYPES), under the names
 * the agent sends. Lower case, because that is what the view compares against.
 */
export const RENDER_TYPES = ['sequence', 'mermaid', 'plantuml', 'markdown', 'graph', 'openapi', 'asyncapi'] as const;
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
    'Use this when the user asks for a sequence diagram, or to show a request/response or call flow between systems: ' +
    'draw it here from ZenUML source (diagramType "sequence") instead of ASCII art. It shows the diagram to the user ' +
    'and saves nothing. The source may be ' +
    'a ZenUML sequence diagram, Mermaid, PlantUML (@startuml … @enduml), Markdown (with ```mermaid code blocks drawn ' +
    'as diagrams), draw.io / diagrams.net XML, an OpenAPI or Swagger spec, or an AsyncAPI spec (YAML or JSON). ' +
    'diagramType is optional: leave it out and the language is detected from the source (a source with no recognised ' +
    'header is read as ZenUML, so pass markdown explicitly), or pass it to be explicit. The result says which type was ' +
    'used and whether the source parsed; when it did not, ' +
    'it lists the errors with line and column, so fix them and call again. ' +
    ZENUML_RENDER_CHEAT_SHEET,
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

export const INSTRUCTIONS =
  'When the user asks for a sequence diagram, or to show a request/response or call flow between systems, call ' +
  'render_diagram with ZenUML source (diagramType "sequence") instead of drawing it as ASCII art or plain text. ' +
  'It also draws Mermaid, PlantUML, Markdown, draw.io XML, and OpenAPI or AsyncAPI specs. No Atlassian site or ' +
  'sign-in is involved and nothing is saved. If the result reports parse errors, fix the source and call ' +
  'render_diagram again. The zenuml://, mermaid://, plantuml:// and openapi:// dsl-guide resources give the rules ' +
  'of each language.';

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
  /** ZenUML only: the source parsed, but these mistakes change what is drawn. */
  warnings?: ZenumlIssue[];
  /** ZenUML only: specific fixes for recognised mistakes in a failed parse. */
  hints?: ZenumlIssue[];
  /**
   * ZenUML only: a rewrite of `source` that fixes a recognised `group` mistake,
   * checked here to parse with no warnings. The agent's next call; never drawn.
   */
  suggestedSource?: string;
}

export class RenderParamsError extends Error {
  constructor(message: string, readonly code: 'bad_params' | 'too_large') {
    super(message);
  }
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
  const zenuml = diagramType === 'sequence';
  if (!parsed.ok) {
    const hints = zenuml ? zenumlFailureHints(source, parsed.errors) : [];
    const suggestion = hints.length ? await checkedFix(source) : undefined;
    return { ...base, valid: false, errors: parsed.errors, ...(hints.length ? { hints } : {}), ...suggestion };
  }
  const warnings = zenuml ? lintZenuml(source) : [];
  const suggestion = warnings.length ? await checkedFix(source) : undefined;
  return {
    ...base,
    valid: true,
    ...(parsed.unvalidated ? { unvalidated: true as const } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...suggestion,
  };
}

/** suggestZenumlFix, kept only when the rewrite parses and lints clean. */
async function checkedFix(source: string): Promise<{ suggestedSource: string } | undefined> {
  const fixed = suggestZenumlFix(source);
  if (!fixed || fixed === source) return undefined;
  const parsed = await parseDsl('sequence', fixed);
  return parsed.ok && lintZenuml(fixed).length === 0 ? { suggestedSource: fixed } : undefined;
}

/** The next call to make, when a checked rewrite exists. */
function suggested(r: RenderResult): string {
  if (!r.suggestedSource) return '';
  return `\n\nThis rewrite parses with no warnings; unless it changes what the user asked for, call render_diagram again with this source:\n\`\`\`\n${r.suggestedSource}\n\`\`\``;
}

/** What the agent reads first. The source itself rides structuredContent, for the view. */
export function summaryFor(r: RenderResult): string {
  const detected = r.detected ? ` (detected from the source; pass diagramType if that is wrong)` : '';
  const at = (e: { line: number; col: number; message: string }) => `- line ${e.line}, column ${e.col}: ${e.message}`;
  if (!r.valid) {
    const lines = [...(r.hints ?? []), ...(r.errors ?? [])].map(at);
    const hint = r.diagramType === 'sequence' ? `\n\n${ZENUML_RENDER_CHEAT_SHEET}` : '';
    return `The ${r.diagramType} source${detected} did not parse, so the diagram may not draw. Fix these and call render_diagram again:\n${lines.join('\n')}${suggested(r)}${hint}`;
  }
  if (r.unvalidated) return `Sent the ${r.diagramType} diagram${detected} to the view. This type is not syntax-checked here.`;
  if (r.warnings?.length) {
    return `Rendered the ${r.diagramType} diagram${detected}. The source parsed, but it will not draw what you meant. Fix these and call render_diagram again:\n${r.warnings.map(at).join('\n')}${suggested(r)}`;
  }
  return `Rendered the ${r.diagramType} diagram${detected}. The source parsed.`;
}
