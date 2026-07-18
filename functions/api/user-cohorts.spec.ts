import { describe, it, expect } from 'vitest';
import { resolveCohorts } from './user-cohorts';

describe('resolveCohorts', () => {
  it('returns [] for a KV miss', () => {
    expect(resolveCohorts(null)).toEqual([]);
  });
  it('returns the cohorts array from a valid record', () => {
    expect(resolveCohorts(JSON.stringify({ cohorts: ['vs-copier', 't1-lapsed-author-strict'] })))
      .toEqual(['vs-copier', 't1-lapsed-author-strict']);
  });
  it('returns [] for malformed JSON', () => {
    expect(resolveCohorts('{oops')).toEqual([]);
  });
  it('returns [] when cohorts is not an array', () => {
    expect(resolveCohorts(JSON.stringify({ cohorts: 'vs-copier' }))).toEqual([]);
  });
  it('drops non-string entries', () => {
    expect(resolveCohorts(JSON.stringify({ cohorts: ['a', 1, null, 'b'] }))).toEqual(['a', 'b']);
  });
});
