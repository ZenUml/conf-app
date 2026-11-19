import { describe, it, expect, vi } from 'vitest';
import {
  alignOf, axisOffset, classifyWheel, clampScale, createGestureGate, isZoomIntent, zoomLimits, zoomRoom,
} from '@/utils/viewport/wheelZoom';

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

describe('classifyWheel', () => {
  // Fullscreen and the editor preview have no page behind the diagram, so a
  // plain wheel zooms there. The page viewer gives a plain wheel to the page.
  const zooms = { plainWheelZooms: true, pageHeight: 800 };
  const page = { plainWheelZooms: false, pageHeight: 800 };

  it.each([
    // surface, event, expected kind, expected modifier
    ['fullscreen', { deltaY: -100 }, 'zoom', 'none'],
    ['fullscreen', { deltaY: 100 }, 'zoom', 'none'],
    ['fullscreen', { deltaY: -100, ctrlKey: true }, 'zoom', 'ctrl_meta'],
    ['fullscreen', { deltaY: -3, ctrlKey: true }, 'zoom', 'ctrl_meta'],
    ['fullscreen', { deltaY: 100, shiftKey: true }, 'pan', undefined],
    ['fullscreen', { deltaX: 40, deltaY: 5 }, 'pan', undefined],
    ['page', { deltaY: -100 }, 'pass', undefined],
    ['page', { deltaY: 100, shiftKey: true }, 'pass', undefined],
    ['page', { deltaX: 40, deltaY: 5 }, 'pass', undefined],
    ['page', { deltaY: -100, ctrlKey: true }, 'zoom', 'ctrl_meta'],
    ['page', { deltaY: -100, metaKey: true }, 'zoom', 'ctrl_meta'],
  ] as const)('%s %o -> %s', (surface, init, kind, modifier) => {
    const action = classifyWheel(wheel(init), surface === 'page' ? page : zooms);
    expect(action.kind).toBe(kind);
    if (action.kind === 'zoom') expect(action.modifier).toBe(modifier);
  });

  it('zooms in on wheel up and out on wheel down', () => {
    const up = classifyWheel(wheel({ deltaY: -100 }), zooms);
    const down = classifyWheel(wheel({ deltaY: 100 }), zooms);
    expect(up.kind === 'zoom' && up.factor).toBeCloseTo(Math.exp(0.1));
    expect(down.kind === 'zoom' && down.factor).toBeCloseTo(Math.exp(-0.1));
  });

  it('treats one mouse notch the same with or without Ctrl', () => {
    const plain = classifyWheel(wheel({ deltaY: -100 }), zooms);
    const ctrl = classifyWheel(wheel({ deltaY: -100, ctrlKey: true }), zooms);
    expect(plain.kind === 'zoom' && plain.factor).toBeCloseTo(ctrl.kind === 'zoom' ? ctrl.factor : 0);
  });

  it('gives a trackpad pinch (small Ctrl delta) a larger factor per pixel', () => {
    const pinch = classifyWheel(wheel({ deltaY: -8, ctrlKey: true }), zooms);
    const scroll = classifyWheel(wheel({ deltaY: -8 }), zooms);
    expect(pinch.kind === 'zoom' && pinch.factor).toBeCloseTo(Math.exp(0.08));
    expect(scroll.kind === 'zoom' && scroll.factor).toBeCloseTo(Math.exp(0.016));
  });

  it('caps one event at 1.25x in and 0.75x out', () => {
    const fling = classifyWheel(wheel({ deltaY: -39, ctrlKey: true }), zooms);
    const out = classifyWheel(wheel({ deltaY: 39, ctrlKey: true }), zooms);
    expect(fling.kind === 'zoom' && fling.factor).toBeLessThanOrEqual(1.25);
    expect(out.kind === 'zoom' && out.factor).toBeGreaterThanOrEqual(0.75);
  });

  it('normalises Firefox line deltas to pixels', () => {
    const lines = classifyWheel(wheel({ deltaY: -3, deltaMode: 1 }), zooms);
    expect(lines.kind === 'zoom' && lines.factor).toBeCloseTo(Math.exp(48 * 0.002));
  });

  it('pans the content against the scroll direction', () => {
    const shift = classifyWheel(wheel({ deltaY: 100, shiftKey: true }), zooms);
    expect(shift).toEqual({ kind: 'pan', dx: -100, dy: 0 });
    const sideways = classifyWheel(wheel({ deltaX: 40, deltaY: 5 }), zooms);
    expect(sideways).toEqual({ kind: 'pan', dx: -40, dy: -5 });
  });
});

describe('zoomLimits', () => {
  it.each([
    // opening scale (1 = natural size) -> floor, ceiling
    [0.15, 0.15, 1],
    [0.86, 0.86, 1],
    [1, 1, 1],
    [1.4, 1, 1.4],
  ])('opens at %s -> [%s, %s]', (open, min, max) => {
    expect(zoomLimits(open)).toEqual({ min, max });
  });

  it('clamps into the range', () => {
    const limits = zoomLimits(0.5);
    expect(clampScale(0.2, limits)).toBe(0.5);
    expect(clampScale(3, limits)).toBe(1);
    expect(clampScale(0.7, limits)).toBe(0.7);
  });
});

describe('zoomRoom', () => {
  it.each([
    // scale, opening scale -> can zoom in, can zoom out
    [0.5, 0.5, true, false],
    [0.7, 0.5, true, true],
    [1, 0.5, false, true],
    // A diagram that opens at natural size has nowhere to go.
    [1, 1, false, false],
    // Sub-pixel rounding at a limit still counts as at the limit.
    [0.9999999, 0.5, false, true],
    [0.5000001, 0.5, true, false],
  ])('scale %s, opened at %s -> in %s, out %s', (scale, open, canIn, canOut) => {
    expect(zoomRoom(scale, zoomLimits(open))).toEqual({ in: canIn, out: canOut });
  });
});

describe('axisOffset', () => {
  it.each([
    // offset, content, box, align -> offset after the limit
    // Content larger than the box: an edge never comes inside the box edge.
    [50, 1000, 400, 0.5, 0],
    [-900, 1000, 400, 0.5, -600],
    [-300, 1000, 400, 0.5, -300],
    // Content smaller than the box: held where it opened, scaled with its size.
    [80, 200, 400, 0.5, 100],
    [80, 200, 400, 0, 0],
    [-500, 300, 400, 1, 100],
  ])('offset %s, content %s, box %s, align %s -> %s', (offset, content, box, align, expected) => {
    expect(axisOffset(offset, content, box, align)).toBe(expected);
  });
});

describe('alignOf', () => {
  it('reads where a smaller diagram sits in its box, 0 left to 1 right', () => {
    expect(alignOf(100, 200, 400)).toBe(0.5);
    expect(alignOf(0, 200, 400)).toBe(0);
    expect(alignOf(200, 200, 400)).toBe(1);
  });

  it('centres when the content is not smaller than the box', () => {
    expect(alignOf(-50, 500, 400)).toBe(0.5);
    expect(alignOf(0, 400, 400)).toBe(0.5);
  });
});
