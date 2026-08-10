import { describe, it, expect } from 'vitest';
import { computeCardLayout, CARD_WIDTH, CARD_HEIGHT, TALL_THRESHOLD } from './shareCardImage';

// Real diagram dimensions captured for the framing demo (node-targeted, the
// exact output html-to-image produces):
//   tall     266 x 498  (0.53:1) — a login request/response flow
//   moderate 422 x 300  (1.41:1) — the checkout flow
//   wide     822 x 338  (2.43:1) — an 8-participant fan-out
describe('computeCardLayout — shape-aware Slack card framing', () => {
  it('wide (2.43:1) → contain: whole diagram inside the card, centered, aspect preserved', () => {
    const l = computeCardLayout(822, 338);
    expect(l.mode).toBe('contain');
    // fully inside — nothing cropped
    expect(l.drawX).toBeGreaterThanOrEqual(0);
    expect(l.drawY).toBeGreaterThanOrEqual(0);
    expect(l.drawX + l.drawW).toBeLessThanOrEqual(CARD_WIDTH + 1e-6);
    expect(l.drawY + l.drawH).toBeLessThanOrEqual(CARD_HEIGHT + 1e-6);
    // no distortion
    expect(l.drawW / l.drawH).toBeCloseTo(822 / 338, 3);
    // centered
    expect(l.drawX).toBeCloseTo((CARD_WIDTH - l.drawW) / 2, 3);
    expect(l.drawY).toBeCloseTo((CARD_HEIGHT - l.drawH) / 2, 3);
  });

  it('moderate (1.41:1) → contain: whole diagram inside, aspect preserved', () => {
    const l = computeCardLayout(422, 300);
    expect(l.mode).toBe('contain');
    expect(l.drawX + l.drawW).toBeLessThanOrEqual(CARD_WIDTH + 1e-6);
    expect(l.drawY + l.drawH).toBeLessThanOrEqual(CARD_HEIGHT + 1e-6);
    expect(l.drawW / l.drawH).toBeCloseTo(422 / 300, 3);
  });

  it('tall (0.53:1) → top-anchor: fills card width, anchored top, overflows the bottom', () => {
    const l = computeCardLayout(266, 498);
    expect(l.mode).toBe('top-anchor');
    expect(l.drawX).toBe(0);
    expect(l.drawY).toBe(0);
    expect(l.drawW).toBe(CARD_WIDTH);                // full width → participants + opening stay big
    expect(l.drawH).toBeGreaterThan(CARD_HEIGHT);    // taller than the card → the tail is cropped (teaser)
    expect(l.drawW / l.drawH).toBeCloseTo(266 / 498, 3); // no distortion
  });

  it('the tall/contain boundary sits at TALL_THRESHOLD', () => {
    expect(TALL_THRESHOLD).toBe(0.8);
    // just below → top-anchor; at/above → contain
    expect(computeCardLayout(79, 100).mode).toBe('top-anchor'); // 0.79
    expect(computeCardLayout(80, 100).mode).toBe('contain');    // 0.80
    expect(computeCardLayout(81, 100).mode).toBe('contain');    // 0.81
  });

  it('a square diagram (1:1) → contain (padding never lets it touch the edge)', () => {
    const l = computeCardLayout(400, 400);
    expect(l.mode).toBe('contain');
    expect(l.drawW).toBeCloseTo(l.drawH, 6); // square stays square
    expect(l.drawY).toBeGreaterThan(0);      // top/bottom letterboxed on white
  });

  it('the output is always exactly the card ratio (~1.91:1)', () => {
    for (const [w, h] of [[266, 498], [422, 300], [822, 338], [50, 900], [2000, 100]]) {
      const l = computeCardLayout(w, h);
      expect(l.targetW).toBe(CARD_WIDTH);
      expect(l.targetH).toBe(CARD_HEIGHT);
    }
  });

  it('rejects non-positive source dimensions', () => {
    expect(() => computeCardLayout(0, 100)).toThrow();
    expect(() => computeCardLayout(100, 0)).toThrow();
    expect(() => computeCardLayout(-5, 100)).toThrow();
  });

  it('honours option overrides (target size, threshold, padding)', () => {
    const l = computeCardLayout(300, 300, { targetW: 100, targetH: 100, tallThreshold: 0.5, pad: 0 });
    expect(l.targetW).toBe(100);
    expect(l.targetH).toBe(100);
    expect(l.mode).toBe('contain');      // 1.0 >= 0.5
    expect(l.drawW).toBeCloseTo(100, 6); // no padding → fills
  });
});
