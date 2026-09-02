import { describe, expect, it } from 'vitest';
import { normalizeGateVersion } from './domain';

describe('normalizeGateVersion', () => {
  it('recognizes gate version 2 in both numeric and string form', () => {
    expect(normalizeGateVersion(2)).toBe(2);
    expect(normalizeGateVersion('2')).toBe(2);
  });

  it('defaults everything else — including a missing value, 1, and garbage — to 1', () => {
    expect(normalizeGateVersion(undefined)).toBe(1);
    expect(normalizeGateVersion(null)).toBe(1);
    expect(normalizeGateVersion(1)).toBe(1);
    expect(normalizeGateVersion(0)).toBe(1);
    expect(normalizeGateVersion(99)).toBe(1);
    expect(normalizeGateVersion('abc')).toBe(1);
    expect(normalizeGateVersion({})).toBe(1);
  });
});
