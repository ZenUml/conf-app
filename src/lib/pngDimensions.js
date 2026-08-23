// Reads a PNG's pixel width/height straight out of its IHDR chunk, without
// decoding the image. Used by src/export.js to declare the export ADF
// media node's intrinsic `width`/`height` — see that file for why.
//
// PNG layout (all integers big-endian):
//   bytes 0-7   signature: 89 50 4E 47 0D 0A 1A 0A
//   bytes 8-11  first chunk's length (IHDR is always the first chunk, length 13)
//   bytes 12-15 chunk type, "IHDR" for a well-formed PNG
//   bytes 16-19 width (uint32)
//   bytes 20-23 height (uint32)
// Only the first 24 bytes are read, so callers can pass a short Range-request
// buffer instead of the whole file.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MIN_HEADER_BYTES = 24;

/**
 * @param {Buffer} buffer - at least the first 24 bytes of a PNG file.
 * @returns {{width: number, height: number}}
 * @throws if the buffer is too short, lacks the PNG signature, or its first
 *   chunk isn't IHDR (i.e. it is not a well-formed PNG).
 */
export function readPngDimensions(buffer) {
  if (!buffer || buffer.length < MIN_HEADER_BYTES) {
    throw new Error(`png_header_too_short:${buffer?.length ?? 0}`);
  }
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('png_signature_mismatch');
  }
  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType !== 'IHDR') {
    throw new Error(`png_first_chunk_not_ihdr:${chunkType}`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0) {
    throw new Error(`png_invalid_dimensions:${width}x${height}`);
  }
  return { width, height };
}
