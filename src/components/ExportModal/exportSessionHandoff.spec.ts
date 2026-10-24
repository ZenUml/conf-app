import { describe, expect, it, vi } from 'vitest';
import { openWithExportSessionHandoff } from './exportSessionHandoff';
import type { ExportSessionSnapshot } from './exportSession';

const snapshot: ExportSessionSnapshot = {
  annotations: [{
    id: 'note-1',
    type: 'note',
    position: { x: 0.2, y: 0.3 },
    end: { x: 0.2, y: 0.3 },
    text: 'Review this',
    color: '#374151',
    bgColor: 'none',
    fontSize: 14,
    thickness: 2,
    arrowType: '→',
  }],
  watermark: {
    text: 'Confidential',
    opacity: 20,
    fontSize: 24,
    color: '#9ca3af',
    position: 'diagonal',
  },
  watermarkVisible: true,
  background: 'white',
  customBgColor: '#ffffff',
};

/**
 * A stand-in for the bridge modal: `open` resolves as soon as the modal is on
 * screen — which is the whole point of these tests — and the close callback is
 * kept so a test can fire it later, the way a user's X click would.
 */
function makeDeps(overrides: Partial<Parameters<typeof openWithExportSessionHandoff>[0]> = {}) {
  const unsubscribe = vi.fn();
  let handler: ((payload?: unknown) => void) | null = null;
  let close: ((payload?: unknown) => void) | null = null;

  const deps = {
    macroUuid: 'macro-1',
    subscribe: vi.fn(async (h: (payload?: unknown) => void) => {
      handler = h;
      return unsubscribe;
    }),
    open: vi.fn(async (onClose: (payload?: unknown) => void) => {
      close = onClose;
    }),
    onSnapshot: vi.fn(),
    onClosed: vi.fn(),
    ...overrides,
  };

  return {
    deps,
    unsubscribe,
    emit: (payload?: unknown) => handler?.(payload),
    fireClose: (payload?: unknown) => close?.(payload),
  };
}

describe('openWithExportSessionHandoff', () => {
  it('keeps the listener alive after the modal has opened', async () => {
    const { deps, unsubscribe, emit } = makeDeps();

    await openWithExportSessionHandoff(deps);

    // The bridge resolves open() on open, not on close. Unsubscribing here
    // silently drops every annotation the child makes.
    expect(unsubscribe).not.toHaveBeenCalled();

    emit({ macro_uuid: 'macro-1', snapshot });
    expect(deps.onSnapshot).toHaveBeenCalledWith(snapshot);
  });

  it('disposes the listener when the modal closes, and applies its close payload', async () => {
    const { deps, unsubscribe, fireClose } = makeDeps();

    await openWithExportSessionHandoff(deps);
    fireClose({ exportSession: snapshot });

    expect(deps.onSnapshot).toHaveBeenCalledWith(snapshot);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(deps.onClosed).toHaveBeenCalledTimes(1);
  });

  it('disposes once when a close payload arrives twice', async () => {
    const { deps, unsubscribe, fireClose } = makeDeps();

    await openWithExportSessionHandoff(deps);
    fireClose({ exportSession: snapshot });
    fireClose({ exportSession: snapshot });

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('closes cleanly when the platform X gives no payload', async () => {
    const { deps, unsubscribe, fireClose } = makeDeps();

    await openWithExportSessionHandoff(deps);
    fireClose(undefined);

    expect(deps.onSnapshot).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(deps.onClosed).toHaveBeenCalledWith(undefined);
  });

  it('ignores events from another macro in the same page', async () => {
    const { deps, emit } = makeDeps();

    await openWithExportSessionHandoff(deps);
    emit({ macro_uuid: 'macro-2', snapshot });

    expect(deps.onSnapshot).not.toHaveBeenCalled();
  });

  it('disposes and rethrows when the modal fails to open', async () => {
    const failure = new Error('bridge refused');
    const { deps, unsubscribe } = makeDeps({
      open: vi.fn(async () => { throw failure; }),
    });

    await expect(openWithExportSessionHandoff(deps)).rejects.toThrow(failure);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('still opens the modal when the bridge has no events API', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { deps } = makeDeps({
      subscribe: vi.fn(async () => { throw new Error('events unavailable'); }),
    });

    await openWithExportSessionHandoff(deps);

    expect(deps.open).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
