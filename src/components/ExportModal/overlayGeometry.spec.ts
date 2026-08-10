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
