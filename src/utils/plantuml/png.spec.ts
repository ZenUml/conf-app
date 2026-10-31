import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { renderer, renderLocally, track } = vi.hoisted(() => ({
  renderer: vi.fn(),
  renderLocally: vi.fn(),
  track: vi.fn(),
}));

vi.mock('./renderer', () => ({ plantUmlRenderer: renderer }));
// The real engine needs a canvas-backed browser (engine.ts); jsdom cannot run it.
vi.mock('./engine', async () => {
  const { PlantUmlLocalRenderError } = await vi.importActual<typeof import('./engine')>('./engine');
  return { renderPlantUmlLocally: renderLocally, PlantUmlLocalRenderError };
});
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: track }));

import { producePlantUmlPng, rasterisePlantUmlSvg } from './png';
import { PlantUmlLocalRenderError } from './engine';
import { TARGET_WIDTH_PX } from './resolution';

const SOURCE = '@startuml\nAlice -> Bob: Hello\n@enduml';
const LOCAL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100px" height="50px" style="width:100px;height:50px;background:#FFFFFF;" viewBox="0 0 100 50"><text>Alice</text></svg>';

/** Header-only PNG: enough for readPngSize. */
function fakePng(width: number, height: number): Blob {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new Blob([bytes], { type: 'image/png' });
}

const pngResponse = (blob: Blob) => ({ ok: true, blob: () => Promise.resolve(blob) });

// jsdom has no raster stack: an <img> never loads and getContext('2d') is null.
// Record what the rasteriser asks of them instead.
let loadedSrc: string[];
let imageFails: boolean;
let canvasSizes: Array<{ width: number; height: number }>;
let ctx: { fillStyle: string; fillRect: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn> };

function stubRaster() {
  loadedSrc = [];
  imageFails = false;
  canvasSizes = [];
  class StubImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) {
      loadedSrc.push(value);
      setTimeout(() => (imageFails ? this.onerror?.() : this.onload?.()), 0);
    }
  }
  vi.stubGlobal('Image', StubImage);
  ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
    canvasSizes.push({ width: this.width, height: this.height });
    cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }));
  } as HTMLCanvasElement['toBlob']);
}

const decodedSvg = (i = 0) => decodeURIComponent(loadedSrc[i].slice(loadedSrc[i].indexOf(',') + 1));

beforeEach(() => {
  vi.clearAllMocks();
  stubRaster();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('rasterisePlantUmlSvg', () => {
  it('draws the SVG at its own size, from a data URL, with the size pinned on the root', async () => {
    const blob = await rasterisePlantUmlSvg(LOCAL_SVG);

    expect(blob?.type).toBe('image/png');
    expect(canvasSizes).toEqual([{ width: 100, height: 50 }]);
    expect(loadedSrc[0].startsWith('data:image/svg+xml')).toBe(true);
    const root = decodedSvg().match(/<svg\b[^>]*>/)![0];
    expect(root).toContain('width="100"');
    expect(root).toContain('viewBox="0 0 100 50"');
    // The inline pixel size would override the attributes; the background stays.
    expect(root).not.toMatch(/width:100px/);
    expect(root).toContain('background:#FFFFFF');
  });

  it('renders the vector at the scaled size rather than stretching a 1x bitmap', async () => {
    await rasterisePlantUmlSvg(LOCAL_SVG, { scale: 3, background: 'white' });

    expect(canvasSizes).toEqual([{ width: 300, height: 150 }]);
    expect(decodedSvg()).toMatch(/<svg width="300" height="150"/);
    expect(ctx.fillStyle).toBe('white');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 300, 150);
  });

  it('adds a viewBox when the root has only width/height', async () => {
    await rasterisePlantUmlSvg('<svg width="40" height="20"><rect/></svg>', { scale: 2 });

    expect(decodedSvg()).toContain('viewBox="0 0 40 20"');
    expect(canvasSizes).toEqual([{ width: 80, height: 40 }]);
  });

  it('resolves undefined for markup with no readable size', async () => {
    expect(await rasterisePlantUmlSvg('<div>not svg</div>')).toBeUndefined();
    expect(loadedSrc).toHaveLength(0);
  });
});

describe('producePlantUmlPng — local renderer (ADR-0010 step 6)', () => {
  beforeEach(() => {
    renderer.mockResolvedValue('local');
    renderLocally.mockResolvedValue(LOCAL_SVG);
  });

  it('rasterises the engine SVG and never asks plantuml.com', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await producePlantUmlPng(SOURCE, { purpose: 'export', surface: 'viewer' });

    expect(result).toMatchObject({ ok: true, source: 'local', upscale: 'none' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(renderLocally).toHaveBeenCalledWith(SOURCE);
    expect(canvasSizes).toEqual([{ width: 100, height: 50 }]);
    expect(track).toHaveBeenCalledWith('plantuml_png_produced', {
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: 'plantuml',
      plantuml_png_source: 'local',
      plantuml_png_purpose: 'export',
    });
  });

  it('draws a small backup at the PDF target width (the sharpness the dpi re-fetch gave)', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const result = await producePlantUmlPng(SOURCE, { purpose: 'backup', surface: 'viewer', upscale: true, background: 'white' });

    expect(result).toMatchObject({ ok: true, source: 'local', upscale: 'done' });
    expect(canvasSizes).toEqual([{ width: TARGET_WIDTH_PX, height: 700 }]);
    expect(track).toHaveBeenCalledWith('plantuml_png_produced', expect.objectContaining({
      plantuml_png_purpose: 'backup', plantuml_png_upscaled: true,
    }));
  });

  it('does not fall back to the server when the raster fails', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    imageFails = true;

    const result = await producePlantUmlPng(SOURCE, { purpose: 'backup', surface: 'viewer', upscale: true });

    expect(result).toEqual({ ok: false, source: 'local', failure: 'raster_failed' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('plantuml_png_failed', expect.objectContaining({
      plantuml_png_source: 'local', plantuml_png_failure: 'raster_failed',
    }));
  });

  it('asks the server for a diagram the engine cannot draw, as the viewer does', async () => {
    renderLocally.mockRejectedValue(new PlantUmlLocalRenderError('include', 'cannot include', 'url'));
    const fetchMock = vi.fn().mockResolvedValue(pngResponse(fakePng(2000, 800)));
    vi.stubGlobal('fetch', fetchMock);

    const result = await producePlantUmlPng(SOURCE, { purpose: 'export', surface: 'modal' });

    expect(result).toMatchObject({ ok: true, source: 'server_fallback' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('plantuml.com/plantuml/png/');
    expect(track).toHaveBeenCalledWith('plantuml_png_produced', expect.objectContaining({
      plantuml_png_source: 'server_fallback', plantuml_failure_reason: 'include',
    }));
  });
});

describe('producePlantUmlPng — server renderer', () => {
  beforeEach(() => {
    renderer.mockResolvedValue('server');
  });

  it('fetches the server PNG and never loads the engine', async () => {
    const natural = fakePng(2000, 800);
    const fetchMock = vi.fn().mockResolvedValue(pngResponse(natural));
    vi.stubGlobal('fetch', fetchMock);

    const result = await producePlantUmlPng(SOURCE, { purpose: 'export', surface: 'modal' });

    expect(result).toEqual({ ok: true, blob: natural, source: 'server', upscale: 'none' });
    expect(renderLocally).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-fetches a small backup at a higher dpi and keeps it only if it grew', async () => {
    const upscaled = fakePng(1400, 1900);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(pngResponse(fakePng(95, 129)))
      .mockResolvedValueOnce(pngResponse(upscaled));
    vi.stubGlobal('fetch', fetchMock);

    const result = await producePlantUmlPng(SOURCE, { purpose: 'backup', surface: 'viewer', upscale: true });

    expect(result).toEqual({ ok: true, blob: upscaled, source: 'server', upscale: 'done' });
    expect(fetchMock.mock.calls[1][0]).not.toBe(fetchMock.mock.calls[0][0]);
  });

  it('keeps the natural PNG when the dpi re-fetch is not larger', async () => {
    const natural = fakePng(95, 129);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(pngResponse(natural))
      .mockResolvedValueOnce(pngResponse(fakePng(95, 129))));

    const result = await producePlantUmlPng(SOURCE, { purpose: 'backup', surface: 'viewer', upscale: true });

    expect(result).toEqual({ ok: true, blob: natural, source: 'server', upscale: 'failed' });
  });

  it('reports a non-PNG answer and a thrown fetch apart', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pngResponse(new Blob(['<svg/>'], { type: 'image/svg+xml' }))));
    expect(await producePlantUmlPng(SOURCE, { purpose: 'export', surface: 'modal' }))
      .toEqual({ ok: false, source: 'server', failure: 'server_no_png' });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await producePlantUmlPng(SOURCE, { purpose: 'export', surface: 'modal' }))
      .toEqual({ ok: false, source: 'server', failure: 'server_fetch_failed' });
  });
});
