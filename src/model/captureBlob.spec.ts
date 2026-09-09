import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as htmlToImage from 'html-to-image';
import { captureBlob, filterExportCaptureNode, prepareSequenceCaptureSvg } from './captureBlob';

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
    set src(v: string) { this.#src = v; queueMicrotask(() => this.onload?.()); }
  }
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
  return created;
}

function makeNode(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 300, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 120, configurable: true });
  document.body.appendChild(el);
  return el;
}

function stubCanvas() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement, cb: BlobCallback,
  ) { cb(new Blob(['png'], { type: 'image/png' })); } as HTMLCanvasElement['toBlob']);
}

function settlesWithin<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))]);
}

describe('captureBlob', () => {
  let node: HTMLElement;
  beforeEach(() => {
    node = makeNode();
    stubCanvas();
    vi.spyOn(htmlToImage, 'toSvg').mockResolvedValue(SVG_URL);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  });
  afterEach(() => { node.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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

  it('DOCUMENTS THE DEFECT: html-to-image createImage() never settles without animation frames', async () => {
    stubImage('ok');
    const createImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => { img.decode!().then(() => { requestAnimationFrame(() => resolve(img)); }); };
      img.onerror = reject; img.crossOrigin = 'anonymous'; img.decoding = 'async'; img.src = url;
    });
    expect(await settlesWithin(createImage(SVG_URL), 500)).toBe('timeout');
  });

  it('DOCUMENTS THE DEFECT: html-to-image createImage() never settles when decode() rejects', async () => {
    stubImage('reject');
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queueMicrotask(() => cb(0)); return 1; });
    const createImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => { const derived = img.decode!().then(() => { requestAnimationFrame(() => resolve(img)); }); derived.catch(() => undefined); };
      img.onerror = reject; img.src = url;
    });
    expect(await settlesWithin(createImage(SVG_URL), 500)).toBe('timeout');
  });
});

describe('filterExportCaptureNode', () => {
  it('excludes marked controls and safely keeps non-element nodes', () => {
    const control = document.createElement('button');
    control.dataset.exportExclude = '';
    expect(filterExportCaptureNode(control)).toBe(false);
    expect(filterExportCaptureNode(document.createTextNode('diagram'))).toBe(true);
  });
});

describe('prepareSequenceCaptureSvg', () => {
  it('clears only ZenUML canvas/frame surfaces in the serialized clone', () => {
    const source = document.createElement('div');
    source.innerHTML = '<div class="zenuml"><div /></div>';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div class="bg-skin-canvas" style="background-color: rgb(255, 255, 255);"><div class="bg-skin-frame" style="background-color: rgb(255, 255, 255);"><div class="participant" style="background-color: rgb(238, 238, 238);" /></div></div></foreignObject></svg>';
    const prepared = prepareSequenceCaptureSvg(svg, source);
    expect(prepared).toContain('class="bg-skin-canvas" style="background-color: transparent;"');
    expect(prepared).toContain('class="bg-skin-frame" style="background-color: transparent;"');
    expect(prepared).toContain('class="participant" style="background-color: rgb(238, 238, 238);"');
  });
  it('leaves non-Sequence captures unchanged', () => {
    const source = document.createElement('div');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="white" /></svg>';
    expect(prepareSequenceCaptureSvg(svg, source)).toBe(svg);
  });
});
