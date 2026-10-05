import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ensureHostedDiagramFont, _resetForTesting } from './ensureHostedDiagramFont';
import { getDiagramFontState, _resetDiagramFontStateForTesting } from './diagramFontState';

vi.mock('@ibm/plex-sans/fonts/split/woff2/IBMPlexSans-Regular-Latin1.woff2?url', () => ({
  default: '/assets/IBMPlexSans-Regular-Latin1-abc.woff2',
}));

const g = globalThis as unknown as { FontFace?: unknown };
const originalFontFace = g.FontFace;
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');

function stubFonts() {
  const add = vi.fn();
  Object.defineProperty(document, 'fonts', { value: { add }, configurable: true });
  return add;
}

describe('ensureHostedDiagramFont', () => {
  beforeEach(() => {
    _resetForTesting();
    _resetDiagramFontStateForTesting();
  });
  afterEach(() => {
    vi.useRealTimers();
    g.FontFace = originalFontFace;
    if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
    else delete (document as unknown as { fonts?: unknown }).fonts;
  });

  it("resolves 'fallback' when FontFace is unavailable (jsdom/SSR)", async () => {
    delete g.FontFace;
    await expect(ensureHostedDiagramFont()).resolves.toBe('fallback');
    expect(getDiagramFontState()).toBe('fallback');
  });

  it("loads the hosted woff2, adds it to document.fonts and resolves 'plex'", async () => {
    const add = stubFonts();
    const ctor = vi.fn(function (this: { load: () => Promise<unknown> }) {
      this.load = vi.fn(async function (this: unknown) { return this; });
    });
    g.FontFace = ctor;

    await expect(ensureHostedDiagramFont()).resolves.toBe('plex');

    expect(ctor).toHaveBeenCalledWith(
      'IBM Plex Sans',
      "url(/assets/IBMPlexSans-Regular-Latin1-abc.woff2) format('woff2')",
      { weight: '400', style: 'normal' },
    );
    expect(add).toHaveBeenCalledTimes(1);
    expect(getDiagramFontState()).toBe('plex');
  });

  it('memoises: concurrent and later calls share one FontFace load', async () => {
    stubFonts();
    const ctor = vi.fn(function (this: { load: () => Promise<unknown> }) {
      this.load = vi.fn(async function (this: unknown) { return this; });
    });
    g.FontFace = ctor;

    const [a, b] = await Promise.all([ensureHostedDiagramFont(), ensureHostedDiagramFont()]);
    await ensureHostedDiagramFont();

    expect([a, b]).toEqual(['plex', 'plex']);
    expect(ctor).toHaveBeenCalledTimes(1);
  });

  it("resolves 'fallback' (never rejects) when load() rejects", async () => {
    const add = stubFonts();
    g.FontFace = vi.fn(function (this: { load: () => Promise<unknown> }) {
      this.load = vi.fn(() => Promise.reject(new Error('csp')));
    });
    await expect(ensureHostedDiagramFont()).resolves.toBe('fallback');
    expect(add).not.toHaveBeenCalled();
    expect(getDiagramFontState()).toBe('fallback');
  });

  it("resolves 'fallback' when the constructor throws", async () => {
    stubFonts();
    g.FontFace = vi.fn(() => { throw new Error('bad descriptor'); });
    await expect(ensureHostedDiagramFont()).resolves.toBe('fallback');
  });

  it("times out to 'fallback' when load() hangs, and a late success does not flip the state", async () => {
    vi.useFakeTimers();
    const add = stubFonts();
    let finish!: (v: unknown) => void;
    g.FontFace = vi.fn(function (this: { load: () => Promise<unknown> }) {
      this.load = vi.fn(() => new Promise((r) => { finish = r; }));
    });

    const p = ensureHostedDiagramFont();
    await vi.advanceTimersByTimeAsync(1500);
    await expect(p).resolves.toBe('fallback');
    expect(getDiagramFontState()).toBe('fallback');

    finish({});
    await vi.advanceTimersByTimeAsync(0);
    expect(add).not.toHaveBeenCalled();
  });
});
