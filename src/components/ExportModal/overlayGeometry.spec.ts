import { describe, it, expect } from 'vitest';
import {
  EDGE_PADDING,
  computeArrowheadPath,
  computeNotePosition,
  computeCalloutPath,
} from './overlayGeometry';

describe('computeArrowheadPath', () => {
  it('builds a closed 4-point path (M, 3×L, Z) whose middle point is the exact tip', () => {
    const path = computeArrowheadPath(100, 50, 0, 2);
    expect(path).toBe('M 90.2 50 L 86 45 L 100 50 L 86 55 Z');
  });

  it('rotates the same shape when the angle changes', () => {
    const path = computeArrowheadPath(100, 50, Math.PI / 2, 6);
    expect(path).toBe('M 100 34.6 L 111 28 L 100 50 L 89 28 Z');
  });
});

describe('computeNotePosition', () => {
  const width = 600;
  const height = 400;
  const fontSize = 14;

  it.each([
    ['top-left', { x: 12, y: 26, anchor: 'start' }],
    ['top-center', { x: 300, y: 26, anchor: 'middle' }],
    ['top-right', { x: 588, y: 26, anchor: 'end' }],
    ['bottom-left', { x: 12, y: 388, anchor: 'start' }],
    ['bottom-center', { x: 300, y: 388, anchor: 'middle' }],
    ['bottom-right', { x: 588, y: 388, anchor: 'end' }],
  ] as const)('resolves %s using the default EDGE_PADDING', (position, expected) => {
    expect(computeNotePosition(position, width, height, fontSize)).toEqual(expected);
  });

  it('honors a caller-supplied padding instead of the default EDGE_PADDING', () => {
    expect(computeNotePosition('bottom-center', width, height, fontSize, 20)).toEqual({
      x: 300,
      y: 380,
      anchor: 'middle',
    });
    expect(EDGE_PADDING).toBe(12);
  });
});

describe('computeCalloutPath', () => {
  it('draws a plain rounded rect when there is no tip position', () => {
    const path = computeCalloutPath(300, 200, 1, null);
    expect(path).toBe(
      'M 245 180 L 355 180 Q 360 180 360 185 L 360 215 Q 360 220 355 220 L 245 220 Q 240 220 240 215 L 240 185 Q 240 180 245 180 Z',
    );
  });

  it('inserts a tail toward the tip position when one is given', () => {
    const path = computeCalloutPath(300, 200, 1, { x: 300, y: 260 });
    expect(path).toBe(
      'M 245 180 L 355 180 Q 360 180 360 185 L 360 215 Q 360 220 355 220 L 308 220 L 300 260 L 292 220 L 245 220 Q 240 220 240 215 L 240 185 Q 240 180 245 180 Z',
    );
  });
});

describe('computeCalloutPath — the box follows its content', () => {
  // The box was a fixed 120x40 (times scale) regardless of what it held, so
  // typing a longer label or raising the font size pushed the text straight out
  // of the chip and onto the diagram it was labelling — in the preview AND in
  // the exported PNG, which draws from this same function.
  function boxWidth(path: string): number {
    const xs = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    // x coordinates are every other number in this path's command stream
    const evens = xs.filter((_, i) => i % 2 === 0);
    return Math.round(Math.max(...evens) - Math.min(...evens));
  }
  function boxHeight(path: string): number {
    const xs = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    const odds = xs.filter((_, i) => i % 2 === 1);
    return Math.round(Math.max(...odds) - Math.min(...odds));
  }

  it('widens for a wider text measurement', () => {
    const narrow = computeCalloutPath(200, 100, 1, null, { textWidth: 60, fontSize: 14 });
    const wide = computeCalloutPath(200, 100, 1, null, { textWidth: 420, fontSize: 14 });
    expect(boxWidth(wide)).toBeGreaterThan(boxWidth(narrow));
    expect(boxWidth(wide)).toBeGreaterThanOrEqual(420);
  });

  it('grows taller with the font size', () => {
    const small = computeCalloutPath(200, 100, 1, null, { textWidth: 100, fontSize: 12 });
    const large = computeCalloutPath(200, 100, 1, null, { textWidth: 100, fontSize: 28 });
    expect(boxHeight(large)).toBeGreaterThan(boxHeight(small));
    expect(boxHeight(large)).toBeGreaterThanOrEqual(28);
  });

  it('keeps a minimum size for an empty or unmeasured label', () => {
    const empty = computeCalloutPath(200, 100, 1, null, { textWidth: 0, fontSize: 14 });
    expect(boxWidth(empty)).toBeGreaterThanOrEqual(60);
    expect(boxHeight(empty)).toBeGreaterThanOrEqual(28);
  });

  it('scales with the export scale factor, as before', () => {
    const at1 = computeCalloutPath(200, 100, 1, null, { textWidth: 100, fontSize: 14 });
    const at2 = computeCalloutPath(400, 200, 2, null, { textWidth: 200, fontSize: 28 });
    expect(boxWidth(at2)).toBeCloseTo(boxWidth(at1) * 2, -1);
  });

  it('falls back to the old fixed box when no content is measured', () => {
    const legacy = computeCalloutPath(200, 100, 1, null);
    expect(boxWidth(legacy)).toBe(120);
    expect(boxHeight(legacy)).toBe(40);
  });
});
