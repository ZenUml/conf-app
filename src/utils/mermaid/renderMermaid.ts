import { loadMermaid } from './loadMermaid';
import { enqueueMermaid as enqueueRender } from './mermaidQueue';
import { readMermaidFlowchartModel } from '../../../tools/mermaid-highlights/src/mermaid-highlights.mjs';

export interface MermaidRenderResult {
  svg: string;
  flowchartModel?: MermaidFlowchartModel;
  bindFunctions?: (element: Element) => void;
}

export interface MermaidFlowchartModel {
  type: string;
  nodes: { id: string; domId: string }[];
  edges: { id: string; source: string; target: string }[];
  groups: { id: string; nodes: string[] }[];
}

/** Parse within Mermaid's shared-state queue without producing a second SVG. */
export function parseMermaidFlowchart(source: string): Promise<MermaidFlowchartModel> {
  return enqueueRender(async () => {
    const mermaid = await loadMermaid();
    return readMermaidFlowchartModel(await mermaid.mermaidAPI.getDiagramFromText(source));
  });
}

// Mermaid's own front-matter shape (frontMatterRegex in mermaid 11).
const FRONTMATTER = /^([^\S\n\r]*)-{3}\s*[\n\r](.*?)[\n\r]\1-{3}\s*[\n\r]+/s;
const INIT_DIRECTIVE = /%%\{\s*init(?:ialize)?\b[\s\S]*?\}%%/gi;

/**
 * Asks Mermaid for `theme` on this render only, through an init directive, so
 * the shared site config (and the validator that re-initialises it) is left
 * alone. A theme the author chose in front matter or a directive wins.
 */
export function withMermaidTheme(source: string, theme: string): string {
  const frontmatter = source.match(FRONTMATTER);
  if (frontmatter && /^\s*theme\s*:/m.test(frontmatter[2])) return source;
  if ((source.match(INIT_DIRECTIVE) ?? []).some((directive) => /["']?theme["']?\s*:/.test(directive))) return source;
  const directive = `%%{init: {"theme": "${theme}"}}%%\n`;
  if (!frontmatter) return directive + source;
  const head = frontmatter[0];
  return head + directive + source.slice(head.length);
}

export function renderMermaid(
  id: string,
  source: string,
  options: { captureFlowchartModel?: boolean; theme?: 'dark' } = {},
): Promise<MermaidRenderResult> {
  return enqueueRender(async () => {
    const mermaid = await loadMermaid();
    try {
      let flowchartModel: MermaidRenderResult['flowchartModel'];
      if (options.captureFlowchartModel) {
        // Shared parser state must be read within this queue, before a later render.
        // Unsupported diagrams or snapshot failures never block ordinary rendering.
        try { flowchartModel = readMermaidFlowchartModel(await mermaid.mermaidAPI.getDiagramFromText(source)); }
        catch { /* Optional enhancement unavailable; preserve the renderer. */ }
      }
      const result = await mermaid.render(id, options.theme ? withMermaidTheme(source, options.theme) : source);
      return options.captureFlowchartModel ? { ...result, flowchartModel } : result;
    } finally {
      // Mermaid normally removes this itself, but rejection paths can leave it
      // behind. The ID belongs to this queued operation, never another render.
      if (typeof document !== 'undefined') {
        document.getElementById(`d${id}`)?.remove();
      }
    }
  });
}

export { __resetMermaidQueueForTests as __resetMermaidRenderQueueForTests } from './mermaidQueue';
