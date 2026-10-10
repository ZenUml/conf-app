import { loadMermaid } from './loadMermaid';
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
  groups: { id: string }[];
}

// Mermaid owns shared parser/renderer state and inserts a temporary `d${id}`
// node into document.body while it measures the SVG. Concurrent render() calls
// can remove or mutate that node out from under one another, producing
// Chromium's `svg element not in render tree` failure. Keep the complete
// render-and-cleanup operation exclusive across every caller in this iframe.
let renderTail: Promise<void> = Promise.resolve();

function enqueueRender<T>(operation: () => Promise<T>): Promise<T> {
  const result = renderTail.then(operation);
  // A failed diagram must not poison the queue for every later diagram.
  renderTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
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

// Test seam: callers must reset only after their queued work has settled.
export function __resetMermaidRenderQueueForTests(): void {
  renderTail = Promise.resolve();
}
