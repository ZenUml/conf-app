import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }));
import { callRemote } from '@/utils/requestUtil';
import { createEditorIconLoader } from './editorExternalIcons';

const ICON = 'https://icons.diagrams.net/assets/azure/1/Azure_Service_Bus_Queues.svg';
const ICON_B = 'https://icons.diagrams.net/assets/azure/1/Azure_Storage.svg';
const DATA = 'data:image/svg+xml;base64,PHN2Zy8+';
const DATA_B = 'data:image/svg+xml;base64,PHN2ZyAvPg==';
const XML = `<mxfile><diagram><mxGraphModel><root><mxCell id="a" style="image=${ICON};" vertex="1"/></root></mxGraphModel></diagram></mxfile>`;

// A stand-in for the DrawIO frame window: the editor's graph class and its
// prototype hooks, which is all the loader touches.
function fakeFrame() {
  const getImageFromBundles = vi.fn(() => null);
  const getLabel = vi.fn((cell: any) => cell.label);
  class Graph {}
  Object.assign(Graph.prototype, { getImageFromBundles, getLabel });
  return { win: { Graph } as any, Graph, getImageFromBundles, getLabel };
}

describe('createEditorIconLoader', () => {
  const track = vi.fn();
  beforeEach(() => { vi.mocked(callRemote).mockReset(); track.mockReset(); });

  it('makes no call and no event, and returns null, for a diagram without external icons', () => {
    const { win } = fakeFrame();
    const loader = createEditorIconLoader({ track });
    expect(loader.prepare(win, '<mxfile><diagram><mxGraphModel><root/></mxGraphModel></diagram></mxfile>')).toBeNull();
    expect(callRemote).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it('fetches once, then getImageFromBundles returns the data URL and defers for other values', async () => {
    vi.mocked(callRemote).mockResolvedValue({ icons: { [ICON]: DATA }, failed: {} });
    const { win, Graph, getImageFromBundles } = fakeFrame();
    const loader = createEditorIconLoader({ track });
    const pending = loader.prepare(win, XML);
    expect(pending).not.toBeNull();
    expect(track).toHaveBeenCalledWith('graph_icon_proxy_requested', expect.objectContaining({ surface: 'editor', macro_type: 'graph', external_icon_count: 1 }));
    await pending;
    expect(callRemote).toHaveBeenCalledWith('/graph-icon-proxy', 'POST', { urls: [ICON] });
    expect(track).toHaveBeenCalledWith('graph_icon_proxy_succeeded', expect.objectContaining({ surface: 'editor', icon_resolved_count: 1 }));
    const graph = new Graph() as any;
    expect(graph.getImageFromBundles(ICON)).toBe(DATA);
    expect(graph.getImageFromBundles('img/lib/a.svg')).toBeNull();
    expect(getImageFromBundles).toHaveBeenCalledTimes(1);
  });

  it('is installed before the data arrives, so a graph built during the wait still resolves it', async () => {
    let answer!: (v: unknown) => void;
    vi.mocked(callRemote).mockReturnValue(new Promise((r) => { answer = r; }));
    const { win, Graph } = fakeFrame();
    const loader = createEditorIconLoader({ track });
    const pending = loader.prepare(win, XML)!;
    const graph = new Graph() as any;
    expect(graph.getImageFromBundles(ICON)).toBeNull();
    answer({ icons: { [ICON]: DATA }, failed: {} });
    await pending;
    expect(graph.getImageFromBundles(ICON)).toBe(DATA);
  });

  it('rewrites an <img src> in an HTML label for display only; the cell value is untouched', async () => {
    vi.mocked(callRemote).mockResolvedValue({ icons: { [ICON]: DATA }, failed: {} });
    const { win, Graph } = fakeFrame();
    const loader = createEditorIconLoader({ track });
    await loader.prepare(win, XML);
    const cell = { label: `<img src="${ICON}" width="20">` };
    expect((new Graph() as any).getLabel(cell)).toBe(`<img src="${DATA}" width="20">`);
    expect(cell.label).toBe(`<img src="${ICON}" width="20">`);
    expect((new Graph() as any).getLabel({ label: '<b>x</b>' })).toBe('<b>x</b>');
  });

  it('does not fetch icons it already has, and fetches only the new ones', async () => {
    vi.mocked(callRemote).mockResolvedValueOnce({ icons: { [ICON]: DATA }, failed: {} });
    const { win } = fakeFrame();
    const loader = createEditorIconLoader({ track });
    await loader.prepare(win, XML);
    expect(loader.prepare(win, XML)).toBeNull();
    expect(callRemote).toHaveBeenCalledTimes(1);
    vi.mocked(callRemote).mockResolvedValueOnce({ icons: { [ICON_B]: DATA_B }, failed: {} });
    await loader.prepare(win, XML.replace('</root>', `<mxCell id="b" style="image=${ICON_B};"/></root>`));
    expect(callRemote).toHaveBeenLastCalledWith('/graph-icon-proxy', 'POST', { urls: [ICON_B] });
  });

  it('installs on a reloaded frame window with the icons it already holds, without a request', async () => {
    vi.mocked(callRemote).mockResolvedValueOnce({ icons: { [ICON]: DATA }, failed: {} });
    const first = fakeFrame();
    const loader = createEditorIconLoader({ track });
    await loader.prepare(first.win, XML);
    const second = fakeFrame();
    expect(loader.prepare(second.win, XML)).toBeNull();
    expect((new second.Graph() as any).getImageFromBundles(ICON)).toBe(DATA);
    expect(callRemote).toHaveBeenCalledTimes(1);
  });

  it('scans the frame-decoded model, so a deflated <diagram> body is found', async () => {
    vi.mocked(callRemote).mockResolvedValue({ icons: { [ICON]: DATA }, failed: {} });
    const { win } = fakeFrame();
    const diagram = { nodeName: 'diagram' };
    win.mxUtils = {
      parseXml: vi.fn(() => ({ documentElement: { nodeName: 'mxfile', getElementsByTagName: () => [diagram] } })),
      getXml: vi.fn(() => `image=${ICON};`),
    };
    win.Editor = { parseDiagramNode: vi.fn(() => ({})) };
    const loader = createEditorIconLoader({ track });
    await loader.prepare(win, '<mxfile><diagram>eJxLzs8tSM0rSS0CAA==</diagram></mxfile>');
    expect(win.Editor.parseDiagramNode).toHaveBeenCalledWith(diagram);
    expect(callRemote).toHaveBeenCalledWith('/graph-icon-proxy', 'POST', { urls: [ICON] });
  });

  it('never rejects: a backend error resolves, reports failure, and leaves the icon unresolved', async () => {
    vi.mocked(callRemote).mockRejectedValue(Object.assign(new Error('HTTP 502'), { status: 502 }));
    const { win, Graph } = fakeFrame();
    const loader = createEditorIconLoader({ track });
    await expect(loader.prepare(win, XML)).resolves.toBeUndefined();
    expect(track).toHaveBeenCalledWith('graph_icon_proxy_failed', expect.objectContaining({ surface: 'editor', error_code: 'http_502' }));
    expect((new Graph() as any).getImageFromBundles(ICON)).toBeNull();
  });

  it('stops waiting at the timeout, so the editor can open without the icons', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(callRemote).mockReturnValue(new Promise(() => {}));
      const { win } = fakeFrame();
      const loader = createEditorIconLoader({ track, timeoutMs: 100 });
      const pending = loader.prepare(win, XML)!;
      await vi.advanceTimersByTimeAsync(120);
      await expect(pending).resolves.toBeUndefined();
      expect(track).toHaveBeenCalledWith('graph_icon_proxy_failed', expect.objectContaining({ error_code: 'timeout', surface: 'editor' }));
    } finally { vi.useRealTimers(); }
  });

  describe('wait-expired event (#1062)', () => {
    const names = () => track.mock.calls.map(([name]) => name);
    const expired = () => track.mock.calls.filter(([name]) => name === 'graph_icon_proxy_wait_expired');

    it('proxy answers within the wait: succeeded, no wait_expired', async () => {
      vi.mocked(callRemote).mockResolvedValue({ icons: { [ICON]: DATA }, failed: {} });
      const { win } = fakeFrame();
      await createEditorIconLoader({ track, timeoutMs: 100 }).prepare(win, XML);
      expect(names()).toContain('graph_icon_proxy_succeeded');
      expect(names()).not.toContain('graph_icon_proxy_wait_expired');
    });

    it('wait expires, proxy answers later: one wait_expired with surface, wait_ms and count; succeeded stays unfired', async () => {
      vi.useFakeTimers();
      try {
        let answer!: (v: unknown) => void;
        vi.mocked(callRemote).mockReturnValue(new Promise((r) => { answer = r; }));
        const { win } = fakeFrame();
        const pending = createEditorIconLoader({ track, timeoutMs: 100 }).prepare(win, XML)!;
        await vi.advanceTimersByTimeAsync(120);
        await pending;
        answer({ icons: { [ICON]: DATA }, failed: {} });
        await vi.advanceTimersByTimeAsync(10);
        expect(expired()).toEqual([[
          'graph_icon_proxy_wait_expired',
          { feature_area: 'macro', surface: 'editor', macro_type: 'graph', external_icon_count: 1, wait_ms: 100 },
        ]]);
        expect(names().filter((n) => n === 'graph_icon_proxy_failed')).toHaveLength(1);
        expect(names()).not.toContain('graph_icon_proxy_succeeded');
      } finally { vi.useRealTimers(); }
    });

    it('wait expires, proxy fails later: one wait_expired and graph_icon_proxy_failed still fires', async () => {
      vi.useFakeTimers();
      try {
        let fail!: (e: unknown) => void;
        vi.mocked(callRemote).mockReturnValue(new Promise((_, r) => { fail = r; }));
        const { win } = fakeFrame();
        const pending = createEditorIconLoader({ track, timeoutMs: 100 }).prepare(win, XML)!;
        await vi.advanceTimersByTimeAsync(120);
        await pending;
        fail(Object.assign(new Error('HTTP 502'), { status: 502 }));
        await vi.advanceTimersByTimeAsync(10);
        expect(expired()).toHaveLength(1);
        expect(track).toHaveBeenCalledWith('graph_icon_proxy_failed', expect.objectContaining({ surface: 'editor', error_code: 'timeout' }));
      } finally { vi.useRealTimers(); }
    });

    it('a fast backend error is not a wait expiry', async () => {
      vi.mocked(callRemote).mockRejectedValue(Object.assign(new Error('HTTP 502'), { status: 502 }));
      const { win } = fakeFrame();
      await createEditorIconLoader({ track, timeoutMs: 100 }).prepare(win, XML);
      expect(names()).toContain('graph_icon_proxy_failed');
      expect(names()).not.toContain('graph_icon_proxy_wait_expired');
    });

    it('no such icon in the diagram: no request, no event', () => {
      const { win } = fakeFrame();
      const loader = createEditorIconLoader({ track, timeoutMs: 100 });
      expect(loader.prepare(win, '<mxfile><diagram><mxGraphModel><root/></mxGraphModel></diagram></mxfile>')).toBeNull();
      expect(callRemote).not.toHaveBeenCalled();
      expect(track).not.toHaveBeenCalled();
    });
  });

  it('does nothing when the frame has no graph class yet', () => {
    const loader = createEditorIconLoader({ track });
    expect(loader.prepare({} as any, XML)).toBeNull();
    expect(loader.prepare(null as any, XML)).toBeNull();
    expect(callRemote).not.toHaveBeenCalled();
  });
});
