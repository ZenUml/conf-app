export type MacroKind =
  | 'sequence'
  | 'mermaid'
  | 'graph'
  | 'openapi'
  | 'embed'
  | 'plantuml'
  | 'unknown'

export interface AdvocacyMessageContext {
  spaceKey: string
  macroCount: number
  macrosLimit: number
  upgradeUrl: string
  enterpriseBundleUrl: string
  enterpriseBundlePrice: string
  macroKind: MacroKind
}

export type AdvocacySegment =
  | { type: 'text'; value: string }
  | { type: 'token'; value: string }
  | { type: 'link'; value: string }

const MACRO_LABELS: Record<MacroKind, string> = {
  sequence: 'sequence diagrams',
  mermaid: 'Mermaid diagrams',
  graph: 'DrawIO diagrams',
  openapi: 'OpenAPI specs',
  embed: 'embedded diagrams',
  plantuml: 'PlantUML diagrams',
  unknown: 'diagrams',
}

export function macroLabelFor(kind: MacroKind): string {
  return MACRO_LABELS[kind] ?? MACRO_LABELS.unknown
}

/**
 * Single source of truth for the advocacy message.
 * Returns a structured sequence of segments — text runs (with literal \n
 * characters preserved), token spans (highlighted values like the space
 * key and macro count), and link segments (URLs rendered as clickable
 * hyperlinks in the preview but pasted as plain text into the clipboard).
 */
export function advocacySegments(ctx: AdvocacyMessageContext): AdvocacySegment[] {
  const macroLabel = macroLabelFor(ctx.macroKind)
  return [
    { type: 'text', value: `Hey,\n\nI've been using ZenUML for Confluence Lite to create ${macroLabel} in our "` },
    { type: 'token', value: ctx.spaceKey },
    { type: 'text', value: '" Confluence space, and we\'ve just hit the Lite limit (' },
    { type: 'token', value: String(ctx.macroCount) },
    { type: 'text', value: ' of ' },
    { type: 'token', value: String(ctx.macrosLimit) },
    {
      type: 'text',
      value:
        ' macros). New edits are blocked until someone with billing access upgrades the space.\n\nTwo options when you have a moment:\n\n  • ZenUML Marketplace plan — per-user monthly billing through Atlassian.\n    ',
    },
    { type: 'link', value: ctx.upgradeUrl },
    { type: 'text', value: '\n  • Enterprise bundle — ' },
    { type: 'token', value: ctx.enterpriseBundlePrice },
    {
      type: 'text',
      value: ', annual flat fee, includes the AI diagramming tools too.\n    ',
    },
    { type: 'link', value: ctx.enterpriseBundleUrl },
    {
      type: 'text',
      value:
        '\n\nCould you take a quick look? Happy to send more details — I\'m running into the limit on existing work and would love to keep moving.\n\nThanks!',
    },
  ]
}

export function buildAdvocacyMessage(ctx: AdvocacyMessageContext): string {
  return advocacySegments(ctx)
    .map((s) => s.value)
    .join('')
}
