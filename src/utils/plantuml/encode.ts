import pako from 'pako';

// PlantUML uses a custom base64 alphabet: 0-9A-Za-z-_
const PLANTUML_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

function encode6bit(b: number): string {
  return PLANTUML_ALPHABET[b & 0x3f];
}

function append3bytes(b1: number, b2: number, b3: number): string {
  const c1 = b1 >> 2;
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
  const c3 = ((b2 & 0xf) << 2) | (b3 >> 6);
  const c4 = b3 & 0x3f;
  return encode6bit(c1) + encode6bit(c2) + encode6bit(c3) + encode6bit(c4);
}

function encodeBytes(data: Uint8Array): string {
  let result = '';
  for (let i = 0; i < data.length; i += 3) {
    if (i + 2 === data.length) {
      result += append3bytes(data[i], data[i + 1], 0);
    } else if (i + 1 === data.length) {
      result += append3bytes(data[i], 0, 0);
    } else {
      result += append3bytes(data[i], data[i + 1], data[i + 2]);
    }
  }
  return result;
}

/**
 * Encodes PlantUML text for use with the PlantUML server.
 * UTF-8 text -> raw deflate -> PlantUML custom base64
 */
export function plantumlEncode(text: string): string {
  const utf8 = new TextEncoder().encode(text);
  const deflated = pako.deflateRaw(utf8);
  return encodeBytes(deflated);
}
