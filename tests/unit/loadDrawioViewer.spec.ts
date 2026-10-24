import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('loadDrawioViewer', () => {
  const appendedScripts: HTMLScriptElement[] = [];

  beforeEach(() => {
    vi.resetModules();
    appendedScripts.length = 0;

    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLScriptElement) {
        appendedScripts.push(node);
        queueMicrotask(() => {
          (window as any).GraphViewer = class GraphViewer {};
          (window as any).mxStencilRegistry = { allowEval: true, libraries: {} };
          node.onload?.(new Event('load'));
        });
      }
      return node;
    });

    Object.defineProperty(document, 'baseURI', {
      configurable: true,
      value: 'https://example.test/bundle/index.html',
    });

    delete (window as any).GraphViewer;
    delete (window as any).mxStencilRegistry;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.getElementById('drawio-common-css')?.remove();
  });

  it('loads viewer scripts once and exposes GraphViewer', async () => {
    const module = await import('@/utils/drawio/loadDrawioViewer');

    await module.ensureDrawioViewerLoaded();

    expect(module.isDrawioViewerLoaded()).toBe(true);
    expect(appendedScripts).toHaveLength(4);
    expect(appendedScripts.map((s) => s.src)).toEqual([
      'https://example.test/bundle/drawio/js/viewer-static.min.js',
      'https://example.test/bundle/drawio/shapes/mxBasic.js',
      'https://example.test/bundle/drawio/shapes/mxAWS3D.js',
      'https://example.test/bundle/drawio/shapes/mxAWS4.js',
    ]);

    appendedScripts.length = 0;
    await module.ensureDrawioViewerLoaded();
    expect(appendedScripts).toHaveLength(0);
  });

  it('configures DrawIO globals before loading scripts', async () => {
    const module = await import('@/utils/drawio/loadDrawioViewer');
    await module.ensureDrawioViewerLoaded();

    expect((window as any).mxLoadStylesheets).toBe(false);
    expect((window as any).mxLoadResources).toBe(false);
    expect((window as any).SHAPES_PATH).toBe('./drawio/shapes');

    expect((window as any).mxStencilRegistry.allowEval).toBe(false);
    expect((window as any).mxStencilRegistry.libraries.aws4).toContain('./drawio/shapes/mxAWS4.js');
  });
});
