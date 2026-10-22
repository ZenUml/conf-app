import { mount, enableAutoUnmount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Mermaid from '@/components/Mermaid.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import {
  trackAnalyticsEvent,
  trackAnalyticsEventBeforeUnload,
} from '@/utils/analytics/trackAnalyticsEvent';
import { _resetForTesting as resetRenderPerf } from '@/utils/analytics/renderPerf';
import { maybeGateViewerRender } from '@/utils/renderGate/maybeGateViewerRender';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
  trackAnalyticsEventBeforeUnload: vi.fn(() => Promise.resolve()),
}));

const isDisplayModeMock = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      isDisplayMode: isDisplayModeMock,
      initializeContext: vi.fn(() => Promise.resolve()),
    },
  },
}));

const loadMermaidMock = vi.hoisted(() => vi.fn());
vi.mock('@/utils/mermaid/loadMermaid', () => ({
  loadMermaid: loadMermaidMock,
}));

const panZoomInstanceMock = vi.hoisted(() => ({
  destroy: vi.fn(),
  disableDblClickZoom: vi.fn(),
  getPan: vi.fn(() => ({ x: 0, y: 0 })),
  getZoom: vi.fn(() => 1),
  pan: vi.fn(),
  reset: vi.fn(),
  resize: vi.fn(),
  zoom: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
}));
const svgPanZoomMock = vi.hoisted(() => vi.fn(() => panZoomInstanceMock));
vi.mock('svg-pan-zoom', () => ({ default: svgPanZoomMock }));

const hammerManagerMock = vi.hoisted(() => ({
  destroy: vi.fn(),
  get: vi.fn(() => ({ set: vi.fn() })),
  on: vi.fn(),
}));
vi.mock('hammerjs', () => ({ default: vi.fn(() => hammerManagerMock) }));

const awaitSvgTextLayoutMock = vi.hoisted(() =>
  vi.fn((_deps?: { signal?: AbortSignal }) => Promise.resolve(true)),
);
vi.mock('@/utils/renderGate/documentLayout', () => ({
  awaitSvgTextLayout: awaitSvgTextLayoutMock,
}));

const viewerLoadFailedCalls = () =>
  vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'viewer_load_failed');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

enableAutoUnmount(afterEach);

describe('Mermaid render-failure telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDisplayModeMock.mockReturnValue(true);
    window.__macroLoadStart = 0;
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: 'sequenceDiagram\nAlice->>Bob: hi',
    };
  });

  it('fires viewer_load_failed with failure_stage render_crash when mermaid.render() throws', async () => {
    loadMermaidMock.mockResolvedValue({
      render: vi.fn(() => Promise.reject(new Error('mermaid boom'))),
    });

    mount(Mermaid, { global: { plugins: [store] } });
    // mounted() is async: loadMermaid() -> mermaid.render() -> catch, all awaited.
    await vi.waitFor(() => {
      expect(viewerLoadFailedCalls()).toHaveLength(1);
    });

    const [, props] = viewerLoadFailedCalls()[0];
    expect(props).toMatchObject({
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: 'mermaid',
      failure_stage: 'render_crash',
      failure_reason: 'mermaid boom',
    });
    expect(vi.mocked(trackAnalyticsEvent).mock.calls.some(([name]) => name === 'macro_viewed')).toBe(false);
  });

  it.each([
    ['authored', 'graph TD\nA-->B', 'authored'],
    ['bundled example', 'sequenceDiagram\n    Alice->>John: Hello John, how are you?\n    John-->>Alice: Great!\n    Alice-)John: See you later!\n', 'default'],
  ])('macro_viewed carries content_state for a %s body (#113)', async (_label, code, expected) => {
    loadMermaidMock.mockResolvedValue({
      render: vi.fn(() => Promise.resolve({ svg: '<svg>ok</svg>' })),
    });
    store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.Mermaid, mermaidCode: code };

    mount(Mermaid, { global: { plugins: [store] } });

    await vi.waitFor(() => {
      expect(vi.mocked(trackAnalyticsEvent).mock.calls.some(([name]) => name === 'macro_viewed')).toBe(true);
    });
    const [, props] = vi.mocked(trackAnalyticsEvent).mock.calls.find(([name]) => name === 'macro_viewed')!;
    expect(props).toMatchObject({ macro_type: 'mermaid', content_state: expected });
  });

  // #113: an empty body is the wipe signal, so the empty branch of mounted()
  // still reports the view, with the verdict and without attempting a render.
  it.each([
    ['empty string', ''],
    ['whitespace only', '  \n\t '],
  ])('emits one macro_viewed with content_state=empty for a loaded %s body and does not render (#113)', async (_label, code) => {
    const render = vi.fn(() => Promise.resolve({ svg: '<svg>ok</svg>' }));
    loadMermaidMock.mockResolvedValue({ render });
    store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.Mermaid, mermaidCode: code };

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const viewed = vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'macro_viewed');
    expect(viewed).toHaveLength(1);
    expect(viewed[0][1]).toMatchObject({ macro_type: 'mermaid', content_state: 'empty' });
    expect(render).not.toHaveBeenCalled();
    expect(vi.mocked(trackAnalyticsEvent).mock.calls.some(([name]) => name === 'viewer_load_failed')).toBe(false);
  });

  // A shell that never loaded has an empty body because nothing was read, not
  // because anyone wiped it: no event, never `empty`.
  it.each([
    ['NULL_DIAGRAM shell', { ...NULL_DIAGRAM }],
    ['load error', { ...NULL_DIAGRAM, diagramType: DiagramType.Mermaid, mermaidCode: '', loadError: { errorClass: 'http', errorCode: 'x', terminal: true } }],
    ['legacy load blocked', { ...NULL_DIAGRAM, diagramType: DiagramType.Mermaid, mermaidCode: '', legacyLoadBlocked: true }],
  ])('emits no macro_viewed for an empty body when the doc never loaded: %s (#113)', async (_label, diagram) => {
    loadMermaidMock.mockResolvedValue({ render: vi.fn(() => Promise.resolve({ svg: '<svg>ok</svg>' })) });
    store.state.diagram = diagram as typeof store.state.diagram;

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(vi.mocked(trackAnalyticsEvent).mock.calls.some(([name]) => name === 'macro_viewed')).toBe(false);
  });

  it('does not fire viewer_load_failed on a clean render', async () => {
    loadMermaidMock.mockResolvedValue({
      render: vi.fn(() => Promise.resolve({ svg: '<svg>ok</svg>' })),
    });

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });
    await wrapper.vm.$nextTick();
    await vi.waitFor(() => {
      expect(wrapper.vm.svg).toBeTruthy();
    });

    expect(viewerLoadFailedCalls()).toHaveLength(0);
  });

  // `mermaid.render()` on a body with no diagram text throws
  // `No diagram type detected matching given configuration for text: `. An
  // empty string is already skipped, but a whitespace-only body (blank lines,
  // or only U+00A0 pasted in) is truthy, so it reached mermaid and every view
  // of that macro fired viewer_load_failed (84 events in 7 days, one tenant).
  it.each([
    ['blank lines', '\n\n  \n'],
    ['non-breaking spaces', '\u00a0\u00a0\n\u00a0'],
  ])('does not call mermaid or report a crash for a %s-only body', async (_label, code) => {
    const render = vi.fn(() => Promise.reject(new Error('No diagram type detected matching given configuration for text: ')));
    loadMermaidMock.mockResolvedValue({ render });
    store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.Mermaid, mermaidCode: code };

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(render).not.toHaveBeenCalled();
    expect(viewerLoadFailedCalls()).toHaveLength(0);
    expect(wrapper.text()).toContain('Start with Mermaid');
  });

  // The isDisplayMode=false (editor-preview) gate itself is unit-tested in
  // trackViewerRenderCrash.spec.ts — the shared Vuex store singleton here
  // memoizes the `isDisplayMode` getter on first read (it has no reactive
  // state dependency), so toggling the mock mid-file doesn't exercise a real
  // code path at this level.
});

// `mermaid.render()` measures a temp node with getBBox. In a document with no
// layout box (a `display: none` iframe) that measurement throws
// `svg element not in render tree` — reproduced against mermaid 11.12.2 in
// Chrome, see utils/renderGate/documentLayout.ts. 30 such events on
// 2026-08-10, 0.43% of Chrome mermaid renders, each one a permanently blank
// diagram because the catch left `svg` null with nothing to re-trigger it.
describe('Mermaid render retry when the document has no layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDisplayModeMock.mockReturnValue(true);
    awaitSvgTextLayoutMock.mockResolvedValue(true);
    window.__macroLoadStart = 0;
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: 'sequenceDiagram\nAlice->>Bob: hi',
    };
  });

  it('renders on the second attempt once the document gains a layout box', async () => {
    const render = vi
      .fn()
      .mockRejectedValueOnce(new Error('svg element not in render tree'))
      .mockResolvedValueOnce({ svg: '<svg>late</svg>' });
    loadMermaidMock.mockResolvedValue({ render });

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });
    await vi.waitFor(() => {
      expect(wrapper.vm.svg).toBe('<svg>late</svg>');
    });

    expect(render).toHaveBeenCalledTimes(2);
    // The viewer recovered, so no failure reached the user and none is reported.
    expect(viewerLoadFailedCalls()).toHaveLength(0);
  });

  it('reports the failure when the retry also fails after SVG text becomes measurable', async () => {
    const render = vi.fn(() => Promise.reject(new Error('svg element not in render tree')));
    loadMermaidMock.mockResolvedValue({ render });

    mount(Mermaid, { global: { plugins: [store] } });
    await vi.waitFor(() => {
      expect(viewerLoadFailedCalls()).toHaveLength(1);
    });

    expect(render).toHaveBeenCalledTimes(2);
    const [, props] = viewerLoadFailedCalls()[0];
    expect(props).toMatchObject({
      failure_stage: 'render_crash',
      failure_reason: 'svg element not in render tree',
    });
  });

  it('does not retry a deterministic parser failure', async () => {
    const render = vi.fn(() => Promise.reject(new Error('Parse error on line 2')));
    loadMermaidMock.mockResolvedValue({ render });

    mount(Mermaid, { global: { plugins: [store] } });
    await vi.waitFor(() => {
      expect(viewerLoadFailedCalls()).toHaveLength(1);
    });

    // A syntax error is deterministic; retrying it only doubles the work.
    expect(render).toHaveBeenCalledTimes(1);
    expect(awaitSvgTextLayoutMock).not.toHaveBeenCalled();
  });

  it('retries the transient detached-SVG failure even when the body has layout', async () => {
    const render = vi
      .fn()
      .mockRejectedValueOnce(new Error('svg element not in render tree'))
      .mockResolvedValueOnce({ svg: '<svg>recovered</svg>' });
    loadMermaidMock.mockResolvedValue({ render });

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });
    await vi.waitFor(() => {
      expect(wrapper.vm.svg).toBe('<svg>recovered</svg>');
    });

    expect(render).toHaveBeenCalledTimes(2);
    expect(viewerLoadFailedCalls()).toHaveLength(0);
  });

  it('does not force a retry while a long-hidden iframe still cannot measure SVG text', async () => {
    const layoutReady = deferred<boolean>();
    awaitSvgTextLayoutMock.mockReturnValueOnce(layoutReady.promise);
    const render = vi
      .fn()
      .mockRejectedValueOnce(new Error('svg element not in render tree'))
      .mockResolvedValueOnce({ svg: '<svg>late</svg>' });
    loadMermaidMock.mockResolvedValue({ render });

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });
    await vi.waitFor(() => expect(awaitSvgTextLayoutMock).toHaveBeenCalledTimes(1));

    // PR #691 retried after a fixed 10-second wait even when the iframe was
    // still hidden. The replacement wait remains pending, so no false failure
    // is emitted and no doomed second render starts.
    expect(render).toHaveBeenCalledTimes(1);
    expect(viewerLoadFailedCalls()).toHaveLength(0);

    layoutReady.resolve(true);
    await vi.waitFor(() => expect(wrapper.vm.svg).toBe('<svg>late</svg>'));
    expect(render).toHaveBeenCalledTimes(2);
    expect(viewerLoadFailedCalls()).toHaveLength(0);
  });

  it('cancels a hidden-iframe wait on unmount without retrying or reporting a failure', async () => {
    awaitSvgTextLayoutMock.mockImplementationOnce(({ signal } = {}) =>
      new Promise<boolean>((resolve) => {
        signal?.addEventListener('abort', () => resolve(false), { once: true });
      }),
    );
    const render = vi.fn(() => Promise.reject(new Error('svg element not in render tree')));
    loadMermaidMock.mockResolvedValue({ render });

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });
    await vi.waitFor(() => expect(awaitSvgTextLayoutMock).toHaveBeenCalledTimes(1));
    wrapper.unmount();
    await Promise.resolve();
    await Promise.resolve();

    expect(render).toHaveBeenCalledTimes(1);
    expect(viewerLoadFailedCalls()).toHaveLength(0);
  });

  it('retries a transient non-invertible SVG matrix failure once', async () => {
    const render = vi
      .fn()
      .mockRejectedValueOnce(new Error('The matrix is not invertible.'))
      .mockResolvedValueOnce({ svg: '<svg>recovered</svg>' });
    loadMermaidMock.mockResolvedValue({ render });

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });
    await vi.waitFor(() => expect(wrapper.vm.svg).toBe('<svg>recovered</svg>'));

    expect(render).toHaveBeenCalledTimes(2);
    expect(viewerLoadFailedCalls()).toHaveLength(0);
  });
});

// #706: since PR #695 the viewer waits with no deadline for a measurable SVG text
// layout, and said nothing while it waited. A hidden macro and a silently broken
// one were the same row in Mixpanel. The wait itself must not change.
describe('Mermaid hidden-layout wait telemetry', () => {
  const transient = () => new Error('svg element not in render tree');
  const eventsNamed = (name: string) =>
    vi.mocked(trackAnalyticsEvent).mock.calls.filter(([n]) => n === name);
  const abandonedCalls = () =>
    vi.mocked(trackAnalyticsEventBeforeUnload).mock.calls.filter(
      ([n]) => n === 'viewer_render_abandoned',
    );
  const flush = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    resetRenderPerf();
    isDisplayModeMock.mockReturnValue(true);
    awaitSvgTextLayoutMock.mockResolvedValue(true);
    window.__macroLoadStart = 0;
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: 'sequenceDiagram\nAlice->>Bob: hi',
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits viewer_render_deferred exactly once when the wait passes 10 seconds', async () => {
    awaitSvgTextLayoutMock.mockReturnValueOnce(deferred<boolean>().promise);
    loadMermaidMock.mockResolvedValue({ render: vi.fn(() => Promise.reject(transient())) });

    mount(Mermaid, { global: { plugins: [store] } });
    await flush();
    expect(awaitSvgTextLayoutMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(eventsNamed('viewer_render_deferred')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(eventsNamed('viewer_render_deferred')).toHaveLength(1);
    expect(eventsNamed('viewer_render_deferred')[0][1]).toMatchObject({
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: 'mermaid',
      reason: 'no_layout',
      waited_ms: 10_000,
    });

    // One event per wait, not one per interval.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(eventsNamed('viewer_render_deferred')).toHaveLength(1);
    expect(viewerLoadFailedCalls()).toHaveLength(0);
  });

  it('adds nothing on the fast path where the layout is ready at once', async () => {
    const render = vi
      .fn()
      .mockRejectedValueOnce(transient())
      .mockResolvedValueOnce({ svg: '<svg>ok</svg>' });
    loadMermaidMock.mockResolvedValue({ render });

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });
    await flush();
    expect(wrapper.vm.svg).toBe('<svg>ok</svg>');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(eventsNamed('viewer_render_deferred')).toHaveLength(0);
    expect(abandonedCalls()).toHaveLength(0);
  });

  it('emits viewer_render_abandoned once, with waited_ms, when the wait is cancelled', async () => {
    awaitSvgTextLayoutMock.mockImplementationOnce(({ signal } = {}) =>
      new Promise<boolean>((resolve) => {
        signal?.addEventListener('abort', () => resolve(false), { once: true });
      }),
    );
    const render = vi.fn(() => Promise.reject(transient()));
    loadMermaidMock.mockResolvedValue({ render });

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });
    await flush();
    await vi.advanceTimersByTimeAsync(12_000);
    wrapper.unmount();
    await flush();

    expect(abandonedCalls()).toHaveLength(1);
    expect(abandonedCalls()[0][1]).toMatchObject({
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: 'mermaid',
      reason: 'no_layout',
      waited_ms: 12_000,
    });
    // The cancel is neither a retry nor a failure, and the heartbeat is gone.
    expect(render).toHaveBeenCalledTimes(1);
    expect(viewerLoadFailedCalls()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(eventsNamed('viewer_render_deferred')).toHaveLength(1);
    expect(abandonedCalls()).toHaveLength(1);
  });

  it('carries layout_wait_ms on macro_viewed when the layout appears late', async () => {
    const layoutReady = deferred<boolean>();
    awaitSvgTextLayoutMock.mockReturnValueOnce(layoutReady.promise);
    const render = vi
      .fn()
      .mockRejectedValueOnce(transient())
      .mockResolvedValueOnce({ svg: '<svg>late</svg>' });
    loadMermaidMock.mockResolvedValue({ render });

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });
    await flush();
    await vi.advanceTimersByTimeAsync(15_000);
    layoutReady.resolve(true);
    await flush();

    expect(wrapper.vm.svg).toBe('<svg>late</svg>');
    const viewed = eventsNamed('macro_viewed');
    expect(viewed).toHaveLength(1);
    expect(viewed[0][1]).toMatchObject({ macro_type: 'mermaid', layout_wait_ms: 15_000 });
    expect(eventsNamed('viewer_render_deferred')).toHaveLength(1);
    expect(abandonedCalls()).toHaveLength(0);
  });

  it('leaves layout_wait_ms off macro_viewed when no wait happened', async () => {
    loadMermaidMock.mockResolvedValue({ render: vi.fn(() => Promise.resolve({ svg: '<svg>ok</svg>' })) });

    mount(Mermaid, { global: { plugins: [store] } });
    await flush();

    const viewed = eventsNamed('macro_viewed');
    expect(viewed).toHaveLength(1);
    expect(viewed[0][1]).not.toHaveProperty('layout_wait_ms', expect.anything());
  });

  it('keeps reporting a retry failure as viewer_load_failed, not as abandoned', async () => {
    const layoutReady = deferred<boolean>();
    awaitSvgTextLayoutMock.mockReturnValueOnce(layoutReady.promise);
    loadMermaidMock.mockResolvedValue({ render: vi.fn(() => Promise.reject(transient())) });

    mount(Mermaid, { global: { plugins: [store] } });
    await flush();
    await vi.advanceTimersByTimeAsync(11_000);
    layoutReady.resolve(true);
    await flush();

    expect(viewerLoadFailedCalls()).toHaveLength(1);
    expect(abandonedCalls()).toHaveLength(0);
    expect(eventsNamed('macro_viewed')).toHaveLength(0);
  });

  it('copies render_gate and visible_at_boot onto the heartbeat when the viewport gate recorded them', async () => {
    await maybeGateViewerRender({
      awaitTurn: () => Promise.resolve({ outcome: 'background', deferredMs: 0, visibleAtBoot: false }),
    });
    awaitSvgTextLayoutMock.mockReturnValueOnce(deferred<boolean>().promise);
    loadMermaidMock.mockResolvedValue({ render: vi.fn(() => Promise.reject(transient())) });

    mount(Mermaid, { global: { plugins: [store] } });
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(eventsNamed('viewer_render_deferred')[0][1]).toMatchObject({
      render_gate: 'background',
      visible_at_boot: false,
    });
  });

  it('does not wait, or add wait telemetry, for a deterministic parser failure', async () => {
    loadMermaidMock.mockResolvedValue({ render: vi.fn(() => Promise.reject(new Error('Parse error on line 2'))) });

    mount(Mermaid, { global: { plugins: [store] } });
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(viewerLoadFailedCalls()).toHaveLength(1);
    expect(awaitSvgTextLayoutMock).not.toHaveBeenCalled();
    expect(eventsNamed('viewer_render_deferred')).toHaveLength(0);
    expect(abandonedCalls()).toHaveLength(0);
  });
});

describe('Mermaid overlapping renders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDisplayModeMock.mockReturnValue(true);
    awaitSvgTextLayoutMock.mockResolvedValue(true);
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: '',
    };
  });

  it('does not let an older failed render remove the newer render temporary SVG', async () => {
    const first = deferred<{ svg: string }>();
    const second = deferred<{ svg: string }>();
    const render = vi.fn((id: string) => {
      const temp = document.createElement('div');
      temp.id = `d${id}`;
      document.body.append(temp);
      return render.mock.calls.length === 1 ? first.promise : second.promise;
    });
    loadMermaidMock.mockResolvedValue({ render });

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });
    const firstResult = wrapper.vm.render('flowchart LR\nA-->B');
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    const secondResult = wrapper.vm.render('flowchart LR\nA-->C');
    await Promise.resolve();
    // The newer request stays queued until the older request, including its
    // ID-scoped cleanup, has completely finished.
    expect(render).toHaveBeenCalledTimes(1);

    first.reject(new Error('older render failed'));
    await firstResult;
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    const secondId = render.mock.calls[1][0];

    if (!document.getElementById(`d${secondId}`)) {
      second.reject(new Error('svg element not in render tree'));
    } else {
      second.resolve({ svg: '<svg>newer</svg>' });
    }

    await expect(secondResult).resolves.toBe('<svg>newer</svg>');
    expect(viewerLoadFailedCalls()).toHaveLength(1);
    expect(viewerLoadFailedCalls()[0][1]).toMatchObject({
      failure_reason: 'older render failed',
    });
  });

  it('applies only the newest result when source changes while a render is queued', async () => {
    const first = deferred<{ svg: string }>();
    const second = deferred<{ svg: string }>();
    const render = vi.fn((_id: string, source: string) =>
      source.includes('A-->B') ? first.promise : second.promise);
    loadMermaidMock.mockResolvedValue({ render });
    const wrapper = mount(Mermaid, { global: { plugins: [store] } });

    store.state.diagram.mermaidCode = 'flowchart LR\nA-->B';
    await wrapper.vm.$nextTick();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));

    store.state.diagram.mermaidCode = 'flowchart LR\nA-->C';
    await wrapper.vm.$nextTick();
    first.resolve({ svg: '<svg>stale</svg>' });
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    expect(wrapper.vm.svg).not.toBe('<svg>stale</svg>');

    second.resolve({ svg: '<svg>current</svg>' });
    await vi.waitFor(() => expect(wrapper.vm.svg).toBe('<svg>current</svg>'));
  });
});

describe('Mermaid pasted-whitespace normalisation', () => {
  const NBSP = '\u00A0';

  beforeEach(() => {
    vi.clearAllMocks();
    isDisplayModeMock.mockReturnValue(true);
    awaitSvgTextLayoutMock.mockResolvedValue(true);
    window.__macroLoadStart = 0;
  });

  // Rich-text paste turns indentation into U+00A0, which mermaid's Langium
  // grammars reject outright. The stored body keeps the character, so the fix
  // has to apply at render time or the diagram stays blank forever.
  it('renders stored content whose indentation is NBSP', async () => {
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: `pie title Pets\n${NBSP}${NBSP}"Dogs" : 386`,
    };
    const render = vi.fn((_id: string, _code: string) => Promise.resolve({ svg: '<svg />' }));
    loadMermaidMock.mockResolvedValue({ render });

    mount(Mermaid, { global: { plugins: [store] } });
    await vi.waitFor(() => {
      expect(render.mock.calls.length).toBeGreaterThan(0);
    });

    // Every call, not just the first: the watcher re-renders on its own and
    // each pass must see normalised source.
    for (const [, code] of render.mock.calls) {
      expect(code).toBe('pie title Pets\n  "Dogs" : 386');
    }
    expect(viewerLoadFailedCalls()).toHaveLength(0);
  });

  it('passes clean content through untouched', async () => {
    const clean = 'sequenceDiagram\n  Alice->>Bob: hi';
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: clean,
    };
    const render = vi.fn((_id: string, _code: string) => Promise.resolve({ svg: '<svg />' }));
    loadMermaidMock.mockResolvedValue({ render });

    mount(Mermaid, { global: { plugins: [store] } });
    await vi.waitFor(() => {
      expect(render.mock.calls.length).toBeGreaterThan(0);
    });

    for (const [, code] of render.mock.calls) {
      expect(code).toBe(clean);
    }
  });
});

describe('Mermaid fullscreen viewport controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    awaitSvgTextLayoutMock.mockResolvedValue(true);
    window.__macroLoadStart = 0;
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: 'flowchart LR\n  A --> B',
    };
    loadMermaidMock.mockResolvedValue({
      render: vi.fn(() => Promise.resolve({
        svg: '<svg viewBox="0 0 400 200"><g><text>Diagram</text></g></svg>',
      })),
    });
  });

  afterEach(() => {
    delete window.forgeGlobal;
  });

  it('shows zoom controls in the fullscreen viewer', async () => {
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 400, height: 200,
    } as DOMRect);
    window.forgeGlobal = {
      forgeContext: { extension: { modal: { macroMode: 'fullscreen' } } },
    } as any;

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });

    await vi.waitFor(() => {
      expect(wrapper.find('[aria-label="Reset view"]').exists()).toBe(false);
      expect(wrapper.get('[aria-label="Zoom out"]').exists()).toBe(true);
      expect(wrapper.get('[aria-label="Zoom in"]').exists()).toBe(true);
      expect(svgPanZoomMock).toHaveBeenCalled();
    });

    const zoomOutCalls = panZoomInstanceMock.zoomOut.mock.calls.length;
    const zoomInCalls = panZoomInstanceMock.zoomIn.mock.calls.length;
    await wrapper.get('[aria-label="Zoom out"]').trigger('click');
    await wrapper.get('[aria-label="Zoom in"]').trigger('click');
    expect(panZoomInstanceMock.zoomOut).toHaveBeenCalledTimes(zoomOutCalls + 1);
    expect(panZoomInstanceMock.zoomIn).toHaveBeenCalledTimes(zoomInCalls + 1);
    expect(panZoomInstanceMock.reset).toHaveBeenCalled();
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('viewport_control_used', {
      feature_area: 'macro',
      surface: 'fullscreen',
      macro_type: 'mermaid',
      viewport_action: 'zoom_in',
      viewport_input: 'toolbar',
    });
  });

  it('adds viewport controls to an inline diagram without fullscreen sizing', async () => {
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 400, height: 200,
    } as DOMRect);
    window.forgeGlobal = { forgeContext: { extension: {} } } as any;

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });

    await vi.waitFor(() => {
      expect(wrapper.find('svg').exists()).toBe(true);
      expect(svgPanZoomMock).toHaveBeenCalled();
    });
    expect(wrapper.find('[aria-label="Zoom in"]').exists()).toBe(true);
    expect(wrapper.get('.diagram-viewport').classes()).toContain('diagram-viewport--interactive');
    expect(wrapper.get('.diagram-viewport').classes()).not.toContain('diagram-viewport--fullscreen');
  });

  it('preserves the natural Mermaid height for the inline pan/zoom viewport', async () => {
    window.forgeGlobal = { forgeContext: { extension: {} } } as any;
    const rectSpy = vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 400,
      height: 200,
      top: 0,
      right: 400,
      bottom: 200,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const computedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      maxWidth: '400px',
    } as CSSStyleDeclaration);
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });

    await vi.waitFor(() => expect(svgPanZoomMock).toHaveBeenCalled());
    expect(wrapper.get('.diagram-viewport').attributes('style')).toContain('height: 200px');

    clientWidthSpy.mockReturnValue(300);
    wrapper.vm.$refs.viewport.syncInlineHeight();
    expect(wrapper.get('.diagram-viewport').attributes('style')).toContain('height: 150px');

    rectSpy.mockRestore();
    computedStyleSpy.mockRestore();
    clientWidthSpy.mockRestore();
  });

  it('does not add viewport controls to the export-only render surface', async () => {
    window.forgeGlobal = {
      forgeContext: { extension: { modal: { macroMode: 'fullscreen', openExport: true } } },
    } as any;

    const wrapper = mount(Mermaid, { global: { plugins: [store] } });

    await vi.waitFor(() => expect(wrapper.find('svg').exists()).toBe(true));
    expect(wrapper.find('[aria-label="Zoom in"]').exists()).toBe(false);
  });
});
