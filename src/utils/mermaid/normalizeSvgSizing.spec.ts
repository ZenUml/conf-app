import { describe, it, expect } from 'vitest';
import { normalizeSvgSizing } from '@/utils/mermaid/normalizeSvgSizing';

// A mermaid diagram rendered with `useMaxWidth: false` carries hard pixel
// width/height attributes. Our viewer wraps the SVG in a `flex justify-center`
// container (Mermaid.vue), and flexbox shrinks a flex item's WIDTH only — the
// height attribute survives. With the default preserveAspectRatio the drawing
// is then letterboxed dead centre in the leftover vertical space.
//
// Measured on Lite production 2026-09-07, custom content 3372482567 in a 562px
// container: svg 562x4754 holding a 1493px-tall drawing => 1630px of white
// above it and roughly as much below.
const USE_MAX_WIDTH_FALSE =
  '<svg aria-roledescription="flowchart-v2" role="graphics-document document" ' +
  'viewBox="-22 -22 1766.4132080078125 4754.068359375" ' +
  'width="1766.4132080078125" height="4754.068359375" ' +
  'xmlns="http://www.w3.org/2000/svg" id="mermaid-abc">' +
  '<g class="root"></g></svg>';

// `useMaxWidth: true` is mermaid's default and already renders without a gap:
// width="100%" plus no height attribute lets the browser derive the height
// from the viewBox. This shape must survive untouched.
const USE_MAX_WIDTH_TRUE =
  '<svg aria-roledescription="flowchart-v2" role="graphics-document document" ' +
  'viewBox="0 0 1470.4229736328125 4720.474609375" ' +
  'style="max-width: 1470.4229736328125px;" width="100%" ' +
  'xmlns="http://www.w3.org/2000/svg" id="mermaid-def">' +
  '<g class="root"></g></svg>';

const parse = (svg: string) => {
  const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  if (el.nodeName === 'parsererror') throw new Error('unparseable svg');
  return el;
};

describe('normalizeSvgSizing', () => {
  it('drops the fixed height that letterboxes a useMaxWidth:false diagram', () => {
    const el = parse(normalizeSvgSizing(USE_MAX_WIDTH_FALSE));

    expect(el.getAttribute('height')).toBeNull();
  });

  it('caps a useMaxWidth:false diagram at its natural width instead of a fixed one', () => {
    const el = parse(normalizeSvgSizing(USE_MAX_WIDTH_FALSE));

    expect(el.getAttribute('width')).toBe('100%');
    expect(el.getAttribute('style')).toContain('max-width: 1766.4132080078125px');
  });

  it('preserves the viewBox so the drawing keeps its aspect ratio', () => {
    const el = parse(normalizeSvgSizing(USE_MAX_WIDTH_FALSE));

    expect(el.getAttribute('viewBox')).toBe('-22 -22 1766.4132080078125 4754.068359375');
  });

  it('leaves a useMaxWidth:true diagram alone', () => {
    const el = parse(normalizeSvgSizing(USE_MAX_WIDTH_TRUE));

    expect(el.getAttribute('width')).toBe('100%');
    expect(el.getAttribute('height')).toBeNull();
    expect(el.getAttribute('style')).toContain('max-width: 1470.4229736328125px');
  });

  it('returns non-svg or empty input unchanged', () => {
    expect(normalizeSvgSizing('')).toBe('');
    expect(normalizeSvgSizing(null as unknown as string)).toBe(null);
    expect(normalizeSvgSizing('<div>not an svg</div>')).toBe('<div>not an svg</div>');
  });
});
