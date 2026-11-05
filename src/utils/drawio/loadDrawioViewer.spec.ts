// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type DrawioWindow = typeof window & {
  DRAWIO_BASE_URL?: string | null;
  GraphViewer?: unknown;
};

const w = window as DrawioWindow;

/**
 * Stands in for the browser loading each viewer script. The real
 * viewer-static.min.js reads DRAWIO_BASE_URL while it evaluates, so what counts
 * is the value at the moment the first script is appended, not after loading.
 */
function stubScriptLoading(): { baseUrlSeenByViewer: () => string | null | undefined } {
  let seen: string | null | undefined;
  let sawViewerScript = false;
  const realAppend = document.head.appendChild.bind(document.head);

  vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
    const result = realAppend(node);
    if (node instanceof HTMLScriptElement) {
      if (!sawViewerScript) {
        sawViewerScript = true;
        seen = w.DRAWIO_BASE_URL;
      }
      w.GraphViewer = class {};
      queueMicrotask(() => node.onload?.(new Event('load')));
    }
    return result;
  }) as typeof document.head.appendChild);

  return { baseUrlSeenByViewer: () => seen };
}

describe('ensureDrawioViewerLoaded', () => {
  beforeEach(() => {
    vi.resetModules();
    delete w.DRAWIO_BASE_URL;
    delete w.GraphViewer;
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
