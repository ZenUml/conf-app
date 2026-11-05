// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type DrawioWindow = typeof window & {
  DRAWIO_BASE_URL?: string | null;
  DRAW_MATH_URL?: string;
  GraphViewer?: unknown;
  MathJax?: unknown;
  Editor?: { initMath: () => void };
};

const w = window as DrawioWindow;

/**
 * Stands in for the browser loading each viewer script. The real
 * viewer-static.min.js reads DRAWIO_BASE_URL while it evaluates, so what counts
 * is the value at the moment the first script is appended, not after loading.
 */
function stubScriptLoading(): {
  baseUrlSeenByViewer: () => string | null | undefined;
  mathUrlSeenByViewer: () => string | undefined;
  mathJaxSeenByViewer: () => unknown;
} {
  let seen: string | null | undefined;
  let mathUrlSeen: string | undefined;
  let mathJaxSeen: unknown;
  let sawViewerScript = false;
  const realAppend = document.head.appendChild.bind(document.head);

  vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
    const result = realAppend(node);
    if (node instanceof HTMLScriptElement) {
      if (!sawViewerScript) {
        sawViewerScript = true;
        seen = w.DRAWIO_BASE_URL;
        mathUrlSeen = w.DRAW_MATH_URL;
        mathJaxSeen = w.MathJax;
      }
      w.GraphViewer = class {};
      queueMicrotask(() => node.onload?.(new Event('load')));
    }
    return result;
  }) as typeof document.head.appendChild);

  return {
    baseUrlSeenByViewer: () => seen,
    mathUrlSeenByViewer: () => mathUrlSeen,
    mathJaxSeenByViewer: () => mathJaxSeen,
  };
}

describe('ensureDrawioViewerLoaded', () => {
  beforeEach(() => {
    vi.resetModules();
    delete w.DRAWIO_BASE_URL;
    delete w.DRAW_MATH_URL;
    delete w.GraphViewer;
    delete w.MathJax;
    delete w.Editor;
    document.head.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('points DRAWIO_BASE_URL at the bundled drawio folder before the viewer script runs', async () => {
    const { baseUrlSeenByViewer } = stubScriptLoading();
    const { ensureDrawioViewerLoaded } = await import('./loadDrawioViewer');

    await ensureDrawioViewerLoaded();

    expect(baseUrlSeenByViewer()).toBe(new URL('drawio', document.baseURI).href);
  });

  it('uses the explicit asset base when one is given', async () => {
    const { baseUrlSeenByViewer } = stubScriptLoading();
    const { ensureDrawioViewerLoaded } = await import('./loadDrawioViewer');

    await ensureDrawioViewerLoaded('https://assets.example.test/app/');

    expect(baseUrlSeenByViewer()).toBe('https://assets.example.test/app/drawio');
  });

  it('gives a base URL with no trailing slash, because the viewer appends its own', async () => {
    const { baseUrlSeenByViewer } = stubScriptLoading();
    const { ensureDrawioViewerLoaded } = await import('./loadDrawioViewer');

    await ensureDrawioViewerLoaded();

    expect(baseUrlSeenByViewer()).not.toMatch(/\/$/);
  });
});

function xmlNode(xml: string): Element {
  return new DOMParser().parseFromString(xml, 'text/xml').documentElement;
}

describe('MathJax loading', () => {
  beforeEach(() => {
    vi.resetModules();
    delete w.DRAW_MATH_URL;
    delete w.GraphViewer;
    delete w.MathJax;
    delete w.Editor;
    document.head.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('points DRAW_MATH_URL at the bundled copy, because Forge CSP refuses viewer.diagrams.net', async () => {
    const { mathUrlSeenByViewer } = stubScriptLoading();
    const { ensureDrawioViewerLoaded } = await import('./loadDrawioViewer');

    await ensureDrawioViewerLoaded();

    expect(mathUrlSeenByViewer()).toBe(new URL('drawio/math4/es5', document.baseURI).href);
  });

  it('defines MathJax before the viewer script runs, so its startup initMath does nothing', async () => {
    const { mathJaxSeenByViewer } = stubScriptLoading();
    const { ensureDrawioViewerLoaded } = await import('./loadDrawioViewer');

    await ensureDrawioViewerLoaded();

    expect(mathJaxSeenByViewer()).toBeDefined();
  });

  it.each([
    ['math="0" model', '<mxGraphModel math="0"><root/></mxGraphModel>'],
    ['model with no math attribute', '<mxGraphModel><root/></mxGraphModel>'],
    ['mxfile with no math page', '<mxfile><diagram><mxGraphModel math="0"><root/></mxGraphModel></diagram></mxfile>'],
  ])('does not load MathJax for a %s', async (_name, xml) => {
    stubScriptLoading();
    const { ensureDrawioViewerLoaded, ensureDrawioMathForDocument } = await import('./loadDrawioViewer');
    await ensureDrawioViewerLoaded();
    const initMath = vi.fn();
    w.Editor = { initMath };

    ensureDrawioMathForDocument(xmlNode(xml));

    expect(initMath).not.toHaveBeenCalled();
    expect(w.MathJax).toBeDefined();
  });

  it.each([
    ['math="1" model', '<mxGraphModel math="1"><root/></mxGraphModel>'],
    ['mxfile whose second page uses math', '<mxfile><diagram><mxGraphModel math="0"><root/></mxGraphModel></diagram><diagram><mxGraphModel math="1"><root/></mxGraphModel></diagram></mxfile>'],
    ['mxfile with a compressed page, whose math flag cannot be read', '<mxfile><diagram>7VpNc5s8EP41PpaRxPdHSNI0nXYm7dA3pyYj</diagram></mxfile>'],
  ])('loads MathJax for a %s, with the placeholder gone so initMath runs', async (_name, xml) => {
    stubScriptLoading();
    const { ensureDrawioViewerLoaded, ensureDrawioMathForDocument } = await import('./loadDrawioViewer');
    await ensureDrawioViewerLoaded();
    let mathJaxAtInit: unknown = 'not called';
    w.Editor = { initMath: () => { mathJaxAtInit = w.MathJax; } };

    ensureDrawioMathForDocument(xmlNode(xml));

    expect(mathJaxAtInit).toBeUndefined();
  });

  it('loads MathJax once when several documents use math', async () => {
    stubScriptLoading();
    const { ensureDrawioViewerLoaded, ensureDrawioMathForDocument } = await import('./loadDrawioViewer');
    await ensureDrawioViewerLoaded();
    const initMath = vi.fn(() => { w.MathJax = { loader: {} }; });
    w.Editor = { initMath };

    ensureDrawioMathForDocument(xmlNode('<mxGraphModel math="1"><root/></mxGraphModel>'));
    ensureDrawioMathForDocument(xmlNode('<mxGraphModel math="1"><root/></mxGraphModel>'));

    expect(initMath).toHaveBeenCalledTimes(1);
  });
});

describe('viewer-static.min.js internals the MathJax placeholder depends on', () => {
  const viewer = readFileSync(resolve(process.cwd(), 'public/drawio/js/viewer-static.min.js'), 'utf8');

  it('skips initMath when MathJax is defined', () => {
    expect(viewer).toMatch(/Editor\.initMath=function\(\w+,\w+\)\{if\("undefined"===typeof window\.MathJax\)/);
  });

  it('calls initMath with no URL, so DRAW_MATH_URL decides the source', () => {
    expect(viewer).toContain('Editor.initMath();if(null!=window.onDrawioViewerLoad)');
    expect(viewer).toMatch(/null!=\w+\?\w+:DRAW_MATH_URL\+"\/startup\.js"/);
  });
});
