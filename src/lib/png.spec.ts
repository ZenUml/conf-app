import { describe, it, expect } from 'vitest';
import { PNG_SIGNATURE, isPng, readPngSize, pngChunks, crc32 } from './png.js';

// Canonical 1x1 PNG: IHDR (13 bytes) + IDAT + IEND.
const ONE_PX_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const onePx = () => new Uint8Array(Buffer.from(ONE_PX_B64, 'base64'));

describe('png.js', () => {
  describe('isPng', () => {
    it('accepts a full 8-byte signature', () => {
      expect(isPng(onePx())).toBe(true);
      expect(isPng(PNG_SIGNATURE)).toBe(true);
    });
    it('rejects short input', () => {
      expect(isPng(new Uint8Array(0))).toBe(false);
      expect(isPng(PNG_SIGNATURE.subarray(0, 7))).toBe(false);
    });
    it('rejects a 4-byte-only magic followed by garbage', () => {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6]);
      expect(isPng(bytes)).toBe(false);
    });
  });

  describe('readPngSize', () => {
    it('reads width and height from IHDR', () => {
      expect(readPngSize(onePx())).toEqual({ width: 1, height: 1 });
    });
    it('accepts a 24-byte header-only buffer', () => {
      expect(readPngSize(onePx().subarray(0, 24))).toEqual({ width: 1, height: 1 });
    });
    it('returns null for a truncated header', () => {
      expect(readPngSize(onePx().subarray(0, 23))).toBeNull();
      expect(readPngSize(new Uint8Array(0))).toBeNull();
    });
    it('returns null when the first chunk is not IHDR', () => {
      const bytes = onePx();
      bytes.set([0x74, 0x45, 0x58, 0x74], 12); // "tEXt"
      expect(readPngSize(bytes)).toBeNull();
    });
    it('returns null for a bad signature or zero dimensions', () => {
      const bad = onePx();
      bad[1] = 0;
      expect(readPngSize(bad)).toBeNull();
      const zero = onePx();
      zero.set([0, 0, 0, 0], 16);
      expect(readPngSize(zero)).toBeNull();
    });
  });

  describe('pngChunks', () => {
    it('walks IHDR, IDAT, IEND with offsets and lengths', () => {
      expect([...pngChunks(onePx())]).toEqual([
        { type: 'IHDR', offset: 8, length: 13 },
        { type: 'IDAT', offset: 33, length: 13 },
        { type: 'IEND', offset: 58, length: 0 },
      ]);
    });
    it('yields nothing for a non-PNG', () => {
      expect([...pngChunks(new Uint8Array([1, 2, 3]))]).toEqual([]);
    });
    it('stops at a truncated chunk', () => {
      expect([...pngChunks(onePx().subarray(0, 40))].map((c) => c.type)).toEqual(['IHDR']);
    });
  });

  describe('crc32', () => {
    it('matches the known IEND chunk CRC', () => {
      expect(crc32(new Uint8Array([0x49, 0x45, 0x4e, 0x44]))).toBe(0xae426082);
    });
    it('matches the standard check value', () => {
      expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    });
  });
});
