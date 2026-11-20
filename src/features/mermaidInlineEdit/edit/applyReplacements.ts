import type { Range } from '../types';

export interface Replacement {
  range: Range;
  text: string;
}

export class OverlappingReplacementsError extends Error {
  constructor() {
    super('Replacement ranges overlap');
    this.name = 'OverlappingReplacementsError';
  }
}

export class InvalidRangeError extends Error {
  constructor() {
    super('Replacement range is outside the source');
    this.name = 'InvalidRangeError';
  }
}

/**
 * Applies replacements to `code` from the end to the start so earlier offsets
 * stay valid. Everything outside the replaced ranges is copied byte for byte.
 *
 * - Exact duplicate replacements (same range, same text) are applied once.
 * - Ranges that partly overlap, or the same range with different text, throw
 *   OverlappingReplacementsError. Touching ranges (end === next start) are fine.
 * - A range outside the source or with start > end throws InvalidRangeError.
 */
export function applyReplacements(code: string, replacements: readonly Replacement[]): string {
  const sorted: Replacement[] = [];
  for (const r of replacements) {
    const [start, end] = r.range;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > code.length) {
      throw new InvalidRangeError();
    }
    sorted.push(r);
  }
  sorted.sort((a, b) => a.range[0] - b.range[0] || a.range[1] - b.range[1]);

  const unique: Replacement[] = [];
  for (const r of sorted) {
    const prev = unique[unique.length - 1];
    if (prev && prev.range[0] === r.range[0] && prev.range[1] === r.range[1]) {
      if (prev.text !== r.text) throw new OverlappingReplacementsError();
      continue;
    }
    if (prev && r.range[0] < prev.range[1]) throw new OverlappingReplacementsError();
    unique.push(r);
  }

  let result = code;
  for (let i = unique.length - 1; i >= 0; i--) {
    const { range, text } = unique[i];
    result = result.slice(0, range[0]) + text + result.slice(range[1]);
  }
  return result;
}
