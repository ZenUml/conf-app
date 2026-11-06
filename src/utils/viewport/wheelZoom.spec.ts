import { describe, it, expect, vi } from 'vitest';
import { createGestureGate, createZoomHintTrigger, isZoomIntent } from '@/utils/viewport/wheelZoom';

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

  it('forgets a notch the reader has moved on from', () => {
    const onHint = vi.fn();
    let clock = 0;
    const trigger = createZoomHintTrigger(onHint, { now: () => clock });

    // Half a push, then the reader goes and does something else for a while.
    trigger(wheel({ deltaY: -100 }), 800);
    clock += 5000;
    trigger(wheel({ deltaY: -100 }), 800);

    // Two passes-through are not a sustained push, however long apart: without
    // the decay they would add up to the threshold and hint at someone who was
    // never asking.
    expect(onHint).not.toHaveBeenCalled();

    // A push that really is continuous still gets there.
    trigger(wheel({ deltaY: -100 }), 800);
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

  it('does not spend a telling on a hint that only extended one already up', () => {
    // false means "the overlay was already on screen": the reader saw one
    // message, so the budget of two should be untouched.
    const onHint = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const trigger = createZoomHintTrigger(onHint);

    for (let i = 0; i < 20; i += 1) trigger(wheel({ deltaY: -200 }), 800);

    expect(onHint).toHaveBeenCalledTimes(3);
  });
});

describe('createGestureGate', () => {
  /** A hand-cranked clock: what this gate does is entirely about time. */
  function clock(start = 1_000) {
    let t = start;
    return { now: () => t, tick: (ms: number) => { t += ms; } };
  }

  it('opens on the first step of a gesture and shuts for the rest', () => {
    const c = clock();
    const startsGesture = createGestureGate({ now: c.now });

    expect(startsGesture()).toBe(true);
    // The dozen callbacks of one continuous scroll are one act of intent.
    for (let i = 0; i < 12; i += 1) {
      c.tick(30);
      expect(startsGesture()).toBe(false);
    }
  });

  it('keeps one long push as one gesture, however far it travels', () => {
    const c = clock();
    const startsGesture = createGestureGate({ now: c.now });

    startsGesture();
    // Each step restarts the quiet window, so steady scrolling never re-opens.
    for (let i = 0; i < 40; i += 1) {
      c.tick(400);
      expect(startsGesture()).toBe(false);
    }
  });

  it('opens again once the wheel has gone quiet', () => {
    const c = clock();
    const startsGesture = createGestureGate({ now: c.now });

    startsGesture();
    c.tick(600);

    // A second deliberate scroll is a second zoom, and should count as one.
    expect(startsGesture()).toBe(true);
  });
});
