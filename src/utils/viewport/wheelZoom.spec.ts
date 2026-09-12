import { describe, it, expect, vi } from 'vitest';
import { createZoomHintTrigger, isZoomIntent } from '@/utils/viewport/wheelZoom';

const wheel = (init: WheelEventInit) => new WheelEvent('wheel', init);

describe('isZoomIntent', () => {
  it('takes Ctrl, Cmd, and the trackpad pinch that arrives as Ctrl', () => {
    expect(isZoomIntent(wheel({ deltaY: -100, ctrlKey: true }))).toBe(true);
    expect(isZoomIntent(wheel({ deltaY: -100, metaKey: true }))).toBe(true);
  });

  it('leaves a plain wheel to the page', () => {
    expect(isZoomIntent(wheel({ deltaY: -100 }))).toBe(false);
  });
});

describe('createZoomHintTrigger', () => {
  it('waits for a sustained push, not the first tick', () => {
    const onHint = vi.fn();
    const trigger = createZoomHintTrigger(onHint);

    // One notch is someone passing through a page of diagrams.
    trigger(wheel({ deltaY: -100 }), 800);
    expect(onHint).not.toHaveBeenCalled();

    trigger(wheel({ deltaY: -100 }), 800);
    expect(onHint).toHaveBeenCalledTimes(1);
  });

  it('counts a push in either direction', () => {
    const onHint = vi.fn();
    const trigger = createZoomHintTrigger(onHint);

    trigger(wheel({ deltaY: 200 }), 800);
    expect(onHint).toHaveBeenCalledTimes(1);
  });

  it('stops telling a reader who has been told twice', () => {
    const onHint = vi.fn();
    const trigger = createZoomHintTrigger(onHint);

    for (let i = 0; i < 20; i += 1) trigger(wheel({ deltaY: -200 }), 800);

    // After two tellings they either learned it or are doing something else;
    // an overlay that keeps reappearing is worse than one that never did.
    expect(onHint).toHaveBeenCalledTimes(2);
  });
});
