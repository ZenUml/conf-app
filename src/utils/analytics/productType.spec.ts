import { describe, it, expect } from 'vitest';
import { normalizeProductType } from './productType';

describe('normalizeProductType', () => {
  it('accepts asyncapi as a product type in its own right', () => {
    expect(normalizeProductType('asyncapi')).toBe('asyncapi');
  });

  it.each(['lite', 'full', 'diagramly'] as const)('passes %s through unchanged', (raw) => {
    expect(normalizeProductType(raw)).toBe(raw);
  });

  it('falls back to full when the build set no product type', () => {
    expect(normalizeProductType(undefined)).toBe('full');
  });

  it('falls back to full for a value no build produces', () => {
    expect(normalizeProductType('not-a-variant')).toBe('full');
  });
});
