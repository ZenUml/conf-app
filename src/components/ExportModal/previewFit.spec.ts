import { describe, expect, it } from 'vitest';
import { calculatePreviewFit } from './previewFit';

describe('calculatePreviewFit', () => {
  it('scales the preview up to use the available stage while preserving its aspect ratio', () => {
    const fit = calculatePreviewFit(964, 493, 452, 202);
    expect(fit.scale).toBeCloseTo(2.062);
    expect(fit.width).toBe(932);
    expect(fit.height).toBeCloseTo(416.513);
  });

  it('scales a large preview down to fit both dimensions', () => {
    expect(calculatePreviewFit(800, 500, 1600, 900)).toEqual({
      scale: 0.48,
      width: 768,
      height: 432,
    });
  });

  it('returns an unscaled safe fallback before the stage is measured', () => {
    expect(calculatePreviewFit(0, 0, 452, 202)).toEqual({ scale: 1, width: 452, height: 202 });
  });

  it('keeps a tiny measured stage visible instead of scaling the preview to zero', () => {
    expect(calculatePreviewFit(20, 20, 452, 202).scale).toBeGreaterThan(0);
  });
});
