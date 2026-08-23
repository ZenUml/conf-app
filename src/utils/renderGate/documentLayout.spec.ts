import { describe, it, expect, vi } from 'vitest';
import { hasLayout, awaitLayout } from './documentLayout';

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
