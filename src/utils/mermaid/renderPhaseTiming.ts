type PhaseName = 'context_done' | 'content_done' | 'lib_start' | 'lib_done' | 'render_done';

const _marks: Partial<Record<PhaseName, number>> = {};

export function markPhase(name: PhaseName): void {
  _marks[name] = performance.now();
}

export interface MermaidPhaseTimings {
  context_init_ms?: number;
  content_fetch_ms?: number;
  lib_load_ms?: number;
  render_ms?: number;
}

export function getMermaidPhaseTimings(): MermaidPhaseTimings {
  const t0 = window.__macroLoadStart;
  if (typeof t0 !== 'number') return {};
  const { context_done, content_done, lib_start, lib_done, render_done } = _marks;
  return {
    context_init_ms: context_done !== undefined ? Math.round(context_done - t0) : undefined,
    content_fetch_ms: context_done !== undefined && content_done !== undefined
      ? Math.round(content_done - context_done) : undefined,
    lib_load_ms: lib_start !== undefined && lib_done !== undefined
      ? Math.round(lib_done - lib_start) : undefined,
    render_ms: lib_done !== undefined && render_done !== undefined
      ? Math.round(render_done - lib_done) : undefined,
  };
}
