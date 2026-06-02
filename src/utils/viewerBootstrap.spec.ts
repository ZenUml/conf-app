import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent } from 'vue';
import { bootstrapForgeViewer, publishLoadedDiagram } from '@/utils/viewerBootstrap';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import store from '@/model/store2';
import globals from '@/model/globals';
import { mountRoot } from '@/mount-root';
import { tryFullscreenViewerPaywall } from '@/utils/paywall/mountPaywallGate';

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      initializeContext: vi.fn(() => Promise.resolve()),
      isDisplayMode: vi.fn(() => true),
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
    store.state.diagram = { ...NULL_DIAGRAM };
    store.state.viewerLoadState = null;
    store.state.loadError = null;
    window.diagram = undefined;
    vi.mocked(globals.apWrapper.isDisplayMode).mockReturnValue(true);
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
    expect(store.state.viewerLoadState).toBe('ready');
    expect(window.diagram).toStrictEqual(loaded);
  });

  it('marks rejected loadDiagram as failed_with_source when a custom content id exists', async () => {
    window.forgeGlobal = {
      forgeContext: {
        extension: { config: { customContentId: 'cc-missing' } },
      },
    } as any;
    const onError = vi.fn();

    await bootstrapForgeViewer({
      macroKind: 'graph',
      content: Component,
      loadDiagram: vi.fn(async () => {
        throw new Error('network down');
      }),
      onError,
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(store.state.viewerLoadState).toBe('failed_with_source');
    expect(store.state.loadError).toMatchObject({
      errorClass: 'thrown',
      errorCode: 'network down',
    });
    expect(store.state.diagram).toStrictEqual(NULL_DIAGRAM);
  });

  it('marks rejected loadDiagram as failed_without_source when no custom content id exists', async () => {
    window.forgeGlobal = {
      forgeContext: {
        extension: { config: {} },
      },
    } as any;

    await bootstrapForgeViewer({
      macroKind: 'embed',
      content: Component,
      loadDiagram: vi.fn(async () => {
        throw new Error('load blew up');
      }),
      onError: vi.fn(),
    });

    expect(store.state.viewerLoadState).toBe('failed_without_source');
    expect(store.state.loadError?.errorClass).toBe('thrown');
  });

  it('marks failed loads with a source id as failed_with_source', async () => {
    window.forgeGlobal = {
      forgeContext: {
        extension: { config: { customContentId: 'cc-missing' } },
      },
    } as any;

    await bootstrapForgeViewer({
      macroKind: 'openapi',
      content: Component,
      loadDiagram: vi.fn(async () => ({
        doc: undefined,
        loadError: { httpStatus: 404, directFetchStatus: 'not_found' },
      })),
    });

    expect(store.state.viewerLoadState).toBe('failed_with_source');
    expect(store.state.loadError).toEqual({ httpStatus: 404, directFetchStatus: 'not_found' });
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

  it('normalizes a missing document to NULL_DIAGRAM', () => {
    const diagram = publishLoadedDiagram(undefined);
    expect(diagram).toBe(NULL_DIAGRAM);
    expect(store.state.diagram).toStrictEqual(NULL_DIAGRAM);
    expect(window.diagram).toStrictEqual(NULL_DIAGRAM);
  });
});
