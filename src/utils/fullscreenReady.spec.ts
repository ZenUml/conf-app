import { afterEach, describe, expect, it, vi } from 'vitest';
import { onVisibleDiagramReady, reportDiagramReady } from './fullscreenReady';

describe('successful fullscreen display receipt', () => {
  afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function fixture() {
    const root = document.createElement('div');
    const diagram = document.createElement('div');
    root.append(diagram); document.body.append(root);
    vi.spyOn(diagram, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 100, top: 1, bottom: 101, left: 1, right: 201 } as DOMRect);
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 1; });
    return { root, diagram };
  }
  it('does not activate just because content mounted; requires a successful renderer receipt', () => {
    const { root, diagram } = fixture(); const callback = vi.fn();
    const stop = onVisibleDiagramReady(() => root, callback);
    expect(callback).not.toHaveBeenCalled();
    reportDiagramReady(diagram, 'mermaid'); reportDiagramReady(diagram, 'mermaid');
    expect(callback).toHaveBeenCalledTimes(1); expect(callback).toHaveBeenCalledWith('mermaid'); stop();
  });
  it('ignores a stale or unrelated renderer and an unmounted host', () => {
    const { root, diagram } = fixture(); const callback = vi.fn();
    const stop = onVisibleDiagramReady(() => root, callback);
    reportDiagramReady(document.createElement('div'), 'mermaid'); root.remove();
    reportDiagramReady(diagram, 'mermaid'); expect(callback).not.toHaveBeenCalled(); stop();
  });
  it('waits for a hidden document to become visible without consuming the receipt', () => {
    const { root, diagram } = fixture(); const callback = vi.fn();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const stop = onVisibleDiagramReady(() => root, callback); reportDiagramReady(diagram, 'graph');
    expect(callback).not.toHaveBeenCalled(); visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange')); expect(callback).toHaveBeenCalledWith('graph'); stop();
  });
  it('unsubscribes before a late successful render', () => {
    const { root, diagram } = fixture(); const callback = vi.fn();
    const stop = onVisibleDiagramReady(() => root, callback); stop(); reportDiagramReady(diagram, 'mermaid');
    expect(callback).not.toHaveBeenCalled();
  });
});
