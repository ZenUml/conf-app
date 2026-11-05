import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }));
import { callRemote } from '@/utils/requestUtil';
import {
  awaitExternalIcons,
  collectDecodedGraphXml,
  findExternalIconUrls,
  installIconResolver,
  startExternalIconProxy,
} from './externalIcons';

const ICON = 'https://icons.diagrams.net/assets/azure/1/Azure_Service_Bus_Queues.svg';
const ICON_B = 'https://icons.diagrams.net/assets/azure/1/Azure_Storage.svg';
const DATA = 'data:image/svg+xml;base64,PHN2Zy8+';
const DATA_B = 'data:image/svg+xml;base64,PHN2ZyAvPg==';

describe('findExternalIconUrls', () => {
  it('finds style images and HTML-label <img src> in decoded model XML, once each', () => {
    const xml = `<mxGraphModel><root>
      <mxCell id="a" style="shape=image;image=${ICON};aspect=fixed;" vertex="1"/>
      <mxCell id="b" value="&lt;img src=&quot;${ICON_B}&quot; width=&quot;20&quot;&gt;" style="html=1;" vertex="1"/>
      <mxCell id="c" style="image=${ICON};" vertex="1"/>
      <mxCell id="d" style="image=img/lib/azure2/Subnet.svg;" vertex="1"/>
      <mxCell id="e" style="image=https://app.diagrams.net/x.svg;" vertex="1"/>
    </root></mxGraphModel>`;
    expect(findExternalIconUrls(xml)).toEqual([ICON, ICON_B]);
  });

  it('returns nothing for a diagram without external icons', () => {
    expect(findExternalIconUrls('<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>')).toEqual([]);
  });

  it('does not match a lookalike host', () => {
    expect(findExternalIconUrls('image=https://icons.diagrams.net.evil.example/a.svg;')).toEqual([]);
  });
});

describe('collectDecodedGraphXml', () => {
  beforeEach(() => { delete (window as any).Editor; delete (window as any).mxUtils; });

  it('decodes every page of a multi-page file, so compressed pages are not missed', () => {
    const pages = [{ id: 'p1' }, { id: 'p2' }];
    (window as any).Editor = { parseDiagramNode: vi.fn((node: any) => ({ xml: node.id === 'p1' ? `image=${ICON};` : `image=${ICON_B};` })) };
    (window as any).mxUtils = { getXml: vi.fn((node: any) => node.xml) };
    const text = collectDecodedGraphXml({ diagrams: pages, xmlNode: {} });
    expect(findExternalIconUrls(text)).toEqual([ICON, ICON_B]);
  });

  it('reads the root node of a single-page raw model', () => {
    (window as any).mxUtils = { getXml: vi.fn(() => `image=${ICON};`) };
    expect(findExternalIconUrls(collectDecodedGraphXml({ diagrams: [], xmlNode: {} }))).toEqual([ICON]);
  });

  it('keeps going when one page cannot be decoded', () => {
    (window as any).Editor = { parseDiagramNode: vi.fn((n: any) => { if (n.id === 'bad') throw new Error('x'); return { xml: `image=${ICON};` }; }) };
    (window as any).mxUtils = { getXml: (n: any) => n.xml };
    expect(findExternalIconUrls(collectDecodedGraphXml({ diagrams: [{ id: 'bad' }, { id: 'ok' }] }))).toEqual([ICON]);
  });
});

describe('installIconResolver', () => {
  it('makes getImageUrl return the data URL for a proxied URL and defer to DrawIO otherwise', () => {
    const original = vi.fn((u: string) => `base/${u}`);
    const viewer: any = { getImageUrl: original, graph: { refresh: vi.fn() } };
    installIconResolver(viewer, new Map([[ICON, DATA]]));
    expect(viewer.getImageUrl(ICON)).toBe(DATA);
    expect(viewer.getImageUrl('img/lib/a.svg')).toBe('base/img/lib/a.svg');
    expect(original).toHaveBeenCalledTimes(1);
    expect(viewer.graph.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('installIconResolver and HTML labels', () => {
  it('rewrites an <img src> inside an HTML label, and leaves other labels alone', () => {
    const viewer: any = { getImageUrl: (u: string) => u, graph: { refresh: vi.fn(), getLabel: (cell: any) => cell.label } };
    installIconResolver(viewer, new Map([[ICON, DATA]]));
    expect(viewer.graph.getLabel({ label: `<img src="${ICON}" width="20">` })).toBe(`<img src="${DATA}" width="20">`);
    expect(viewer.graph.getLabel({ label: '<b>plain</b>' })).toBe('<b>plain</b>');
    expect(viewer.graph.getLabel({ label: { not: 'a string' } })).toEqual({ not: 'a string' });
  });
});

describe('startExternalIconProxy', () => {
  const track = vi.fn();
  const makeViewer = () => ({ xmlNode: {}, getImageUrl: (u: string) => u, graph: { refresh: vi.fn() } }) as any;
  beforeEach(() => {
    vi.mocked(callRemote).mockReset(); track.mockReset();
    (window as any).mxUtils = { getXml: () => `image=${ICON};image=${ICON_B};` };
  });

  it('makes no call and no event when the diagram has no external icons', async () => {
    (window as any).mxUtils = { getXml: () => 'image=img/lib/a.svg;' };
    const container = document.createElement('div');
    expect(startExternalIconProxy({ viewer: makeViewer(), container, track })).toBeNull();
    expect(callRemote).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
    await expect(awaitExternalIcons(container)).resolves.toBeUndefined();
  });

  it('posts the URLs once, applies the data URLs, refreshes, and reports success', async () => {
    vi.mocked(callRemote).mockResolvedValue({ icons: { [ICON]: DATA, [ICON_B]: DATA_B }, failed: {} });
    const viewer = makeViewer(); const container = document.createElement('div');
    const done = startExternalIconProxy({ viewer, container, track })!;
    expect(track).toHaveBeenCalledWith('graph_icon_proxy_requested', expect.objectContaining({ external_icon_count: 2, macro_type: 'graph' }));
    await expect(done).resolves.toEqual({ ok: true });
    expect(callRemote).toHaveBeenCalledTimes(1);
    expect(callRemote).toHaveBeenCalledWith('/graph-icon-proxy', 'POST', { urls: [ICON, ICON_B] });
    expect(viewer.getImageUrl(ICON)).toBe(DATA);
    expect(viewer.graph.refresh).toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('graph_icon_proxy_succeeded', expect.objectContaining({ external_icon_count: 2, icon_resolved_count: 2 }));
    await expect(awaitExternalIcons(container)).resolves.toBeUndefined();
  });

  it('applies what it got and refuses PNG capture when only some icons came back', async () => {
    vi.mocked(callRemote).mockResolvedValue({ icons: { [ICON]: DATA }, failed: { [ICON_B]: 'too_large' } });
    const viewer = makeViewer(); const container = document.createElement('div');
    await expect(startExternalIconProxy({ viewer, container, track })).resolves.toEqual({ ok: false, code: 'partial' });
    expect(viewer.getImageUrl(ICON)).toBe(DATA);
    expect(track).toHaveBeenCalledWith('graph_icon_proxy_failed', expect.objectContaining({ error_code: 'partial', icon_resolved_count: 1, external_icon_count: 2 }));
    await expect(awaitExternalIcons(container)).rejects.toThrow(/partial/);
  });

  it('ignores a data URL for a URL it never asked for, and a value that is not a data image', async () => {
    vi.mocked(callRemote).mockResolvedValue({ icons: { [ICON]: 'https://evil.example/x.svg', 'https://other/x.svg': DATA }, failed: {} });
    const viewer = makeViewer();
    const result = await startExternalIconProxy({ viewer, container: document.createElement('div'), track });
    expect(result).toEqual({ ok: false, code: 'bad_response' });
    expect(viewer.getImageUrl(ICON)).toBe(ICON);
  });

  it('on a backend error: no throw, no refresh, PNG capture refused, failure reported with the status', async () => {
    vi.mocked(callRemote).mockRejectedValue(Object.assign(new Error('HTTP 500: x'), { status: 500 }));
    const viewer = makeViewer(); const container = document.createElement('div');
    await expect(startExternalIconProxy({ viewer, container, track })).resolves.toEqual({ ok: false, code: 'http_500' });
    expect(viewer.graph.refresh).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('graph_icon_proxy_failed', expect.objectContaining({ error_code: 'http_500' }));
    await expect(awaitExternalIcons(container)).rejects.toThrow(/http_500/);
  });

  it('times out a backend that never answers', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(callRemote).mockReturnValue(new Promise(() => {}));
      const container = document.createElement('div');
      const done = startExternalIconProxy({ viewer: makeViewer(), container, track, timeoutMs: 50 })!;
      await vi.advanceTimersByTimeAsync(60);
      await expect(done).resolves.toEqual({ ok: false, code: 'timeout' });
      expect(track).toHaveBeenCalledWith('graph_icon_proxy_failed', expect.objectContaining({ error_code: 'timeout' }));
    } finally { vi.useRealTimers(); }
  });

  it('capture waits for a pending proxy call', async () => {
    let release!: (v: unknown) => void;
    vi.mocked(callRemote).mockReturnValue(new Promise((r) => { release = r; }));
    const container = document.createElement('div');
    startExternalIconProxy({ viewer: makeViewer(), container, track });
    let settled = false;
    const waiting = awaitExternalIcons(container).then(() => { settled = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false);
    release({ icons: { [ICON]: DATA, [ICON_B]: DATA_B }, failed: {} });
    await waiting;
    expect(settled).toBe(true);
  });
});
