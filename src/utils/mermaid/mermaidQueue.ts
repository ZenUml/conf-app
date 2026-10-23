// Mermaid owns shared parser/renderer state and inserts a temporary `d${id}`
// node into document.body while it measures the SVG. Concurrent render() calls
// can remove or mutate that node out from under one another, producing
// Chromium's `svg element not in render tree` failure. Keep every operation on
// the shared instance (render, parse, validate) exclusive within this iframe.
let tail: Promise<void> = Promise.resolve();

export function enqueueMermaid<T>(operation: () => Promise<T>): Promise<T> {
  const result = tail.then(operation);
  // A failed diagram must not poison the queue for every later diagram.
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// Test seam: callers must reset only after their queued work has settled.
export function __resetMermaidQueueForTests(): void {
  tail = Promise.resolve();
}
