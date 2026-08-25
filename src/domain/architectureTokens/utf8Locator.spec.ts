import { describe, expect, it } from 'vitest';
import { sliceUtf8ByteSpan, utf8ByteOffsetAt, utf8ByteSpanFor } from './utf8Locator';

describe('utf8ByteOffsetAt', () => {
  it('maps ASCII string boundaries to the same UTF-8 byte offsets', () => {
    const source = 'A --> B';

    expect(utf8ByteOffsetAt(source, 0)).toBe(0);
    expect(utf8ByteOffsetAt(source, 1)).toBe(1);
    expect(utf8ByteOffsetAt(source, source.length)).toBe(source.length);
  });

  it('accounts for the three-byte UTF-8 encoding of CJK characters', () => {
    const source = 'A节点B';

    expect(utf8ByteOffsetAt(source, 0)).toBe(0);
    expect(utf8ByteOffsetAt(source, 1)).toBe(1);
    expect(utf8ByteOffsetAt(source, 2)).toBe(4);
    expect(utf8ByteOffsetAt(source, 3)).toBe(7);
    expect(utf8ByteOffsetAt(source, 4)).toBe(8);
    expect(sliceUtf8ByteSpan(source, { startByte: 1, endByte: 7 })).toBe('节点');
  });

  it('accounts for the four-byte UTF-8 encoding of astral emoji', () => {
    const source = 'A🙂B';

    expect(utf8ByteOffsetAt(source, 0)).toBe(0);
    expect(utf8ByteOffsetAt(source, 1)).toBe(1);
    expect(utf8ByteOffsetAt(source, 3)).toBe(5);
    expect(utf8ByteOffsetAt(source, 4)).toBe(6);
    expect(sliceUtf8ByteSpan(source, { startByte: 1, endByte: 5 })).toBe('🙂');
  });

  it('preserves combining marks as separate UTF-8 code points', () => {
    const source = 'e\u0301x';

    expect(utf8ByteSpanFor(source, 0, 2)).toEqual({ startByte: 0, endByte: 3 });
    expect(sliceUtf8ByteSpan(source, utf8ByteSpanFor(source, 0, 2))).toBe('e\u0301');
    expect(utf8ByteOffsetAt(source, 2)).toBe(3);
  });
});

describe('utf8ByteSpanFor and sliceUtf8ByteSpan', () => {
  it('converts and slices a UTF-8 byte span', () => {
    const source = 'A --> B';
    const span = utf8ByteSpanFor(source, 2, 5);

    expect(span).toEqual({ startByte: 2, endByte: 5 });
    expect(sliceUtf8ByteSpan(source, span)).toBe('-->');
  });

  it('rejects invalid UTF-16 boundaries and ranges', () => {
    const source = 'A🙂B';

    expect(() => utf8ByteOffsetAt(source, -1)).toThrow(RangeError);
    expect(() => utf8ByteOffsetAt(source, source.length + 1)).toThrow(RangeError);
    expect(() => utf8ByteOffsetAt(source, 1.5)).toThrow(RangeError);
    expect(() => utf8ByteOffsetAt(source, 2)).toThrow(RangeError);
    expect(() => utf8ByteSpanFor(source, 3, 1)).toThrow(RangeError);
  });

  it('rejects invalid or unaligned UTF-8 byte spans', () => {
    const source = '节点';

    expect(() => sliceUtf8ByteSpan(source, { startByte: -1, endByte: 3 })).toThrow(RangeError);
    expect(() => sliceUtf8ByteSpan(source, { startByte: 0, endByte: 7 })).toThrow(RangeError);
    expect(() => sliceUtf8ByteSpan(source, { startByte: 2, endByte: 3 })).toThrow(RangeError);
    expect(() => sliceUtf8ByteSpan(source, { startByte: 1, endByte: 1 })).toThrow(RangeError);
    expect(() => sliceUtf8ByteSpan(source, { startByte: 4, endByte: 1 })).toThrow(RangeError);
    expect(() => sliceUtf8ByteSpan(source, { startByte: 0, endByte: 6.5 })).toThrow(RangeError);
  });
});
