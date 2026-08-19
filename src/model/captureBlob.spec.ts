import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as htmlToImage from 'html-to-image';
import { captureBlob } from './captureBlob';

// The defect these tests pin down: html-to-image's own toBlob() resolves ONLY
// from inside a requestAnimationFrame callback, and Chrome runs no animation
// frames in an offscreen cross-origin iframe — which is every Forge macro
// below the fold. `captureBlob` must produce a Blob under exactly those
// conditions.

const SVG_URL = 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E';

type ImageStub = {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  decode?: () => Promise<void>;
  naturalWidth: number;
  naturalHeight: number;
  crossOrigin?: string;
  decoding?: string;
  src: string;
};

/**
 * Replace `Image` with a stub that fires `load` on the next microtask, so the
 * test exercises the post-load chain (decode -> raster) rather than jsdom's
 * no-op image loading.
 */
function stubImage(decodeBehaviour: 'ok' | 'reject' | 'absent') {
  const created: ImageStub[] = [];
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 300;
    naturalHeight = 120;
    crossOrigin?: string;
    decoding?: string;
    #src = '';
    constructor() {
      if (decodeBehaviour !== 'absent') {
        (this as unknown as ImageStub).decode = () =>
          decodeBehaviour === 'ok'
            ? Promise.resolve()
            : Promise.reject(new DOMException('bad image', 'EncodingError'));
      }
      created.push(this as unknown as ImageStub);
    }
    get src() { return this.#src; }
    set src(v: string) {
      this.#src = v;
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
  return created;
}

/** A capture node with a real measurable box. */
function makeNode(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 300, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 120, configurable: true });
  document.body.appendChild(el);
  return el;
}

function stubCanvas() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
  ) {
    cb(new Blob(['png'], { type: 'image/png' }));
  } as HTMLCanvasElement['toBlob']);
}

/** Resolves to 'timeout' if `p` has not settled within `ms` of fake time. */
function settlesWithin<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([
    p,
    new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms)),
  ]);
}

describe('captureBlob', () => {
  let node: HTMLElement;

  beforeEach(() => {
    node = makeNode();
    stubCanvas();
    vi.spyOn(htmlToImage, 'toSvg').mockResolvedValue(SVG_URL);
    // The offscreen-iframe condition: animation frames are never serviced.
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  });

  afterEach(() => {
    node.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('produces a PNG blob when requestAnimationFrame never fires (offscreen Forge iframe)', async () => {
    stubImage('ok');
    const blob = await settlesWithin(captureBlob(node, { backgroundColor: 'white', skipFonts: true }), 2000);
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).type).toBe('image/png');
  });

  it('still produces a blob when img.decode() rejects', async () => {
    stubImage('reject');
    const blob = await settlesWithin(captureBlob(node, { backgroundColor: 'white' }), 2000);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('still produces a blob when the browser has no img.decode()', async () => {
    stubImage('absent');
    const blob = await settlesWithin(captureBlob(node, { backgroundColor: 'white' }), 2000);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('rejects (rather than hanging) when the capture SVG fails to load', async () => {
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      #src = '';
      get src() { return this.#src; }
      set src(v: string) { this.#src = v; queueMicrotask(() => this.onerror?.()); }
    }
    vi.stubGlobal('Image', FailingImage as unknown as typeof Image);
    await expect(settlesWithin(captureBlob(node), 2000)).rejects.toThrow(/failed to load/);
  });

  it('passes the caller options straight through to html-to-image toSvg', async () => {
    stubImage('ok');
    await captureBlob(node, { backgroundColor: 'white', skipFonts: true });
    expect(htmlToImage.toSvg).toHaveBeenCalledWith(node, { backgroundColor: 'white', skipFonts: true });
  });

  // The regression guard, stated as the library's own code shape. The real
  // html-to-image pipeline cannot run under jsdom (it needs SVGImageElement and
  // real computed styles), so this reproduces `createImage` from
  // node_modules/html-to-image/es/util.js verbatim and shows that its ONLY
  // resolve path is gated on an animation frame. `captureBlob` deliberately has
  // no such gate; the first test above is the paired assertion.
  it('DOCUMENTS THE DEFECT: html-to-image createImage() never settles without animation frames', async () => {
    stubImage('ok');
    // verbatim from html-to-image 1.11.13 es/util.js
    const createImage = (url: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          img.decode().then(() => {
            requestAnimationFrame(() => resolve(img));
          });
        };
        img.onerror = reject;
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.src = url;
      });
    expect(await settlesWithin(createImage(SVG_URL), 500)).toBe('timeout');
  });

  it('DOCUMENTS THE DEFECT: html-to-image createImage() never settles when decode() rejects', async () => {
    stubImage('reject');
    // Animation frames DO fire here — the hang is the missing rejection handler.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queueMicrotask(() => cb(0));
      return 1;
    });
    const createImage = (url: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const derived = img.decode().then(() => {
            requestAnimationFrame(() => resolve(img));
          });
          // Only to keep the runner quiet: the derived promise is what the
          // library leaves unhandled. `resolve` is still never called, which is
          // the point being asserted.
          derived.catch(() => undefined);
        };
        img.onerror = reject;
        img.src = url;
      });
    expect(await settlesWithin(createImage(SVG_URL), 500)).toBe('timeout');
  });
});
