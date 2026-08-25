/**
 * A byte span in the UTF-8 encoding of a source string.
 *
 * The end is exclusive, matching JavaScript's string slicing convention.
 * These offsets are deliberately named to keep them distinct from the
 * UTF-16 code-unit indices used by JavaScript strings.
 */
export interface Utf8ByteSpan {
  readonly startByte: number;
  readonly endByte: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Convert a JavaScript string boundary to its corresponding UTF-8 byte
 * offset. Boundaries that split an astral character are rejected because no
 * valid UTF-8 byte boundary exists at that point in the source.
 */
export function utf8ByteOffsetAt(source: string, utf16Index: number): number {
  assertUtf16Boundary(source, utf16Index, 'utf16Index');
  return encoder.encode(source.slice(0, utf16Index)).byteLength;
}

/**
 * Convert an inclusive/exclusive JavaScript string range into an equivalent
 * UTF-8 byte span.
 */
export function utf8ByteSpanFor(
  source: string,
  startUtf16Index: number,
  endUtf16Index: number,
): Utf8ByteSpan {
  assertUtf16Boundary(source, startUtf16Index, 'startUtf16Index');
  assertUtf16Boundary(source, endUtf16Index, 'endUtf16Index');
  if (startUtf16Index > endUtf16Index) {
    throw new RangeError('startUtf16Index must not be greater than endUtf16Index');
  }

  return {
    startByte: utf8ByteOffsetAt(source, startUtf16Index),
    endByte: utf8ByteOffsetAt(source, endUtf16Index),
  };
}

/**
 * Slice a source string with a UTF-8 byte span. Both ends must be valid UTF-8
 * boundaries; accepting a span in the middle of a multi-byte code point
 * would silently produce a different source fragment.
 */
export function sliceUtf8ByteSpan(source: string, span: Utf8ByteSpan): string {
  const bytes = encoder.encode(source);
  assertByteSpan(span, bytes.byteLength);
  assertCodePointBoundary(bytes, span.startByte, 'startByte');
  assertCodePointBoundary(bytes, span.endByte, 'endByte');

  try {
    return decoder.decode(bytes.slice(span.startByte, span.endByte));
  } catch {
    throw new RangeError('UTF-8 byte span must start and end on code-point boundaries');
  }
}

function assertUtf16Boundary(source: string, index: number, name: string): void {
  if (!Number.isSafeInteger(index) || index < 0 || index > source.length) {
    throw new RangeError(`${name} must be an integer between 0 and ${source.length}`);
  }

  if (
    index > 0 &&
    index < source.length &&
    isHighSurrogate(source.charCodeAt(index - 1)) &&
    isLowSurrogate(source.charCodeAt(index))
  ) {
    throw new RangeError(`${name} must not split a UTF-16 surrogate pair`);
  }
}

function assertByteSpan(span: Utf8ByteSpan, byteLength: number): void {
  if (span == null || typeof span !== 'object') {
    throw new RangeError('span must be an object with startByte and endByte');
  }

  if (
    !Number.isSafeInteger(span.startByte) ||
    !Number.isSafeInteger(span.endByte) ||
    span.startByte < 0 ||
    span.endByte < 0 ||
    span.startByte > span.endByte ||
    span.endByte > byteLength
  ) {
    throw new RangeError(`span must be within UTF-8 byte bounds 0..${byteLength}`);
  }
}

function assertCodePointBoundary(bytes: Uint8Array, offset: number, name: string): void {
  if (offset < bytes.byteLength && isUtf8ContinuationByte(bytes[offset])) {
    throw new RangeError(`${name} must be on a UTF-8 code-point boundary`);
  }
}

function isUtf8ContinuationByte(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}
