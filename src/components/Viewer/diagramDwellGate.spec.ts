import { describe, expect, it } from 'vitest';
import { DWELL_GATE_THRESHOLDS, MIN_VISIBLE_PX, qualifiesForDwell, type DwellGateEntry } from './diagramDwellGate';

function entry(overrides: Partial<{
  isIntersecting: boolean;
  intersectionHeight: number;
  boundingHeight: number;
}> = {}): DwellGateEntry {
  const { isIntersecting = true, intersectionHeight = 0, boundingHeight = 0 } = overrides;
  return {
    isIntersecting,
    intersectionRect: { height: intersectionHeight } as DOMRectReadOnly,
    boundingClientRect: { height: boundingHeight } as DOMRectReadOnly,
  };
}

describe('qualifiesForDwell', () => {
  it('never qualifies while the observer reports not intersecting, regardless of rect sizes', () => {
    expect(qualifiesForDwell(entry({
      isIntersecting: false,
      intersectionHeight: 3000,
      boundingHeight: 3000,
    }))).toBe(false);
  });

  it('applies the half-height rule to a short diagram: 149px short of half, 150px meets it', () => {
    // boundingClientRect.height 300 -> needed = min(200, 150) = 150
    expect(qualifiesForDwell(entry({ boundingHeight: 300, intersectionHeight: 149 }))).toBe(false);
    expect(qualifiesForDwell(entry({ boundingHeight: 300, intersectionHeight: 150 }))).toBe(true);
  });

  it('caps a tall diagram at the fixed MIN_VISIBLE_PX band, not half its height', () => {
    // boundingClientRect.height 3000 -> half is 1500, so the fixed 200px band binds
    expect(qualifiesForDwell(entry({ boundingHeight: 3000, intersectionHeight: 199 }))).toBe(false);
    expect(qualifiesForDwell(entry({ boundingHeight: 3000, intersectionHeight: MIN_VISIBLE_PX }))).toBe(true);
  });

  it('qualifies a tall diagram at ratio 0.23, which a threshold: 0.5 rule could never satisfy', () => {
    // This is the regression the change exists for: the old rule observed the
    // footer with `threshold: 0.5`, so a 3000px diagram capped at ratio 0.23 in
    // a typical viewport would never cross 0.5 and would never dwell-qualify.
    const boundingHeight = 3000;
    const intersectionHeight = boundingHeight * 0.23; // 690px, well under half
    expect(intersectionHeight / boundingHeight).toBeLessThan(0.5);
    expect(qualifiesForDwell(entry({ boundingHeight, intersectionHeight }))).toBe(true);
  });

  it('still qualifies against the old 29px footer target when only 15px is visible', () => {
    // The gate reads only the observed element's own rects, so it works
    // unchanged on the old footer target when diagramHost is absent.
    // boundingClientRect.height 29 -> needed = min(200, 14.5) = 14.5
    expect(qualifiesForDwell(entry({ boundingHeight: 29, intersectionHeight: 14 }))).toBe(false);
    expect(qualifiesForDwell(entry({ boundingHeight: 29, intersectionHeight: 15 }))).toBe(true);
  });

  it('exposes the documented threshold list used to drive the observer', () => {
    expect(DWELL_GATE_THRESHOLDS).toEqual([0, 0.05, 0.1, 0.25, 0.5, 0.75, 1]);
  });
});
