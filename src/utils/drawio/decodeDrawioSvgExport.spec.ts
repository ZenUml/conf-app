import { describe, it, expect } from 'vitest';
import { decodeDrawioSvgExport } from './decodeDrawioSvgExport';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
const b64DataUri = (s: string) => 'data:image/svg+xml;base64,' + Buffer.from(s, 'utf8').toString('base64');

describe('decodeDrawioSvgExport', () => {
  it('decodes the base64 data URI DrawIO actually returns (createSvgDataUri)', () => {
    expect(decodeDrawioSvgExport({ data: b64DataUri(SVG) })).toBe(SVG);
  });

  it('round-trips non-ASCII content through base64+UTF-8 (label text)', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>café — 北京</text></svg>';
    expect(decodeDrawioSvgExport({ data: b64DataUri(svg) })).toBe(svg);
  });

  it('decodes a utf8 / url-encoded data URI variant', () => {
    const uri = 'data:image/svg+xml;utf8,' + encodeURIComponent(SVG);
    expect(decodeDrawioSvgExport({ data: uri })).toBe(SVG);
  });

  it('accepts a raw <svg> string', () => {
    expect(decodeDrawioSvgExport({ data: SVG })).toBe(SVG);
  });

  it('returns undefined when the decoded payload is not an SVG', () => {
    expect(decodeDrawioSvgExport({ data: b64DataUri('<div>not an svg</div>') })).toBeUndefined();
  });

  it('returns undefined for missing / non-string / empty data', () => {
    expect(decodeDrawioSvgExport({})).toBeUndefined();
    expect(decodeDrawioSvgExport({ data: 123 as unknown })).toBeUndefined();
    expect(decodeDrawioSvgExport({ data: '' })).toBeUndefined();
    expect(decodeDrawioSvgExport(null)).toBeUndefined();
    expect(decodeDrawioSvgExport(undefined)).toBeUndefined();
  });

  it('never throws on malformed base64', () => {
    expect(decodeDrawioSvgExport({ data: 'data:image/svg+xml;base64,@@@not-base64@@@' })).toBeUndefined();
  });
});
