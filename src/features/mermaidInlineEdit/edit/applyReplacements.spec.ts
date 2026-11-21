import { describe, expect, it } from 'vitest';
import { applyReplacements, InvalidRangeError, OverlappingReplacementsError } from './applyReplacements';

describe('applyReplacements', () => {
  it('applies several replacements regardless of input order, growing and shrinking text', () => {
    const code = 'aaa bbb ccc';
    expect(
      applyReplacements(code, [
        { range: [8, 11], text: 'C' },
        { range: [0, 3], text: 'AAAAAA' },
        { range: [4, 7], text: '' },
      ]),
    ).toBe('AAAAAA  C');
  });

  it('applies an exact duplicate once and allows touching ranges and insertions', () => {
    expect(applyReplacements('abcd', [{ range: [1, 2], text: 'X' }, { range: [1, 2], text: 'X' }])).toBe('aXcd');
    expect(applyReplacements('abcd', [{ range: [0, 2], text: 'X' }, { range: [2, 4], text: 'Y' }])).toBe('XY');
    expect(applyReplacements('abcd', [{ range: [2, 2], text: '-' }])).toBe('ab-cd');
  });

  it('throws on overlapping ranges or conflicting duplicates', () => {
    expect(() => applyReplacements('abcdef', [{ range: [0, 3], text: 'X' }, { range: [2, 4], text: 'Y' }])).toThrow(OverlappingReplacementsError);
    expect(() => applyReplacements('abcdef', [{ range: [1, 2], text: 'X' }, { range: [1, 2], text: 'Y' }])).toThrow(OverlappingReplacementsError);
    expect(() => applyReplacements('abcdef', [{ range: [0, 4], text: 'X' }, { range: [1, 2], text: 'Y' }])).toThrow(OverlappingReplacementsError);
  });

  it('throws on ranges outside the source', () => {
    expect(() => applyReplacements('abc', [{ range: [2, 9], text: 'X' }])).toThrow(InvalidRangeError);
    expect(() => applyReplacements('abc', [{ range: [2, 1], text: 'X' }])).toThrow(InvalidRangeError);
    expect(() => applyReplacements('abc', [{ range: [-1, 1], text: 'X' }])).toThrow(InvalidRangeError);
  });

  it('does not mutate the input array', () => {
    const input = [{ range: [2, 3] as [number, number], text: 'X' }, { range: [0, 1] as [number, number], text: 'Y' }];
    applyReplacements('abc', input);
    expect(input[0].range).toEqual([2, 3]);
  });
});
