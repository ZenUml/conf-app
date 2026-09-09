import { describe, it, expect } from 'vitest';
import {
  MAX_SCALE,
  MIN_SCALE,
  ZOOM_STEP,
  clampPan,
  clampScale,
  formatZoomLabel,
  panAfterZoom,
  roundScale,
  sameScale,
  stepScale,
} from './zoom';

describe('clampScale', () => {
  it('holds the ladder between its floor and ceiling', () => {
    expect(clampScale(9, 1)).toBe(MAX_SCALE);
    expect(clampScale(0.01, 1)).toBe(MIN_SCALE);
    expect(clampScale(1.5, 1)).toBe(1.5);
  });

  // The shrunk-to-fit case: a 6000px-wide diagram in a 560px column fits at
  // 0.09, below the ladder floor. Clamping to the floor would magnify the
  // diagram on load, which is not a zoom control, it is a bug.
  it('never clamps a diagram above its own fit scale', () => {
    expect(clampScale(0.09, 0.09)).toBe(0.09);
    expect(clampScale(0.05, 0.09)).toBe(0.09);
  });
});

describe('stepScale', () => {
  it('multiplies and divides by one step', () => {
    expect(stepScale(1, 1, 1)).toBeCloseTo(ZOOM_STEP);
    expect(stepScale(ZOOM_STEP, -1, 0.5)).toBeCloseTo(1);
  });

  it('stops at the ends instead of running past them', () => {
    expect(stepScale(MAX_SCALE, 1, 1)).toBe(MAX_SCALE);
    expect(stepScale(MIN_SCALE, -1, 1)).toBe(MIN_SCALE);
  });

  // Without the snap the fit level is unreachable from the buttons.
  it('lands exactly on the fit scale when a step would cross it', () => {
    expect(stepScale(0.4 * ZOOM_STEP, -1, 0.4)).toBe(0.4);
    expect(stepScale(0.4 / ZOOM_STEP, 1, 0.4)).toBe(0.4);
  });

  it('steps past the fit scale once it is standing on it', () => {
    expect(stepScale(0.4, 1, 0.4)).toBeCloseTo(0.5);
    expect(stepScale(0.4, -1, 0.4)).toBeCloseTo(0.32);
  });
});

describe('clampPan', () => {
  const viewport = { width: 500, height: 400 };

  it('centres an axis whose content is smaller than the viewport', () => {
    const pan = clampPan({ x: -999, y: 999 }, viewport, { width: 300, height: 200 });
    expect(pan).toEqual({ x: 100, y: 100 });
  });

  it('lets an overflowing axis move only as far as its own edges', () => {
    const content = { width: 1500, height: 1200 };
    expect(clampPan({ x: 50, y: 50 }, viewport, content)).toEqual({ x: 0, y: 0 });
    expect(clampPan({ x: -5000, y: -5000 }, viewport, content)).toEqual({ x: -1000, y: -800 });
    expect(clampPan({ x: -200, y: -300 }, viewport, content)).toEqual({ x: -200, y: -300 });
  });

  it('clamps the two axes independently', () => {
    // Wide and short: x overflows and is clamped to its edge, y is centred.
    const pan = clampPan({ x: -900, y: -900 }, viewport, { width: 1500, height: 200 });
    expect(pan).toEqual({ x: -900, y: 100 });
  });
});

describe('panAfterZoom', () => {
  it('holds the anchored point still', () => {
    const pan = { x: 0, y: 0 };
    const anchor = { x: 250, y: 200 };
    const after = panAfterZoom(pan, anchor, 1, 2);
    // The content point drawn under the anchor before the zoom is still drawn
    // under it after: pan + c*k is unchanged for c = (anchor - pan) / k.
    const contentPoint = { x: (anchor.x - pan.x) / 1, y: (anchor.y - pan.y) / 1 };
    expect(after.x + contentPoint.x * 2).toBeCloseTo(anchor.x);
    expect(after.y + contentPoint.y * 2).toBeCloseTo(anchor.y);
  });

  it('is a no-op when the scale does not change', () => {
    expect(panAfterZoom({ x: -30, y: -40 }, { x: 10, y: 10 }, 2, 2)).toEqual({ x: -30, y: -40 });
  });

  it('reverses cleanly, so zoom in then out returns to where it started', () => {
    const start = { x: -120, y: -60 };
    const anchor = { x: 300, y: 150 };
    const inThen = panAfterZoom(start, anchor, 1, ZOOM_STEP);
    const outAgain = panAfterZoom(inThen, anchor, ZOOM_STEP, 1);
    expect(outAgain.x).toBeCloseTo(start.x);
    expect(outAgain.y).toBeCloseTo(start.y);
  });
});

describe('labels and rounding', () => {
  it('shows the natural scale as a whole-number percentage', () => {
    expect(formatZoomLabel(1)).toBe('100%');
    expect(formatZoomLabel(0.284)).toBe('28%');
    expect(formatZoomLabel(2.5)).toBe('250%');
  });

  it('rounds analytics scales to two decimals', () => {
    expect(roundScale(0.28437)).toBe(0.28);
    expect(roundScale(1.9531)).toBe(1.95);
  });

  it('treats ladder float noise as the same level', () => {
    expect(sameScale(0.4, (0.4 * ZOOM_STEP) / ZOOM_STEP)).toBe(true);
    expect(sameScale(0.4, 0.5)).toBe(false);
  });
});
