// Which language a diagram's source is written in, for render_diagram calls
// that leave `diagramType` out.
//
// Every supported language but ZenUML announces itself near the top: PlantUML
// with `@start…`, draw.io with its XML root, OpenAPI with a top-level
// `openapi:` / `swagger:` key, Mermaid with a diagram-type keyword on its
// first line. ZenUML has no header, so it is what is left. A guess that is
// wrong is not silent: the source then fails the chosen language's parse
// check, and render_diagram reports the errors to the agent.

export type DetectedType = 'sequence' | 'mermaid' | 'plantuml' | 'graph' | 'openapi';

/**
 * Mermaid's diagram-type keywords, as the first token of the first real line.
 * `zenuml` is deliberately absent: Mermaid's own ZenUML diagram is better
 * drawn by our ZenUML renderer, but its source starts with a header ours does
 * not accept, so it is left to fail visibly rather than be half-supported.
 */
const MERMAID_HEADERS = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'quadrantChart',
  'requirementDiagram',
  'gitGraph',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
  'mindmap',
  'timeline',
  'sankey-beta',
  'xychart-beta',
  'block-beta',
  'packet-beta',
  'kanban',
  'architecture-beta',
  'radar-beta',
  'treemap-beta',
];

/** The first line that is not blank, a Mermaid `%%` comment/directive, or inside `---` front matter. */
function firstMeaningfulLine(source: string): string {
  const lines = source.split(/\r?\n/);
  let i = 0;
  const skipBlank = () => {
    while (i < lines.length && (lines[i].trim() === '' || lines[i].trim().startsWith('%%'))) i++;
  };
  skipBlank();
  if (lines[i]?.trim() === '---') {
    i++;
    while (i < lines.length && lines[i].trim() !== '---') i++;
    i++;
    skipBlank();
  }
  return (lines[i] ?? '').trim();
}

export function detectDiagramType(source: string): DetectedType {
  const text = source.replace(/^﻿/, '').trimStart();

  if (/^@start[a-z]*/i.test(text)) return 'plantuml';
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(mxfile|mxGraphModel)\b/.test(text)) return 'graph';
  // JSON: a top-level "openapi"/"swagger" key. YAML: one at column 0.
  if (text.startsWith('{') ? /"(openapi|swagger)"\s*:/.test(text) : /^(openapi|swagger)\s*:/m.test(text)) return 'openapi';

  const first = firstMeaningfulLine(text);
  const token = first.split(/[\s;{]/)[0];
  if (MERMAID_HEADERS.includes(token)) return 'mermaid';

  return 'sequence';
}
