import { describe, expect, it, vi } from 'vitest';
import { createFullscreenObserver } from './observer';

describe('fullscreen observer', () => {
  it('only accepts its own session and reports a close once', async () => {
    let time = 1000;
    const doc = new EventTarget() as Document;
    Object.defineProperty(doc, 'visibilityState', { value: 'visible', configurable: true });
    const win = new EventTarget() as Window;
    const emit = vi.fn().mockResolvedValue(undefined);
    const observer = createFullscreenObserver({ session: { id: 'one', startedAt: time, entryPoint: 'page_view' }, doc, win, emit, now: () => time });
    time = 2000; observer.receive({ sessionId: 'other', phase: 'diagram', ready: true });
    time = 3000; observer.receive({ sessionId: 'one', phase: 'diagram', ready: true });
    time = 4000; await observer.close('unknown'); await observer.close('unknown');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ fullscreen_modal_duration_ms: 3000, fullscreen_diagram_duration_ms: 1000, fullscreen_visible_duration_ms: 1000 }));
  });
  it('treats pagehide as best effort and removes listeners', async () => {
    let time = 0;
    const doc = new EventTarget() as Document;
    Object.defineProperty(doc, 'visibilityState', { value: 'hidden', configurable: true });
    const win = new EventTarget() as Window;
    const emit = vi.fn().mockResolvedValue(undefined);
    const observer = createFullscreenObserver({ session: { id: 'one', startedAt: 0, entryPoint: 'export' }, doc, win, emit, now: () => time });
    time = 500; win.dispatchEvent(new Event('pagehide')); await observer.close('unknown');
    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ fullscreen_close_reason: 'page_unload', fullscreen_close_delivery: 'best_effort' }));
  });
});
