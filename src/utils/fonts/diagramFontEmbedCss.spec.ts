import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDiagramFontEmbedCss, _resetDiagramFontEmbedCssForTesting } from './diagramFontEmbedCss';
import { setDiagramFontState, _resetDiagramFontStateForTesting } from './diagramFontState';

vi.mock('@ibm/plex-sans/fonts/split/woff2/IBMPlexSans-Regular-Latin1.woff2?url', () => ({
  default: '/assets/IBMPlexSans-Regular-Latin1-abc.woff2',
}));

function okResponse(bytes: Uint8Array) {
  return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

describe('getDiagramFontEmbedCss', () => {
  beforeEach(() => {
    _resetDiagramFontEmbedCssForTesting();
    _resetDiagramFontStateForTesting();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is undefined and does not fetch unless the hosted face loaded', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await getDiagramFontEmbedCss()).toBeUndefined();
    setDiagramFontState('fallback');
    expect(await getDiagramFontEmbedCss()).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an @font-face with the woff2 as a base64 data URI when plex loaded', async () => {
    setDiagramFontState('plex');
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(new Uint8Array([1, 2, 3, 250]))));
    const css = await getDiagramFontEmbedCss();
    expect(css).toBe(
      '@font-face{font-family:"IBM Plex Sans";src:url(data:font/woff2;base64,AQID+g==) format("woff2");font-weight:400;font-style:normal}',
    );
  });

  it('encodes large buffers without overflowing the stack', async () => {
    setDiagramFontState('plex');
    const big = new Uint8Array(300_000).fill(65);
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(big)));
    const css = await getDiagramFontEmbedCss();
    const b64 = /base64,([^)]+)\)/.exec(css!)![1];
    expect(atob(b64).length).toBe(300_000);
  });

  it('memoises: one fetch for concurrent and later calls', async () => {
    setDiagramFontState('plex');
    const fetchMock = vi.fn(async () => okResponse(new Uint8Array([1])));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([getDiagramFontEmbedCss(), getDiagramFontEmbedCss()]);
    await getDiagramFontEmbedCss();
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/assets/IBMPlexSans-Regular-Latin1-abc.woff2');
  });

  it('resolves undefined (never rejects) when fetch fails or is not ok', async () => {
    setDiagramFontState('plex');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
    await expect(getDiagramFontEmbedCss()).resolves.toBeUndefined();
    _resetDiagramFontEmbedCssForTesting();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    await expect(getDiagramFontEmbedCss()).resolves.toBeUndefined();
  });
});
