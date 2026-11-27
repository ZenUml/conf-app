import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Mermaid 11.17.2's insertEdge writes a debug-only `data-points` attribute
// with `btoa(JSON.stringify(points))`. `btoa` throws on any character outside
// Latin1, and when a polygon shape finds no intersection its helper returns
// the whole node (label included) instead of a point. A non-Latin1 label then
// aborts the render of the entire diagram: "Failed to execute 'btoa' on
// 'Window': The string to be encoded contains characters outside of the
// Latin1 range." (viewer_load_failed, 87 events since 2026-09-22).
//
// patches/mermaid@11.17.2.patch encodes UTF-8 bytes first, as Mermaid's own
// toBase64 does. Upstream: mermaid-js/mermaid#8251 (open; 12.4.0 still has
// the raw call). This spec fails if the patch stops being applied, e.g. after
// a Mermaid upgrade that drops patchedDependencies.

const mermaidDist = join(
  dirname(createRequire(import.meta.url).resolve('mermaid/package.json')),
  'dist',
);

// The production viewer loads the esm.min build from dist/vendor/mermaid
// (loadMermaid.ts, vite.config.mjs); specs and anything importing 'mermaid'
// resolve mermaid.core. Both must be safe.
const RUNTIME_CHUNK_DIRS = ['chunks/mermaid.esm.min', 'chunks/mermaid.core'];

function runtimeChunks(dir: string): { name: string; source: string }[] {
  const full = join(mermaidDist, dir);
  return readdirSync(full)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => ({ name: `${dir}/${name}`, source: readFileSync(join(full, name), 'utf8') }));
}

describe('Mermaid edge data-points encoding', () => {
  it.each(RUNTIME_CHUNK_DIRS)('%s has no raw btoa over serialized edge points', (dir) => {
    const offenders = runtimeChunks(dir)
      .filter(({ source }) => /btoa\(JSON\.stringify\(/.test(source))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it.each(RUNTIME_CHUNK_DIRS)('%s still writes the data-points attribute', (dir) => {
    // Guards against a patch that silently removed the attribute instead of
    // fixing its encoding.
    const writers = runtimeChunks(dir).filter(({ source }) => source.includes('"data-points"'));
    expect(writers.length).toBeGreaterThan(0);
  });

  it('encodes non-Latin1 text the way the patched call does', () => {
    // The exact expression the patch inserts, checked against a label like
    // the ones in the failing customer diagrams.
    const encode = (s: string) =>
      btoa(Array.from(new TextEncoder().encode(s), (b) => String.fromCodePoint(b)).join(''));
    const points = JSON.stringify([{ x: 1, y: 2, label: 'Kiểm tra dữ liệu' }]);
    // Chromium: "... outside of the Latin1 range."; jsdom: "Invalid character".
    expect(() => btoa(points)).toThrow(/Latin1|Invalid character/);
    const encoded = encode(points);
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
    expect(decoded).toBe(points);
  });
});
