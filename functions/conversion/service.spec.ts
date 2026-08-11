import { describe, it, expect } from 'vitest';
import { unwrapMirrorBody } from './service';

/**
 * The D1 mirror stores `JSON.stringify(customContent.body)` — the whole
 * Confluence body OBJECT (`forge-custom-content.ts:101`), not the diagram
 * JSON. Handing that column straight to `POST /custom-content` produced a
 * double-wrapped Full custom content whose ADF looked perfect and whose macro
 * rendered nothing (observed on full-stg custom content 139755553,
 * 2026-08-11). All 7126 Lite rows in staging carry the wrapper — it is the
 * shape the writer always produces, not a legacy variant.
 */
describe('unwrapMirrorBody', () => {
  const diagram = JSON.stringify({ diagramType: 'sequence', code: 'A.method()' });

  it('returns the raw value out of the stored Confluence body object', () => {
    const stored = JSON.stringify({ raw: { representation: 'raw', value: diagram } });
    expect(unwrapMirrorBody(stored)).toBe(diagram);
  });

  it('ignores sibling expansion keys Confluence adds next to `raw`', () => {
    const stored = JSON.stringify({
      raw: { representation: 'raw', value: diagram },
      _expandable: { storage: '', view: '' },
    });
    expect(unwrapMirrorBody(stored)).toBe(diagram);
  });

  it('keeps a graph body byte-identical, mxfile XML and all', () => {
    const graph = JSON.stringify({
      diagramType: 'graph',
      graphXml: '<mxfile host="x"><diagram id="a">…</diagram></mxfile>',
    });
    const stored = JSON.stringify({ raw: { representation: 'raw', value: graph } });
    expect(unwrapMirrorBody(stored)).toBe(graph);
  });

  // Anything else is a shape this code has never seen. Return null so the id
  // lands in `missing` and the job counts it as skipped — creating content
  // from an unrecognised shape is how the double-wrap defect shipped.
  it('returns null when the stored column is not the expected shape', () => {
    expect(unwrapMirrorBody(diagram)).toBeNull();
    expect(unwrapMirrorBody('not json at all')).toBeNull();
    expect(unwrapMirrorBody(JSON.stringify({ raw: { representation: 'raw' } }))).toBeNull();
    expect(unwrapMirrorBody(JSON.stringify({ storage: { value: diagram } }))).toBeNull();
    expect(unwrapMirrorBody('')).toBeNull();
  });
});
