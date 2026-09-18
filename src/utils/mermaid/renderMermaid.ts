import { loadMermaid } from './loadMermaid';

export interface MermaidRenderResult {
  svg: string;
  bindFunctions?: (element: Element) => void;
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

export function renderMermaid(id: string, source: string): Promise<MermaidRenderResult> {
  return enqueueRender(async () => {
    const mermaid = await loadMermaid();
    try {
      return await mermaid.render(id, source);
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
