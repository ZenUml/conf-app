import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent } from 'vue';
import { bootstrapForgeViewer, publishLoadedDiagram } from '@/utils/viewerBootstrap';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import store from '@/model/store2';
import globals from '@/model/globals';
import { mountRoot } from '@/mount-root';
import { tryFullscreenViewerPaywall } from '@/utils/paywall/mountPaywallGate';
import { getTimings, _resetForTesting } from '@/utils/analytics/renderPerf';

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      initializeContext: vi.fn(() => Promise.resolve()),
    },
  },
}));

vi.mock('@/mount-root', () => ({
  mountRoot: vi.fn(),
}));

vi.mock('@/utils/paywall/mountPaywallGate', () => ({
  tryFullscreenViewerPaywall: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

const Component = defineComponent({ template: '<div />' });

describe('viewerBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    store.state.diagram = { ...NULL_DIAGRAM };
    window.diagram = undefined;
  });

  it('mounts a stable NULL_DIAGRAM shell before loading and then publishes the loaded diagram', async () => {
    const events: string[] = [];
    vi.mocked(mountRoot).mockImplementation(() => {
      events.push('mount');
    });
    const loaded = { ...NULL_DIAGRAM, diagramType: DiagramType.OpenApi, code: 'openapi: 3.0.0' };
    const loadDiagram = vi.fn(async () => {
      events.push('load');
      return loaded;
    });
    const afterLoad = vi.fn(() => {
      events.push('afterLoad');
    });

    await bootstrapForgeViewer({
      macroKind: 'openapi',
      content: Component,
      loadDiagram,
      afterLoad,
    });

    expect(globals.apWrapper.initializeContext).toHaveBeenCalled();
    expect(tryFullscreenViewerPaywall).toHaveBeenCalledWith({
      doc: NULL_DIAGRAM,
      content: Component,
      contentProps: undefined,
      macroKind: 'openapi',
    });
    expect(mountRoot).toHaveBeenCalledWith(NULL_DIAGRAM, Component, undefined);
    expect(events).toEqual(['mount', 'load', 'afterLoad']);
    expect(store.state.diagram).toStrictEqual(loaded);
    expect(window.diagram).toStrictEqual(loaded);
  });

  it('does not mount directly when fullscreen paywall mounts the shell', async () => {
    vi.mocked(tryFullscreenViewerPaywall).mockResolvedValueOnce(true);

    await bootstrapForgeViewer({
      macroKind: 'graph',
      content: Component,
      loadDiagram: vi.fn(async () => ({ ...NULL_DIAGRAM, diagramType: DiagramType.Graph })),
    });

    expect(mountRoot).not.toHaveBeenCalled();
    expect(store.state.diagram.diagramType).toBe(DiagramType.Graph);
  });

  // #413 regression guard. graph/openapi/embed have no other owner for the
  // `fetch` phase — forgeIndex stopped loading their doc — so if this wrapper
  // is ever removed again their fetch_ms silently disappears from macro_viewed
  // and duration_ms becomes unattributable. That went unnoticed for four days.
  it('records the fetch phase around the viewer-owned content load', async () => {
    expect(getTimings().fetch_ms).toBeUndefined();

    await bootstrapForgeViewer({
      macroKind: 'openapi',
      content: Component,
      loadDiagram: vi.fn(async () => ({ ...NULL_DIAGRAM, diagramType: DiagramType.OpenApi })),
    });

    expect(getTimings().fetch_ms).toBeTypeOf('number');
  });

  it('still records the fetch phase when the content load fails', async () => {
    const boom = new Error('custom content 500');
    await bootstrapForgeViewer({
      macroKind: 'graph',
      content: Component,
      loadDiagram: vi.fn(async () => { throw boom; }),
      onError: vi.fn(),
    });

    // The timer resolves in a `finally`, so a failed load is still attributed
    // rather than leaving the phase absent and inflating the remainder.
    expect(getTimings().fetch_ms).toBeTypeOf('number');
  });

  it('normalizes a missing document to NULL_DIAGRAM', () => {
    const diagram = publishLoadedDiagram(undefined);
    expect(diagram).toBe(NULL_DIAGRAM);
    expect(store.state.diagram).toStrictEqual(NULL_DIAGRAM);
    expect(window.diagram).toStrictEqual(NULL_DIAGRAM);
  });
});
