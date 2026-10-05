import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ensureHostedDiagramFont, _resetForTesting } from './ensureHostedDiagramFont';
import { getDiagramFontState, _resetDiagramFontStateForTesting } from './diagramFontState';

vi.mock('@ibm/plex-sans/fonts/split/woff2/IBMPlexSans-Regular-Latin1.woff2?url', () => ({
  default: './assets/IBMPlexSans-Regular-Latin1-abc.woff2',
}));

const g = globalThis as unknown as { FontFace?: unknown };
const originalFontFace = g.FontFace;
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');

type FakeFace = { family: string; status: string };

/** Minimal FontFaceSet: load() resolves, then `faces` is what iteration yields. */
function stubFonts(opts: { faces?: FakeFace[]; load?: () => Promise<unknown> } = {}) {
  const faces = opts.faces ?? [{ family: '"IBM Plex Sans"', status: 'loaded' }];
  const load = vi.fn(opts.load ?? (async () => faces));
  const add = vi.fn();
  Object.defineProperty(document, 'fonts', {
    value: { load, add, [Symbol.iterator]: () => faces[Symbol.iterator]() },
    configurable: true,
  });
  return { load, add };
}

const styleEl = () => document.head.querySelector<HTMLStyleElement>('style[data-diagram-font]');

describe('ensureHostedDiagramFont', () => {
  beforeEach(() => {
    _resetForTesting();
    _resetDiagramFontStateForTesting();
    g.FontFace = class {};
  });
  afterEach(() => {
    vi.useRealTimers();
    styleEl()?.remove();
    g.FontFace = originalFontFace;
    if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
    else delete (document as unknown as { fonts?: unknown }).fonts;
  });

  it("resolves 'fallback' when FontFace is unavailable (jsdom/SSR)", async () => {
    delete g.FontFace;
    await expect(ensureHostedDiagramFont()).resolves.toBe('fallback');
    expect(getDiagramFontState()).toBe('fallback');
    expect(styleEl()).toBeNull();
  });

  it("registers a CSS @font-face rule (not a FontFace object) and resolves 'plex' once the face loads", async () => {
    const ctor = vi.fn();
    g.FontFace = ctor;
    const { load, add } = stubFonts();

    await expect(ensureHostedDiagramFont()).resolves.toBe('plex');

    const css = styleEl()?.textContent ?? '';
    expect(css).toBe(
      '@font-face{font-family:"IBM Plex Sans";src:url(./assets/IBMPlexSans-Regular-Latin1-abc.woff2) format("woff2");font-weight:400;font-style:normal}',
    );
    expect(load).toHaveBeenCalledWith('16px "IBM Plex Sans"');
    expect(ctor).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(getDiagramFontState()).toBe('plex');
  });

  it('accepts an unquoted family name on the loaded face', async () => {
    stubFonts({ faces: [{ family: 'IBM Plex Sans', status: 'loaded' }] });
    await expect(ensureHostedDiagramFont()).resolves.toBe('plex');
  });

  it("resolves 'fallback' and removes the style when no loaded face exists after load()", async () => {
    stubFonts({ faces: [{ family: '"IBM Plex Sans"', status: 'error' }, { family: 'Other', status: 'loaded' }] });
    await expect(ensureHostedDiagramFont()).resolves.toBe('fallback');
    expect(styleEl()).toBeNull();
    expect(getDiagramFontState()).toBe('fallback');
  });

  it('memoises: concurrent and later calls share one style element and one load', async () => {
    const { load } = stubFonts();
    const [a, b] = await Promise.all([ensureHostedDiagramFont(), ensureHostedDiagramFont()]);
    await ensureHostedDiagramFont();
    expect([a, b]).toEqual(['plex', 'plex']);
    expect(load).toHaveBeenCalledTimes(1);
    expect(document.head.querySelectorAll('style[data-diagram-font]')).toHaveLength(1);
  });

  it("resolves 'fallback' (never rejects) when load() rejects", async () => {
    stubFonts({ load: () => Promise.reject(new Error('csp')) });
    await expect(ensureHostedDiagramFont()).resolves.toBe('fallback');
    expect(styleEl()).toBeNull();
    expect(getDiagramFontState()).toBe('fallback');
  });

  it("times out to 'fallback' and removes the style, so a late load cannot switch fonts mid-session", async () => {
    vi.useFakeTimers();
    let finish!: (v: unknown) => void;
    stubFonts({ load: () => new Promise((r) => { finish = r; }) });

    const p = ensureHostedDiagramFont();
    expect(styleEl()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1500);
    await expect(p).resolves.toBe('fallback');
    expect(getDiagramFontState()).toBe('fallback');
    expect(styleEl()).toBeNull();

    finish([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(styleEl()).toBeNull();
    expect(getDiagramFontState()).toBe('fallback');
  });
});
