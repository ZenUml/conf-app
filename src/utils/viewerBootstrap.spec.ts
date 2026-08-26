import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent } from 'vue';
import { bootstrapForgeViewer, publishLoadedDiagram } from '@/utils/viewerBootstrap';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import store from '@/model/store2';
import globals from '@/model/globals';
import { mountRoot } from '@/mount-root';
import { tryFullscreenViewerPaywall } from '@/utils/paywall/mountPaywallGate';
import { getTimings, _resetForTesting } from '@/utils/analytics/renderPerf';
import {
  getCachedContent,
  putCachedContent,
  _resetForTesting as _resetContentCacheForTesting,
} from '@/utils/renderCache/contentCacheStore';

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

// Forge bridge context resolve — resolveContentId's argument. The actual
// shape doesn't matter for these tests (resolveContentId is test-controlled
// below); this only needs to resolve so `await initForgeContext()` doesn't hang.
// `default` mirrors the real module's default export — getForgeCustomContentId
// (viewerLoadOutcome.ts) reads forgeContext off it; individual tests below
// mutate mockForgeGlobal.forgeContext rather than window.forgeGlobal.
const mockForgeGlobal = vi.hoisted(() => ({ forgeContext: undefined as any }));
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: mockForgeGlobal,
  getContext: vi.fn(() => Promise.resolve({ extension: {} })),
}));

// Spy-wrapped but functionally real (backed by an in-memory Map, reusing the
// real cyrb53 hashContent) so hash-change-detection assertions below are
// faithful to the actual store, while call-count assertions (no resolver / no
// cache reads or writes) stay possible.
vi.mock('@/utils/renderCache/contentCacheStore', async () => {
  const actual = await vi.importActual<typeof import('@/utils/renderCache/contentCacheStore')>(
    '@/utils/renderCache/contentCacheStore',
  );
  let map = new Map<string, { doc: string; hash: string }>();
  return {
    hashContent: actual.hashContent,
    getCachedContent: vi.fn((id: string) => map.get(id)),
    putCachedContent: vi.fn((id: string, doc: string) => {
      map.set(id, { doc, hash: actual.hashContent(doc) });
      return true;
    }),
    _resetForTesting: vi.fn(() => {
      map = new Map();
    }),
  };
});

const Component = defineComponent({ template: '<div />' });

/** Flush pending microtasks (a background `void revalidateViewer(...)` call). */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A manually-resolved promise, for asserting a "before the background fetch
 * lands" state deterministically. An immediately-resolving `async () => x`
 * loadDiagram races against `bootstrapForgeViewer`'s OWN remaining await
 * chain (initializeContext / tryFullscreenViewerPaywall / initForgeContext)
 * for microtask ordering — not safe to assert against pre-flush.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('viewerBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    _resetContentCacheForTesting();
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
    mockForgeGlobal.forgeContext = {
      extension: { config: { customContentId: 'cc-missing' } },
    };
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
    // publishLoadedDiagram attaches the load error to the published diagram
    // (the `doc`-prop channel OpenApiViewer reads) alongside the store slots.
    expect(store.state.diagram).toStrictEqual({
      ...NULL_DIAGRAM,
      loadError: store.state.loadError,
    });
  });

  it('marks rejected loadDiagram as failed_without_source when no custom content id exists', async () => {
    mockForgeGlobal.forgeContext = {
      extension: { config: {} },
    };

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
    mockForgeGlobal.forgeContext = {
      extension: { config: { customContentId: 'cc-missing' } },
    };

    await bootstrapForgeViewer({
      macroKind: 'openapi',
      content: Component,
      loadDiagram: vi.fn(async () => ({
        doc: undefined,
        loadError: { httpStatus: 404, directFetchStatus: 'not_found' as const },
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

  it('accepts a { doc, loadError } loadDiagram result and publishes the doc with loadError attached', async () => {
    const loaded = { ...NULL_DIAGRAM, diagramType: DiagramType.OpenApi };
    await bootstrapForgeViewer({
      macroKind: 'openapi',
      content: Component,
      loadDiagram: vi.fn(async () => ({ doc: loaded, loadError: null })),
    });
    expect(store.state.diagram).toStrictEqual(loaded);
  });

  it('a failed load ({ doc: undefined, loadError }) publishes NULL_DIAGRAM with loadError attached', async () => {
    await bootstrapForgeViewer({
      macroKind: 'openapi',
      content: Component,
      loadDiagram: vi.fn(async () => ({
        doc: undefined,
        loadError: { directFetchStatus: 'not_found' as const, errorClass: 'structured' as const },
      })),
    });
    expect(store.state.diagram).toEqual({
      ...NULL_DIAGRAM,
      loadError: { directFetchStatus: 'not_found', errorClass: 'structured' },
    });
    expect(store.state.diagramLoadComplete).toBe(true);
  });
});

// Mirrors the content-SWR behavior forgeIndex.ts wires into the sequence
// viewer (see its "Content SWR" block), extended to any bootstrapForgeViewer
// caller that opts in via `resolveContentId` — currently graph, openapi and
// embed.
describe('viewerBootstrap content SWR', () => {
  const CC_ID = 'cc-swr-1';
  const cachedDiagram = { ...NULL_DIAGRAM, diagramType: DiagramType.OpenApi, code: 'openapi: 3.0.0\ncached' };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    _resetContentCacheForTesting();
    store.state.diagram = { ...NULL_DIAGRAM };
    window.diagram = undefined;
  });

  it('a cache hit renders the cached doc without awaiting the fetch', async () => {
    putCachedContent(CC_ID, JSON.stringify(cachedDiagram));
    const loadDiagram = vi.fn(() => new Promise<typeof cachedDiagram>(() => {})); // never resolves

    await bootstrapForgeViewer({
      macroKind: 'openapi',
      content: Component,
      loadDiagram,
      resolveContentId: () => CC_ID,
    });

    // bootstrapForgeViewer resolved even though loadDiagram's promise never
    // will — proof the cache-hit render didn't await the fetch.
    expect(mountRoot).toHaveBeenCalledWith(cachedDiagram, Component, undefined);
    // toEqual, not toStrictEqual: the cached doc round-tripped through
    // JSON.stringify/parse (see putCachedContent above), which drops the
    // explicit `payload: undefined` key — a value-equivalent, not
    // shape-identical, result.
    expect(store.state.diagram).toEqual(cachedDiagram);
    expect(store.state.diagramLoadComplete).toBe(true);
    expect(loadDiagram).toHaveBeenCalledTimes(1); // the background revalidate fired...
    // ...but nothing awaited it on the critical path (no NULL_DIAGRAM shell mount).
    expect(mountRoot).toHaveBeenCalledTimes(1);
  });

  it('does not let the cache mask an invalid independent Board document', async () => {
    const cachedBoard = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Graph,
      graphXml: '<mxGraphModel><root /></mxGraphModel>',
      boardGraphXml: '<mxfile><diagram name="Board" /></mxfile>',
    };
    putCachedContent(CC_ID, JSON.stringify(cachedBoard));
    vi.mocked(putCachedContent).mockClear();
    mockForgeGlobal.forgeContext = {
      extension: { config: { customContentId: CC_ID } },
    };
    const invalidBoard = {
      ...cachedBoard,
      boardGraphXml: '',
    };

    await bootstrapForgeViewer({
      macroKind: 'graph',
      content: Component,
      contentProps: { graphEditorMode: 'board' },
      loadDiagram: vi.fn(async () => ({
        doc: invalidBoard,
        loadError: {
          errorClass: 'malformed' as const,
          errorCode: 'board_document_empty',
        },
      })),
      resolveContentId: () => CC_ID,
    });

    expect(getCachedContent).not.toHaveBeenCalled();
    expect(mountRoot).toHaveBeenCalledWith(
      NULL_DIAGRAM,
      Component,
      { graphEditorMode: 'board' },
    );
    expect(store.state.viewerLoadState).toBe('failed_with_source');
    expect(store.state.loadError).toMatchObject({
      errorClass: 'malformed',
      errorCode: 'board_document_empty',
    });
    expect(store.state.diagram.graphXml).toBe(cachedBoard.graphXml);
    expect(store.state.diagram.boardGraphXml).toBe('');
    expect(putCachedContent).not.toHaveBeenCalled();
  });

  it('background revalidate republishes when the fetched content hash changed', async () => {
    putCachedContent(CC_ID, JSON.stringify(cachedDiagram));
    const freshDiagram = { ...cachedDiagram, code: 'openapi: 3.0.0\nCHANGED' };
    const fetch = deferred<typeof freshDiagram>();
    const loadDiagram = vi.fn(() => fetch.promise);
    const afterLoad = vi.fn();

    await bootstrapForgeViewer({
      macroKind: 'openapi',
      content: Component,
      loadDiagram,
      afterLoad,
      resolveContentId: () => CC_ID,
    });
    expect(store.state.diagram).toEqual(cachedDiagram); // still the cached render — fetch hasn't landed

    fetch.resolve(freshDiagram);
    await flushMicrotasks();

    expect(store.state.diagram).toEqual(freshDiagram); // republished after the hash changed
    expect(window.diagram).toEqual(freshDiagram);
    expect(afterLoad).toHaveBeenCalledWith(freshDiagram);
    expect(putCachedContent).toHaveBeenCalledWith(CC_ID, JSON.stringify(freshDiagram));
  });

  it('background revalidate does not republish when the content is unchanged', async () => {
    putCachedContent(CC_ID, JSON.stringify(cachedDiagram));
    const loadDiagram = vi.fn(async () => ({ ...cachedDiagram })); // same content, new object identity
    const afterLoad = vi.fn();

    await bootstrapForgeViewer({
      macroKind: 'openapi',
      content: Component,
      loadDiagram,
      afterLoad,
      resolveContentId: () => CC_ID,
    });
    await flushMicrotasks();

    // Never remounted/republished for an unchanged hash — the cached render stands.
    expect(mountRoot).toHaveBeenCalledTimes(1);
    expect(store.state.diagram).toEqual(cachedDiagram);
    // Still ran the fetch and re-primed the cache (recency + self-heal), and
    // still fires afterLoad with the real fetch result once it lands.
    expect(afterLoad).toHaveBeenCalledWith({ ...cachedDiagram });
  });

  it('a revalidate failure leaves the cached render standing and does not throw', async () => {
    putCachedContent(CC_ID, JSON.stringify(cachedDiagram));
    const boom = new Error('custom content 500');
    const loadDiagram = vi.fn(async () => { throw boom; });
    const afterLoad = vi.fn();
    const onError = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await bootstrapForgeViewer({
      macroKind: 'openapi',
      content: Component,
      loadDiagram,
      afterLoad,
      onError,
      resolveContentId: () => CC_ID,
    });
    await flushMicrotasks();

    expect(store.state.diagram).toEqual(cachedDiagram); // unchanged
    expect(afterLoad).not.toHaveBeenCalled(); // no real result to report from
    expect(onError).not.toHaveBeenCalled(); // background failure, not the bootstrap's own error path
    expect(warnSpy).toHaveBeenCalledWith(
      '[content-swr] background revalidate failed; cached render stands',
      boom,
    );
    warnSpy.mockRestore();
  });

  it('never reads or writes the cache on the paywalled fullscreen path', async () => {
    vi.mocked(tryFullscreenViewerPaywall).mockResolvedValueOnce(true);
    putCachedContent(CC_ID, JSON.stringify(cachedDiagram)); // pre-existing entry, must be left alone
    vi.mocked(putCachedContent).mockClear(); // clear the priming call above
    const resolveContentId = vi.fn(() => CC_ID);
    const loaded = { ...NULL_DIAGRAM, diagramType: DiagramType.OpenApi, code: 'live' };

    await bootstrapForgeViewer({
      macroKind: 'openapi',
      content: Component,
      loadDiagram: vi.fn(async () => loaded),
      resolveContentId,
    });

    expect(resolveContentId).not.toHaveBeenCalled();
    expect(getCachedContent).not.toHaveBeenCalled();
    expect(putCachedContent).not.toHaveBeenCalled();
    expect(mountRoot).not.toHaveBeenCalled(); // paywall gate mounted its own shell
    expect(getCachedContent(CC_ID)?.doc).toBe(JSON.stringify(cachedDiagram)); // untouched
  });

  it('without a resolveContentId, never reads or writes the cache (today\'s behavior)', async () => {
    const loaded = { ...NULL_DIAGRAM, diagramType: DiagramType.Graph, graphXml: '<mxGraphModel/>' };

    await bootstrapForgeViewer({
      macroKind: 'graph',
      content: Component,
      loadDiagram: vi.fn(async () => loaded),
    });

    expect(getCachedContent).not.toHaveBeenCalled();
    expect(putCachedContent).not.toHaveBeenCalled();
    expect(mountRoot).toHaveBeenCalledWith(NULL_DIAGRAM, Component, undefined);
    expect(store.state.diagram).toStrictEqual(loaded);
  });

  it('afterLoad is not called on the cache-hit render — only once revalidate resolves', async () => {
    putCachedContent(CC_ID, JSON.stringify(cachedDiagram));
    const fetch = deferred<typeof cachedDiagram>();
    const loadDiagram = vi.fn(() => fetch.promise);
    const afterLoad = vi.fn();

    await bootstrapForgeViewer({
      macroKind: 'openapi',
      content: Component,
      loadDiagram,
      afterLoad,
      resolveContentId: () => CC_ID,
    });

    expect(afterLoad).not.toHaveBeenCalled(); // cache-hit render has no fresh `loaded` result yet

    fetch.resolve(cachedDiagram);
    await flushMicrotasks();

    expect(afterLoad).toHaveBeenCalledTimes(1);
    expect(afterLoad).toHaveBeenCalledWith(cachedDiagram);
  });

  it('marks content_source swr_cache on a hit, then fetch once revalidate finds changed content', async () => {
    putCachedContent(CC_ID, JSON.stringify(cachedDiagram));
    const freshDiagram = { ...cachedDiagram, code: 'CHANGED' };
    const fetch = deferred<typeof freshDiagram>();
    const loadDiagram = vi.fn(() => fetch.promise);

    await bootstrapForgeViewer({
      macroKind: 'openapi',
      content: Component,
      loadDiagram,
      resolveContentId: () => CC_ID,
    });
    expect(getTimings().content_source).toBe('swr_cache');

    fetch.resolve(freshDiagram);
    await flushMicrotasks();
    expect(getTimings().content_source).toBe('fetch'); // last-wins: overridden once the change is confirmed
  });

  it('marks content_source swr_cache on a hit and leaves it unchanged when revalidate finds no change', async () => {
    putCachedContent(CC_ID, JSON.stringify(cachedDiagram));
    const loadDiagram = vi.fn(async () => ({ ...cachedDiagram }));

    await bootstrapForgeViewer({
      macroKind: 'openapi',
      content: Component,
      loadDiagram,
      resolveContentId: () => CC_ID,
    });
    await flushMicrotasks();

    expect(getTimings().content_source).toBe('swr_cache');
  });

  it('marks content_source fetch on a plain cache miss', async () => {
    const loaded = { ...NULL_DIAGRAM, diagramType: DiagramType.OpenApi, code: 'live' };

    await bootstrapForgeViewer({
      macroKind: 'openapi',
      content: Component,
      loadDiagram: vi.fn(async () => loaded),
      resolveContentId: () => CC_ID,
    });

    expect(getTimings().content_source).toBe('fetch');
    expect(putCachedContent).toHaveBeenCalledWith(CC_ID, JSON.stringify(loaded));
  });

  it('a cache hit that fails to JSON.parse falls back to a live fetch instead of throwing', async () => {
    // Prime a corrupt entry directly through the mocked store.
    vi.mocked(getCachedContent).mockReturnValueOnce({ doc: '{not json', hash: 'whatever' });
    const loaded = { ...NULL_DIAGRAM, diagramType: DiagramType.OpenApi, code: 'live-after-corrupt-cache' };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await bootstrapForgeViewer({
      macroKind: 'openapi',
      content: Component,
      loadDiagram: vi.fn(async () => loaded),
      resolveContentId: () => CC_ID,
    });

    expect(mountRoot).toHaveBeenCalledWith(NULL_DIAGRAM, Component, undefined); // fell through to the normal shell
    expect(store.state.diagram).toStrictEqual(loaded);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
