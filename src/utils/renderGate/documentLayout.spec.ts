import { describe, it, expect, vi } from 'vitest';
import { hasLayout, awaitLayout, hasSvgTextLayout, awaitSvgTextLayout } from './documentLayout';

// happy-dom reports no client rects, so build the document stand-ins by hand.
const docWith = (rectCount: number) => {
  let count = rectCount;
  return {
    doc: {
      body: {
        getClientRects: () => new Array(count).fill({}),
      },
    } as unknown as Document,
    layOut: () => {
      count = 1;
    },
  };
};

describe('hasLayout', () => {
  it('reports false when body has no client rects', () => {
    expect(hasLayout(docWith(0).doc)).toBe(false);
  });

  it('reports true when body has a client rect', () => {
    expect(hasLayout(docWith(1).doc)).toBe(true);
  });

  it('fails open when getClientRects is unavailable', () => {
    expect(hasLayout({ body: {} } as unknown as Document)).toBe(true);
  });

  it('fails open when getClientRects throws', () => {
    const doc = {
      body: {
        getClientRects: () => {
          throw new Error('detached');
        },
      },
    } as unknown as Document;
    expect(hasLayout(doc)).toBe(true);
  });
});

describe('awaitLayout', () => {
  it('resolves immediately when layout is already present', async () => {
    const observe = vi.fn();
    await expect(
      awaitLayout({
        doc: docWith(1).doc,
        ResizeObserverCtor: vi.fn(() => ({ observe, disconnect: vi.fn() })) as never,
      }),
    ).resolves.toBe(true);
    expect(observe).not.toHaveBeenCalled();
  });

  it('resolves true once the body gains a box', async () => {
    const { doc, layOut } = docWith(0);
    let fire: () => void = () => {};
    const ResizeObserverCtor = vi.fn((cb: () => void) => {
      fire = cb;
      return { observe: vi.fn(), disconnect: vi.fn() };
    });

    const pending = awaitLayout({ doc, ResizeObserverCtor: ResizeObserverCtor as never });
    // A resize that leaves the body still unlaid-out must not resolve the wait.
    fire();
    layOut();
    fire();

    await expect(pending).resolves.toBe(true);
  });

  it('resolves false when the box never appears before the timeout', async () => {
    const { doc } = docWith(0);
    const disconnect = vi.fn();
    const pending = awaitLayout({
      doc,
      timeoutMs: 5,
      ResizeObserverCtor: vi.fn(() => ({ observe: vi.fn(), disconnect })) as never,
    });
    await expect(pending).resolves.toBe(false);
    expect(disconnect).toHaveBeenCalled();
  });

  it('fails open when ResizeObserver is unavailable', async () => {
    await expect(
      awaitLayout({ doc: docWith(0).doc, ResizeObserverCtor: undefined }),
    ).resolves.toBe(true);
  });

  it('fails open when observing throws', async () => {
    const ResizeObserverCtor = vi.fn(() => ({
      observe: () => {
        throw new Error('observe failed');
      },
      disconnect: vi.fn(),
    }));
    await expect(
      awaitLayout({ doc: docWith(0).doc, ResizeObserverCtor: ResizeObserverCtor as never }),
    ).resolves.toBe(true);
  });
});

const svgDocWithBox = (readBox: () => { width: number; height: number }) => {
  const remove = vi.fn();
  const text = {
    textContent: '',
    getBBox: readBox,
  };
  const svg = {
    style: { cssText: '' },
    append: vi.fn(),
    remove,
  };
  return {
    doc: {
      body: { append: vi.fn() },
      createElementNS: vi.fn((_namespace: string, tag: string) => tag === 'svg' ? svg : text),
    } as unknown as Document,
    remove,
  };
};

describe('hasSvgTextLayout', () => {
  it('reports false when Chromium gives SVG text a zero-sized box', () => {
    const { doc, remove } = svgDocWithBox(() => ({ width: 0, height: 0 }));
    expect(hasSvgTextLayout(doc)).toBe(false);
    expect(remove).toHaveBeenCalled();
  });

  it('reports true when SVG text can be measured', () => {
    const { doc, remove } = svgDocWithBox(() => ({ width: 24, height: 12 }));
    expect(hasSvgTextLayout(doc)).toBe(true);
    expect(remove).toHaveBeenCalled();
  });
});

describe('awaitSvgTextLayout', () => {
  it('keeps waiting past a failed probe and resolves only when SVG text is measurable', async () => {
    vi.useFakeTimers();
    let ready = false;
    const { doc } = svgDocWithBox(() => ready
      ? { width: 24, height: 12 }
      : { width: 0, height: 0 });

    const pending = awaitSvgTextLayout({
      doc,
      pollMs: 100,
      ResizeObserverCtor: undefined,
    });
    await vi.advanceTimersByTimeAsync(500);
    ready = true;
    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toBe(true);
    vi.useRealTimers();
  });

  it('stops waiting when the caller is aborted', async () => {
    vi.useFakeTimers();
    const { doc } = svgDocWithBox(() => ({ width: 0, height: 0 }));
    const controller = new AbortController();
    const pending = awaitSvgTextLayout({
      doc,
      signal: controller.signal,
      pollMs: 100,
      ResizeObserverCtor: undefined,
    });

    controller.abort();

    await expect(pending).resolves.toBe(false);
    vi.useRealTimers();
  });
});
