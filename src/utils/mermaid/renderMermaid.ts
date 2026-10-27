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

export function renderMermaid(id: string, source: string, options: { captureFlowchartModel?: boolean } = {}): Promise<MermaidRenderResult> {
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
      const result = await mermaid.render(id, source);
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
