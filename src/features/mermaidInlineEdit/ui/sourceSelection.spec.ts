import { describe, expect, it } from 'vitest';
import type { Range, SequenceSourceMap } from '../types';
import { matchSourceLabel } from './sourceSelection';

describe('Mermaid source range matching', () => {
  const code = 'abcd';
  const at = (from: number, to = from) => ({ owner: document.body, code, from, to, typing: false });
  const mapWithMessages = (...ranges: Range[]): SequenceSourceMap => ({
    kind: 'sequence', code, participants: new Map(), notes: new Map(),
    messages: new Map(ranges.map((textRange, key) => [key, { textRange }])),
  });

  it('chooses the smallest mapped range containing the caret and accepts either edge', () => {
    const map = mapWithMessages([0, 4], [1, 3]);
    expect(matchSourceLabel(map, at(1))?.key).toBe(1);
    expect(matchSourceLabel(map, at(3))?.key).toBe(1);
    expect(matchSourceLabel(map, at(0))?.key).toBe(0);
  });

  it('suppresses a shared boundary when both smallest matches are equally specific', () => {
    const map = mapWithMessages([0, 2], [2, 4]);
    expect(matchSourceLabel(map, at(2))).toBeNull();
    expect(matchSourceLabel(map, at(1, 3))).toBeNull();
  });
});
