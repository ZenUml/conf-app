/**
 * PNG iTXt chunk utilities for embedding diagram source into PNG attachments.
 *
 * When a viewer saves a PNG attachment to Confluence, we inject an iTXt chunk
 * (keyword "zenumlDiagram") carrying the diagram source and type as JSON.
 * On load, if custom content is inaccessible (403/404), the viewer reads the
 * attachment, extracts the chunk, and hydrates the editor with the original source.
 *
 * iTXt chunk layout:
 *   keyword\0 | compression_flag(1B) | compression_method(1B) | lang_tag\0 | translated_kw\0 | UTF-8 text
 */

import { isPng, crc32, pngChunks } from '@/lib/png.js';
import { blobToArrayBuffer } from '@/utils/blobToArrayBuffer';

const ITXT_TYPE = new Uint8Array([105, 84, 88, 116]); // 'iTXt'
const KEYWORD = 'zenumlDiagram';
const KEYWORD_BYTES = new TextEncoder().encode(KEYWORD);

export interface DiagramPayload {
  diagramType: string;
  source: string;
}

function buildITxtChunk(diagramType: string, source: string): Uint8Array {
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(JSON.stringify({ diagramType, source }));

  // Data: keyword + null + compression_flag(0) + compression_method(0)
  //       + empty_lang_tag(null) + empty_translated_kw(null) + text
  const chunkData = new Uint8Array(KEYWORD_BYTES.length + 5 + payloadBytes.length);
  chunkData.set(KEYWORD_BYTES);
  // bytes [kwLen+0..4] are already 0 (null, cflag=0, cmethod=0, ltag-null, tkw-null)
  chunkData.set(payloadBytes, KEYWORD_BYTES.length + 5);

  // Full chunk: length(4) + type(4) + data + CRC(4)
  const typeAndData = new Uint8Array(4 + chunkData.length);
  typeAndData.set(ITXT_TYPE);
  typeAndData.set(chunkData, 4);
  const crc = crc32(typeAndData);

  const chunk = new Uint8Array(4 + 4 + chunkData.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, chunkData.length, false);
  chunk.set(ITXT_TYPE, 4);
  chunk.set(chunkData, 8);
  view.setUint32(8 + chunkData.length, crc, false);

  return chunk;
}

/**
 * Inject a zenumlDiagram iTXt chunk into a PNG blob before the first IDAT chunk.
 * Returns the original blob unchanged if it is not a valid PNG.
 */
export async function injectDiagramSource(
  pngBlob: Blob,
  diagramType: string,
  source: string,
): Promise<Blob> {
  const arrayBuffer = await blobToArrayBuffer(pngBlob);
  const bytes = new Uint8Array(arrayBuffer);

  if (!isPng(bytes)) {
    return pngBlob;
  }

  // Walk chunks to find the first IDAT (or IEND) — inject iTXt before it
  let insertOffset = 8;
  for (const c of pngChunks(bytes)) {
    if (c.type === 'IDAT' || c.type === 'IEND') {
      insertOffset = c.offset;
      break;
    }
    insertOffset = c.offset + 12 + c.length;
  }

  const chunk = buildITxtChunk(diagramType, source);
  const newPng = new Uint8Array(bytes.length + chunk.length);
  newPng.set(bytes.subarray(0, insertOffset));
  newPng.set(chunk, insertOffset);
  newPng.set(bytes.subarray(insertOffset), insertOffset + chunk.length);

  return new Blob([newPng], { type: 'image/png' });
}

/**
 * Scan an ArrayBuffer containing a PNG and return the zenumlDiagram iTXt payload,
 * or null if the chunk is absent or the data is not a valid PNG.
 */
export async function extractDiagramSource(
  pngData: ArrayBuffer,
): Promise<DiagramPayload | null> {
  const bytes = new Uint8Array(pngData);

  if (!isPng(bytes)) {
    return null;
  }

  const decoder = new TextDecoder();

  for (const chunk of pngChunks(bytes)) {
    const { type, offset, length: chunkLen } = chunk;

    if (type === 'IEND') break;
    if (type !== 'iTXt' || chunkLen <= KEYWORD_BYTES.length + 5) continue;

    const dataStart = offset + 8;
    const dataBytes = bytes.subarray(dataStart, dataStart + chunkLen);

    // Locate keyword null terminator
    const kwEnd = dataBytes.indexOf(0);
    if (kwEnd === -1 || kwEnd + 5 >= dataBytes.length) continue;

    const keyword = decoder.decode(dataBytes.subarray(0, kwEnd));
    if (keyword !== KEYWORD) continue;

    // Skip compression (we only write uncompressed; flag=0, method=0)
    if (dataBytes[kwEnd + 1] !== 0 || dataBytes[kwEnd + 2] !== 0) continue;

    // Find null after language tag, then null after translated keyword
    const langEnd = dataBytes.indexOf(0, kwEnd + 3);
    if (langEnd === -1) continue;
    const tkwEnd = dataBytes.indexOf(0, langEnd + 1);
    if (tkwEnd === -1) continue;

    const textStart = tkwEnd + 1;
    if (textStart >= dataBytes.length) continue;

    try {
      const parsed = JSON.parse(decoder.decode(dataBytes.subarray(textStart)));
      if (typeof parsed?.diagramType !== 'string' || typeof parsed?.source !== 'string') return null;
      return parsed as DiagramPayload;
    } catch {
      return null;
    }
  }

  return null;
}
