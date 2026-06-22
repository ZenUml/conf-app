import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./loadDrawioViewer', () => ({ ensureDrawioViewerLoaded: vi.fn().mockResolvedValue(undefined) }));
import { renderGraphToSvg } from './renderGraphToSvg';

function makeSvgEl(id = 'g'): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('id', id);
  el.innerHTML = '<path d="M0 0"/>';
  return el;
}

describe('renderGraphToSvg', () => {
  beforeEach(() => {
    (window as any).mxUtils = { parseXml: vi.fn(() => ({ documentElement: { nodeName: 'mxGraphModel' } })) };
    (window as any).GraphViewer = vi.fn(function (this: any) {
      this.diagrams = [{}];
      this.graph = { getSvg: vi.fn(() => makeSvgEl('exported')) };
    });
  });

  afterEach(() => {
    delete (window as any).mxUtils;
    delete (window as any).GraphViewer;
    vi.clearAllMocks();
  });

  it('returns the exported SVG string for a single-page graph', async () => {
    const out = await renderGraphToSvg('<mxGraphModel><root/></mxGraphModel>');
    expect(out).toMatch(/<svg/i);
    expect(out).toContain('exported');
  });

  it('returns undefined for empty / non-string input', async () => {
    expect(await renderGraphToSvg('')).toBeUndefined();
    expect(await renderGraphToSvg(undefined)).toBeUndefined();
  });

  it('skips caching when graphXml references an external image (getSvg cannot inline it)', async () => {
    const out = await renderGraphToSvg('<mxGraphModel><mxCell style="image;image=https://x.com/a.png"/></mxGraphModel>');
    expect(out).toBeUndefined();
    expect((window as any).GraphViewer).not.toHaveBeenCalled();
  });

  it('skips caching for multi-page mxfile (single SVG cannot hold the page-nav)', async () => {
    (window as any).GraphViewer = vi.fn(function (this: any) {
      this.diagrams = [{}, {}];
      this.graph = { getSvg: vi.fn(() => makeSvgEl()) };
    });
    expect(await renderGraphToSvg('<mxfile><diagram/><diagram/></mxfile>')).toBeUndefined();
  });

  it('never throws — returns undefined when GraphViewer construction fails', async () => {
    (window as any).GraphViewer = vi.fn(() => {
      throw new Error('mxgraph boom');
    });
    expect(await renderGraphToSvg('<mxGraphModel><root/></mxGraphModel>')).toBeUndefined();
  });
});
