import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compress, decompress } from './compress';

// ZEN-1170 Defect 1 regression. Legacy Connect-era graph macros stored the
// diagram body as a page content property whose `value` was
// `{ compressed: true, graphXml: <LZUTF8-Base64> }`. The Forge viewer's V2
// fallback (forge-graph-viewer.ts L102-L116) must base64-decode + LZUTF8-
// decompress that field to a plain mxGraphModel XML string before mounting,
// otherwise the diagram surface renders empty.
//
// The customer fixture under private/zen-1170/ is a real production
// content-property value verified rendering end-to-end against
// v2026.05.250448-lite on 2026-05-25 (see the postfix screenshot).
// If you don't have the private/ submodule initialised, the fixture-backed
// case is skipped; the round-trip case still runs.
describe('compress', () => {
  describe('round-trip', () => {
    it('decompress(compress(x)) === x for ASCII', () => {
      const input = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>';
      expect(decompress(compress(input))).toBe(input);
    });

    it('returns falsy for falsy input (no throw on missing graphXml)', () => {
      expect(decompress('')).toBe('');
      expect(decompress(null as any)).toBe(null);
      expect(decompress(undefined as any)).toBe(undefined);
    });
  });

  describe('decompress against legacy customer fixture (ZEN-1170 Defect 1)', () => {
    const fixturePath = resolve(
      __dirname,
      '../../private/zen-1170/defect-1-decompress-sample.json',
    );
    const hasFixture = existsSync(fixturePath);

    it.skipIf(!hasFixture)(
      'produces a non-trivial mxGraphModel XML string',
      () => {
        const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
          compressed: boolean;
          graphXml: string;
        };

        expect(fixture.compressed).toBe(true);
        // Sanity-check the fixture is in the LZUTF8/Base64 shape the viewer
        // detects via `!graphXml.startsWith('<mxGraphModel')`.
        expect(fixture.graphXml.startsWith('<mxGraphModel')).toBe(false);

        const xml = decompress(fixture.graphXml);

        expect(typeof xml).toBe('string');
        expect(xml.startsWith('<mxGraphModel')).toBe(true);
        // Decompressed payload should contain real cells, not just the
        // outer envelope (catches a corrupt-stream / wrong-encoding regression
        // that still produces a string that happens to start with the prefix).
        expect(xml).toContain('<mxCell');
        // Original compressed length is ~2.7 KB; expanded XML is much larger.
        expect(xml.length).toBeGreaterThan(fixture.graphXml.length);
      },
    );
  });
});
