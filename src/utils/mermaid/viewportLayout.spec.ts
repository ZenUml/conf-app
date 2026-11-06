import { describe, expect, it } from 'vitest';
import { hasSvgLayout } from './viewportLayout';

describe('hasSvgLayout', () => {
  it.each([
    { width: 0, height: 0 },
    { width: 100, height: 0 },
    { width: 0, height: 100 },
  ])('rejects an SVG before it has two-dimensional layout: %o', (rect) => {
    expect(hasSvgLayout(rect)).toBe(false);
  });

  it('accepts a laid-out SVG', () => {
    expect(hasSvgLayout({ width: 100, height: 50 })).toBe(true);
  });
});
