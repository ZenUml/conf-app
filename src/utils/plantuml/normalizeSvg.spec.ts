import { describe, it, expect } from 'vitest';
import { normalizePlantUmlSvg, readPlantUmlSvgSize } from './normalizeSvg';

/**
 * Shape of a real plantuml.com `/svg/` response root, reduced to the attributes
 * that decide layout. The `preserveAspectRatio="none"` and the pixel width/height
 * are what the server actually emits — see conf-app#626.
 */
function serverSvg(width: number, height: number, extra = ''): string {
  return (
    `<?xml version="1.0" encoding="us-ascii" standalone="no"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `contentStyleType="text/css" height="${height}px" preserveAspectRatio="none" ` +
    `style="width:${width}px;height:${height}px;background:#FFFFFF;" version="1.1" ` +
    `viewBox="0 0 ${width} ${height}" width="${width}px" zoomAndPan="magnify"${extra}>` +
    `<g><rect x="0" y="0" width="10" height="10"/></g></svg>`
  );
}

function rootAttr(svg: string, name: string): string | null {
  const root = svg.slice(svg.indexOf('<svg'), svg.indexOf('>', svg.indexOf('<svg')) + 1);
  const m = root.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
}

describe('normalizePlantUmlSvg', () => {
  it('replaces preserveAspectRatio="none" so the drawing cannot be squashed on one axis', () => {
    const out = normalizePlantUmlSvg(serverSvg(6228, 2564));
    expect(rootAttr(out, 'preserveAspectRatio')).toBe('xMidYMid meet');
  });

  it('drops the pixel width/height attributes and keeps the viewBox', () => {
    const out = normalizePlantUmlSvg(serverSvg(6228, 2564));
    expect(rootAttr(out, 'width')).toBeNull();
    expect(rootAttr(out, 'height')).toBeNull();
    expect(rootAttr(out, 'viewBox')).toBe('0 0 6228 2564');
  });

  it('lets the height follow the aspect ratio instead of a fixed pixel size', () => {
    const out = normalizePlantUmlSvg(serverSvg(6228, 2564));
    const style = rootAttr(out, 'style') || '';
    expect(style).toMatch(/height:\s*auto/);
    // The fixed pixel sizing that forced the squash must be gone.
    expect(style).not.toMatch(/width:\s*6228px/);
    expect(style).not.toMatch(/height:\s*2564px/);
  });

  it('leaves max-width to the stylesheet so fullscreen can render at 1:1', () => {
    // An inline max-width would outrank the fullscreen rule and pin the diagram to
    // the column width, leaving nothing to scroll (conf-app#626).
    expect(rootAttr(normalizePlantUmlSvg(serverSvg(6228, 2564)), 'style') || '')
      .not.toMatch(/max-width/);
  });

  it('keeps the background the server set', () => {
    const out = normalizePlantUmlSvg(serverSvg(1046, 86));
    expect(rootAttr(out, 'style') || '').toMatch(/background:\s*#FFFFFF/);
  });

  it('synthesises a viewBox when the server omits one', () => {
    const noViewBox =
      `<svg xmlns="http://www.w3.org/2000/svg" width="800px" height="600px" ` +
      `preserveAspectRatio="none" style="width:800px;height:600px;"><g/></svg>`;
    expect(rootAttr(normalizePlantUmlSvg(noViewBox), 'viewBox')).toBe('0 0 800 600');
  });

  it('leaves the inner markup untouched', () => {
    const out = normalizePlantUmlSvg(serverSvg(1046, 86));
    expect(out).toContain('<g><rect x="0" y="0" width="10" height="10"/></g>');
    expect(out.split('<svg').length).toBe(2);
  });

  it('returns non-SVG input unchanged rather than throwing', () => {
    expect(normalizePlantUmlSvg('')).toBe('');
    expect(normalizePlantUmlSvg('server error')).toBe('server error');
  });

  it('is idempotent', () => {
    const once = normalizePlantUmlSvg(serverSvg(6228, 2564));
    expect(normalizePlantUmlSvg(once)).toBe(once);
  });
});

describe('readPlantUmlSvgSize', () => {
  it('reads the intrinsic size from the server response', () => {
    expect(readPlantUmlSvgSize(serverSvg(6228, 2564))).toEqual({ width: 6228, height: 2564 });
  });

  it('still reads it after normalisation has dropped width/height', () => {
    expect(readPlantUmlSvgSize(normalizePlantUmlSvg(serverSvg(6228, 2564)))).toEqual({
      width: 6228,
      height: 2564,
    });
  });

  it('returns null when there is nothing to read', () => {
    expect(readPlantUmlSvgSize('server error')).toBeNull();
    expect(readPlantUmlSvgSize('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>')).toBeNull();
    expect(readPlantUmlSvgSize('<svg viewBox="0 0 0 0"><g/></svg>')).toBeNull();
  });
});
