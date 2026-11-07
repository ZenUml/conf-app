// Runtime-neutral PNG byte helpers (Uint8Array only: no Buffer, no DOM).
// Shared by the browser, the Forge function and the Cloudflare Pages functions.
//
// PNG layout (all integers big-endian):
//   bytes 0-7   signature: 89 50 4E 47 0D 0A 1A 0A
//   then chunks: length(4) | type(4) | data(length) | crc(4)
//   IHDR is always the first chunk (length 13): width at 16, height at 20.

/** The 8-byte PNG file signature. */
export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const IHDR_END = 24; // signature(8) + length(4) + type(4) + width(4) + height(4)

/**
 * True when `bytes` starts with the full 8-byte PNG signature.
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function isPng(bytes) {
  if (!bytes || bytes.length < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @returns {string}
 */
function fourCC(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/**
 * Read width/height from the IHDR chunk without decoding the image. Only the
 * first 24 bytes are needed, so a short Range-request buffer is enough.
 * @param {Uint8Array} bytes
 * @returns {{width: number, height: number} | null} null for anything that is
 *   not a well-formed PNG header.
 */
export function readPngSize(bytes) {
  if (!bytes || bytes.length < IHDR_END) return null;
  if (!isPng(bytes)) return null;
  if (fourCC(bytes, 12) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (!width || !height) return null;
  return { width, height };
}

/**
 * Walk the chunk list. `offset` is the start of the chunk's length field and
 * `length` the data length. Yields nothing for a non-PNG and stops at the first
 * chunk that does not fit in `bytes`.
 * @param {Uint8Array} bytes
 * @returns {Generator<{type: string, offset: number, length: number}>}
 */
export function* pngChunks(bytes) {
  if (!isPng(bytes)) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    if (offset + 12 + length > bytes.length) return;
    yield { type: fourCC(bytes, offset + 4), offset, length };
    offset += 12 + length;
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

/**
 * CRC-32 as used by PNG chunks (over type + data).
 * @param {Uint8Array} data
 * @returns {number} unsigned 32-bit
 */
export function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
