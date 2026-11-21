// Closed-vocabulary descriptions of a write-guard refusal, for analytics.
// The guard's own output (parser messages, the source itself) can quote a
// customer's diagram, so none of it leaves the backend: only the classes
// below and plain numbers do. Vocabularies: AgentLinkGuardrailErrorKind and
// AgentLinkGuardrailDslKind in src/utils/analytics/catalog.ts.

export type GuardrailErrorKind = 'unknown_diagram' | 'unexpected_end' | 'syntax';

/**
 * Class of the first parse error. Mermaid's "No diagram type detected" is what
 * bare Mermaid core said about every `zenuml` block (the 2026-11 false
 * refusals); an error at end of input is what a truncated source produces.
 */
export function guardrailErrorKindOf(message: unknown): GuardrailErrorKind | undefined {
  if (typeof message !== 'string') return undefined;
  if (/no diagram type detected|unknowndiagramerror/i.test(message)) return 'unknown_diagram';
  if (/got 'EOF'|unexpected end|end of input|missing @end|unclosed '/i.test(message)) return 'unexpected_end';
  return 'syntax';
}

/** Mermaid's diagram keywords; anything else is reported as 'other', never as itself. */
const MERMAID_KEYWORDS = new Set([
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'stateDiagram-v2',
  'erDiagram', 'journey', 'gantt', 'pie', 'quadrantChart', 'requirementDiagram', 'gitGraph',
  'C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment', 'mindmap', 'timeline',
  'zenuml', 'sankey-beta', 'xychart-beta', 'block-beta', 'packet-beta', 'architecture-beta',
  'kanban', 'radar-beta', 'treemap-beta',
]);

/**
 * The diagram keyword a Mermaid source starts with, after the front matter,
 * `%%{…}%%` directives and `%%` comments Mermaid itself skips.
 */
export function mermaidDslKindOf(dsl: string): string {
  const body = dsl
    .replace(/^\s*---\r?\n[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/, '')
    .replace(/%%\{[\s\S]*?\}%%/g, '')
    .replace(/^[ \t]*%%.*$/gm, '');
  const word = /^\s*([A-Za-z0-9-]+)/.exec(body)?.[1];
  if (!word) return 'empty';
  return MERMAID_KEYWORDS.has(word) ? word : 'other';
}

/** New non-whitespace length as a whole % of the current one; undefined without a non-empty baseline. */
export function keptPct(currentNonWs: number, newNonWs: number): number | undefined {
  return currentNonWs > 0 ? Math.round((newNonWs / currentNonWs) * 100) : undefined;
}
