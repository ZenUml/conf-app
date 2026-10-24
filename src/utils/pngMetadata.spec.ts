import { describe, it, expect } from 'vitest';
import { injectDiagramSource, extractDiagramSource } from './pngMetadata';

// Canonical 1×1 white-pixel PNG (base64). Used as a valid PNG fixture.
const MINIMAL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Return the PNG fixture as a raw Uint8Array (no Blob, avoids jsdom Blob.arrayBuffer compat issues). */
function minimalPngBytes(): Uint8Array {
  return new Uint8Array(Buffer.from(MINIMAL_PNG_B64, 'base64'));
}

function minimalPngBlob(): Blob {
  return new Blob([minimalPngBytes()], { type: 'image/png' });
}

/** Extract ArrayBuffer from a Blob using FileReader fallback for jsdom environments. */
async function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error ?? new Error('FileReader error'));
    fr.readAsArrayBuffer(blob);
  });
}

describe('pngMetadata', () => {
  describe('round-trip (inject → extract)', () => {
    it('recovers graph XML verbatim', async () => {
      const source = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>';
      const injected = await injectDiagramSource(minimalPngBlob(), 'graph', source);
      const result = await extractDiagramSource(await blobBytes(injected));
      expect(result).toEqual({ diagramType: 'graph', source });
    });

    it('recovers sequence DSL verbatim', async () => {
      const source = 'A->B: hello\nB-->A: world';
      const injected = await injectDiagramSource(minimalPngBlob(), 'sequence', source);
      const result = await extractDiagramSource(await blobBytes(injected));
      expect(result).toEqual({ diagramType: 'sequence', source });
    });

    it('handles unicode and special chars in source', async () => {
      const source = '你好 <world> & \'test\' "quote"';
      const injected = await injectDiagramSource(minimalPngBlob(), 'mermaid', source);
      const result = await extractDiagramSource(await blobBytes(injected));
      expect(result).toEqual({ diagramType: 'mermaid', source });
    });

    it('injected PNG is larger than the original', async () => {
      const original = minimalPngBytes();
      const injected = await injectDiagramSource(minimalPngBlob(), 'graph', 'data');
      expect(injected.size).toBeGreaterThan(original.byteLength);
    });

    it('injected PNG retains PNG signature', async () => {
      const injected = await injectDiagramSource(minimalPngBlob(), 'graph', 'data');
      const bytes = new Uint8Array(await blobBytes(injected));
      expect(bytes[0]).toBe(0x89);
      expect(bytes[1]).toBe(0x50); // 'P'
      expect(bytes[2]).toBe(0x4e); // 'N'
      expect(bytes[3]).toBe(0x47); // 'G'
    });
  });

  describe('extractDiagramSource', () => {
    it('returns null for a plain PNG with no zenumlDiagram chunk', async () => {
      const result = await extractDiagramSource(minimalPngBytes().buffer);
      expect(result).toBeNull();
    });

    it('returns null for an all-zero ArrayBuffer', async () => {
      expect(await extractDiagramSource(new ArrayBuffer(16))).toBeNull();
    });

    it('returns null for non-PNG binary data', async () => {
      const data = new TextEncoder().encode('this is not a png');
      expect(await extractDiagramSource(data.buffer)).toBeNull();
    });

    it('returns null for an empty ArrayBuffer', async () => {
      expect(await extractDiagramSource(new ArrayBuffer(0))).toBeNull();
    });
  });

  describe('injectDiagramSource', () => {
    it('returns the original Blob unchanged when data is not a PNG', async () => {
      const notPng = new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'image/png' });
      const result = await injectDiagramSource(notPng, 'graph', 'data');
      expect(result).toBe(notPng);
    });
  });
});
