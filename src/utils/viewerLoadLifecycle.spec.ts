import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagramType, NULL_DIAGRAM, type Diagram } from '@/model/Diagram/Diagram';
import store from '@/model/store2';
import {
  _resetForTesting as resetContentCache,
  getCachedContent,
  putCachedContent,
  type ViewerContentIdentity,
} from '@/utils/renderCache/contentCacheStore';
import { trackViewerLoadOutcome } from '@/utils/analytics/trackRenderTime';
import {
  runViewerLoadLifecycle,
  type ViewerContentAdapter,
  type ViewerLoadLifecycleOptions,
} from '@/utils/viewerLoadLifecycle';

vi.mock('@/utils/analytics/trackRenderTime', () => ({
  trackViewerLoadOutcome: vi.fn(),
}));

const IDENTITY: ViewerContentIdentity = {
  cloudId: 'cloud-a',
  customContentId: 'cc-1',
  macroKind: 'graph',
};
const CACHED: Diagram = {
  ...NULL_DIAGRAM,
  diagramType: DiagramType.Graph,
  graphXml: '<mxGraphModel id="cached"/>',
};
const FRESH: Diagram = {
  ...CACHED,
  graphXml: '<mxGraphModel id="fresh"/>',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushBackgroundWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function options(
  adapter: ViewerContentAdapter<{ cloudId: string }, string>,
  overrides: Partial<ViewerLoadLifecycleOptions<{ cloudId: string }, string>> = {},
): ViewerLoadLifecycleOptions<{ cloudId: string }, string> {
  return {
    macroType: 'graph',
    getContext: vi.fn(async () => ({ cloudId: 'cloud-a' })),
    adapter,
    mount: vi.fn(),
    ...overrides,
  };
}

function loadableAdapter(load: () => Promise<Diagram | undefined>) {
  return {
    resolve: vi.fn(async () => ({
      status: 'loadable' as const,
      target: 'cc-1',
      cacheIdentity: IDENTITY,
    })),
    load: vi.fn(load),
  };
}

describe('viewerLoadLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetContentCache();
    store.state.diagram = { ...NULL_DIAGRAM };
    window.diagram = undefined;
  });

  it('resolves context and target once, then publishes one fetch revision', async () => {
    const adapter = loadableAdapter(async () => FRESH);
    const lifecycleOptions = options(adapter, { loadingDocument: NULL_DIAGRAM });

    const session = await runViewerLoadLifecycle(lifecycleOptions);

    expect(lifecycleOptions.getContext).toHaveBeenCalledOnce();
    expect(adapter.resolve).toHaveBeenCalledOnce();
    expect(adapter.load).toHaveBeenCalledOnce();
    expect(lifecycleOptions.mount).toHaveBeenCalledOnce();
    expect(lifecycleOptions.mount).toHaveBeenCalledWith(NULL_DIAGRAM, session.reporter);
    expect(store.state.diagram).toEqual(FRESH);
    expect(window.diagram).toEqual(FRESH);
    expect(session.state).toEqual({ status: 'rendering', revision: 1, source: 'fetch' });

    session.reporter.rendered(1);
    session.reporter.rendered(1);

    expect(session.state).toEqual({ status: 'rendered', revision: 1, source: 'fetch' });
    expect(trackViewerLoadOutcome).toHaveBeenCalledOnce();
    expect(trackViewerLoadOutcome).toHaveBeenCalledWith('graph', true, {
      outcome: 'rendered',
      contentSource: 'fetch',
    });
  });

  it('starts revalidation before a synchronous cache render and attributes it to swr_cache', async () => {
    putCachedContent(IDENTITY, JSON.stringify(CACHED));
    const order: string[] = [];
    const never = deferred<Diagram | undefined>();
    const adapter = loadableAdapter(() => {
      order.push('revalidate');
      return never.promise;
    });

    const session = await runViewerLoadLifecycle(options(adapter, {
      mount: vi.fn((_doc, reporter) => {
        order.push('mount');
        reporter.rendered(reporter.captureRevision());
      }),
    }));

    expect(order).toEqual(['revalidate', 'mount']);
    expect(session.state).toEqual({ status: 'rendered', revision: 1, source: 'swr_cache' });
    expect(trackViewerLoadOutcome).toHaveBeenCalledWith('graph', true, {
      outcome: 'rendered',
      contentSource: 'swr_cache',
    });
  });

  it('publishes changed revalidation as a new revision and ignores the stale callback', async () => {
    putCachedContent(IDENTITY, JSON.stringify(CACHED));
    const fresh = deferred<Diagram | undefined>();
    const session = await runViewerLoadLifecycle(options(loadableAdapter(() => fresh.promise)));

    expect(session.reporter.captureRevision()).toBe(1);
    fresh.resolve(FRESH);
    await flushBackgroundWork();

    expect(session.state).toEqual({ status: 'rendering', revision: 2, source: 'fetch' });
    expect(store.state.diagram).toEqual(FRESH);
    session.reporter.rendered(1);
    expect(trackViewerLoadOutcome).not.toHaveBeenCalled();
    session.reporter.rendered(2);
    expect(trackViewerLoadOutcome).toHaveBeenCalledOnce();
    expect(trackViewerLoadOutcome).toHaveBeenCalledWith('graph', true, {
      outcome: 'rendered',
      contentSource: 'fetch',
    });
  });

  it('never emits a second terminal event when changed revalidation renders later', async () => {
    putCachedContent(IDENTITY, JSON.stringify(CACHED));
    const fresh = deferred<Diagram | undefined>();
    const session = await runViewerLoadLifecycle(options(loadableAdapter(() => fresh.promise)));
    session.reporter.rendered(1);

    fresh.resolve(FRESH);
    await flushBackgroundWork();
    session.reporter.rendered(2);

    expect(session.state).toEqual({ status: 'rendered', revision: 2, source: 'fetch' });
    expect(trackViewerLoadOutcome).toHaveBeenCalledOnce();
    expect(trackViewerLoadOutcome).toHaveBeenCalledWith('graph', true, {
      outcome: 'rendered',
      contentSource: 'swr_cache',
    });
  });

  it('evicts corrupt cache data and falls through to the source-of-truth fetch', async () => {
    putCachedContent(IDENTITY, '{not-json');
    const adapter = loadableAdapter(async () => FRESH);

    const session = await runViewerLoadLifecycle(options(adapter));

    expect(adapter.load).toHaveBeenCalledOnce();
    expect(session.state).toEqual({ status: 'rendering', revision: 1, source: 'fetch' });
    expect(getCachedContent(IDENTITY)?.doc).toBe(JSON.stringify(FRESH));
  });

  it('classifies an empty fetch as a terminal empty outcome', async () => {
    const session = await runViewerLoadLifecycle(options(loadableAdapter(async () => undefined)));

    expect(session.state).toEqual({ status: 'empty', reason: 'content_not_found' });
    expect(trackViewerLoadOutcome).toHaveBeenCalledWith('graph', true, { outcome: 'empty' });
  });

  it('classifies a thrown fetch as failed and does not remain loading', async () => {
    const error = new Error('custom content unavailable');
    const onError = vi.fn();
    const session = await runViewerLoadLifecycle(options(
      loadableAdapter(async () => { throw error; }),
      { onError },
    ));

    expect(session.state).toEqual({ status: 'failed', reason: 'content_load' });
    expect(onError).toHaveBeenCalledWith(error, 'content_load');
    expect(trackViewerLoadOutcome).toHaveBeenCalledWith('graph', true, { outcome: 'failed' });
  });

  it('makes a loading-shell mount failure terminal instead of fetching into an unmounted app', async () => {
    const adapter = loadableAdapter(async () => FRESH);
    const mountError = new Error('Vue root mount failed');
    const session = await runViewerLoadLifecycle(options(adapter, {
      loadingDocument: NULL_DIAGRAM,
      mount: vi.fn(() => { throw mountError; }),
    }));

    expect(adapter.load).not.toHaveBeenCalled();
    expect(session.state).toEqual({ status: 'failed', reason: 'render' });
    expect(trackViewerLoadOutcome).toHaveBeenCalledWith('graph', true, { outcome: 'failed' });
  });

  it('treats cache serialization as best effort and still publishes the fetched document', async () => {
    const cyclic = { ...FRESH } as Diagram & { metadata: Record<string, unknown> };
    cyclic.metadata = { cyclic };

    const session = await runViewerLoadLifecycle(options(loadableAdapter(async () => cyclic)));

    expect(session.state).toEqual({ status: 'rendering', revision: 1, source: 'fetch' });
    expect(store.state.diagram.graphXml).toBe(cyclic.graphXml);
    expect(store.state.diagram.metadata).toBeDefined();
    expect(getCachedContent(IDENTITY)).toBeUndefined();
  });

  it('waits for revalidation before making a cached render failure terminal', async () => {
    putCachedContent(IDENTITY, JSON.stringify(CACHED));
    const fresh = deferred<Diagram | undefined>();
    const session = await runViewerLoadLifecycle(options(loadableAdapter(() => fresh.promise)));

    session.reporter.failed(1, new Error('cached graph failed'));
    expect(session.state).toEqual({ status: 'rendering', revision: 1, source: 'swr_cache' });
    expect(trackViewerLoadOutcome).not.toHaveBeenCalled();

    fresh.reject(new Error('revalidate failed'));
    await flushBackgroundWork();

    expect(session.state).toEqual({ status: 'failed', reason: 'render' });
    expect(trackViewerLoadOutcome).toHaveBeenCalledWith('graph', true, {
      outcome: 'failed',
      contentSource: 'swr_cache',
    });
  });

  it('keeps a successfully rendered cached document rendered after revalidation failure', async () => {
    putCachedContent(IDENTITY, JSON.stringify(CACHED));
    const fresh = deferred<Diagram | undefined>();
    const session = await runViewerLoadLifecycle(options(loadableAdapter(() => fresh.promise)));
    session.reporter.rendered(1);

    fresh.reject(new Error('revalidate failed'));
    await flushBackgroundWork();

    expect(session.state).toEqual({ status: 'rendered', revision: 1, source: 'swr_cache' });
    expect(trackViewerLoadOutcome).toHaveBeenCalledOnce();
  });
});
