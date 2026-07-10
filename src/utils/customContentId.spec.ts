import { describe, it, expect } from 'vitest';
import { isValidCustomContentId } from './customContentId';

describe('isValidCustomContentId (conf-app#320)', () => {
  it('accepts real numeric custom-content ids', () => {
    expect(isValidCustomContentId('53696004924')).toBe(true);
    expect(isValidCustomContentId('123')).toBe(true);
    expect(isValidCustomContentId(456)).toBe(true);
  });

  it('accepts non-sentinel string ids (real ids are opaque to this guard)', () => {
    // The guard rejects poisoned shapes, not "non-numeric" — test fixtures and
    // any legitimately non-numeric id must still pass.
    expect(isValidCustomContentId('new-id')).toBe(true);
  });

  it('rejects the String(undefined) / String(null) poison from a broken save', () => {
    expect(isValidCustomContentId('undefined')).toBe(false);
    expect(isValidCustomContentId('null')).toBe(false);
    expect(isValidCustomContentId('NaN')).toBe(false);
  });

  it('rejects nullish and empty/whitespace', () => {
    expect(isValidCustomContentId(undefined)).toBe(false);
    expect(isValidCustomContentId(null)).toBe(false);
    expect(isValidCustomContentId('')).toBe(false);
    expect(isValidCustomContentId('   ')).toBe(false);
  });
});
