import { describe, it, expect } from 'vitest';
import { readPngDimensions } from './pngDimensions';

function buildIhdrHeader(width: number, height: number, { chunkType = 'IHDR', signature = true, extraTail = 8 } = {}) {
  const parts: Buffer[] = [];
  parts.push(signature
    ? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]));
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(13, 0);
  parts.push(lengthBuf);
  parts.push(Buffer.from(chunkType, 'ascii'));
  const widthBuf = Buffer.alloc(4);
  widthBuf.writeUInt32BE(width, 0);
  parts.push(widthBuf);
  const heightBuf = Buffer.alloc(4);
  heightBuf.writeUInt32BE(height, 0);
  parts.push(heightBuf);
  if (extraTail > 0) parts.push(Buffer.alloc(extraTail));
  return Buffer.concat(parts);
}

describe('readPngDimensions', () => {
  it('reads width and height from a well-formed IHDR header', () => {
    const buffer = buildIhdrHeader(1516, 598);
    expect(readPngDimensions(buffer)).toEqual({ width: 1516, height: 598 });
  });

  it('works from only the first 24 bytes (no tail beyond IHDR)', () => {
    const buffer = buildIhdrHeader(944, 372, { extraTail: 0 }).subarray(0, 24);
    expect(readPngDimensions(buffer)).toEqual({ width: 944, height: 372 });
  });

  it('throws when the buffer is too short to contain IHDR', () => {
    expect(() => readPngDimensions(Buffer.alloc(10))).toThrow(/too_short/);
  });

  it('throws when the buffer is missing/undefined', () => {
    // @ts-expect-error deliberately passing an invalid value
    expect(() => readPngDimensions(undefined)).toThrow(/too_short/);
  });

  it('throws when the PNG signature does not match', () => {
    const buffer = buildIhdrHeader(100, 100, { signature: false });
    expect(() => readPngDimensions(buffer)).toThrow(/signature_mismatch/);
  });

  it('throws when the first chunk is not IHDR', () => {
    const buffer = buildIhdrHeader(100, 100, { chunkType: 'sRGB' });
    expect(() => readPngDimensions(buffer)).toThrow(/not_ihdr/);
  });

  it('throws on zero dimensions rather than returning a bogus box', () => {
    const buffer = buildIhdrHeader(0, 100);
    expect(() => readPngDimensions(buffer)).toThrow(/invalid_dimensions/);
  });
});
