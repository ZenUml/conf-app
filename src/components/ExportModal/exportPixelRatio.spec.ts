import { describe, it, expect, afterEach, vi } from 'vitest';
import { computeExportPixelRatio } from './exportPixelRatio';

/**
 * The defect: Export PNG rasterises at the diagram's ON-SCREEN size, so a
 * vector diagram that the macro column has shrunk to fit exports at that
 * shrunken size. Production page 2774138946's second macro is a PlantUML SVG
 * whose viewBox is 4647x1469 rendered into a 562px column — the exported PNG
 * came back 562x178, an 8.3x loss of detail the source still carried.
 */

function makeNode(clientWidth: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
  document.body.appendChild(el);
  return el;
}

/**
 * Appends an <svg> with a viewBox and a stubbed rendered box. jsdom lays
 * nothing out, so `getBoundingClientRect` is stubbed the way
 * `captureBlob.spec.ts` stubs `clientWidth`.
 */
function appendSvg(
  node: HTMLElement,
  { viewBox, renderedWidth, renderedHeight = 10 }: { viewBox: string | null; renderedWidth: number; renderedHeight?: number },
): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (viewBox) svg.setAttribute('viewBox', viewBox);
  svg.getBoundingClientRect = () =>
    ({ width: renderedWidth, height: renderedHeight }) as DOMRect;
  node.appendChild(svg);
  return svg;
}

function setDevicePixelRatio(value: number) {
  Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true });
}

describe('computeExportPixelRatio', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    setDevicePixelRatio(1);
    vi.restoreAllMocks();
  });

  it('scales up to the source vector resolution for a diagram shrunk to fit the column', () => {
    // The production case: PlantUML viewBox 4647x1469 in a 562px macro column.
    setDevicePixelRatio(1);
    const node = makeNode(562);
    appendSvg(node, { viewBox: '0 0 4647 1469', renderedWidth: 562, renderedHeight: 178 });

    expect(computeExportPixelRatio(node)).toBeCloseTo(4647 / 562, 4);
  });

  it('does not multiply the source scale by the device pixel ratio', () => {
    // A Retina screen already exports at 2x; the source only carries 8.3x of
    // real detail, so the answer is the larger of the two, never the product.
    setDevicePixelRatio(2);
    const node = makeNode(562);
    appendSvg(node, { viewBox: '0 0 4647 1469', renderedWidth: 562, renderedHeight: 178 });

    expect(computeExportPixelRatio(node)).toBeCloseTo(4647 / 562, 4);
  });

  it('keeps the device pixel ratio when the diagram renders at or above 1:1', () => {
    // ZenUML sequence and any fullscreen 1:1 render: nothing to recover.
    setDevicePixelRatio(2);
    const node = makeNode(600);
    appendSvg(node, { viewBox: '0 0 400 300', renderedWidth: 600, renderedHeight: 450 });

    expect(computeExportPixelRatio(node)).toBe(2);
  });

  it('ignores a small icon SVG that is not the diagram', () => {
    // Production's sequence macro has a 214x214 icon inside the capture node;
    // sizing the export off it would inflate a 1:1 diagram ~9x for nothing.
    setDevicePixelRatio(1);
    const node = makeNode(562);
    appendSvg(node, { viewBox: '0 0 214.27 214.27', renderedWidth: 24, renderedHeight: 24 });

    expect(computeExportPixelRatio(node)).toBe(1);
  });

  it('measures the widest rendered SVG when the node holds several', () => {
    setDevicePixelRatio(1);
    const node = makeNode(562);
    appendSvg(node, { viewBox: '0 0 214.27 214.27', renderedWidth: 24, renderedHeight: 24 });
    appendSvg(node, { viewBox: '0 0 4647 1469', renderedWidth: 562, renderedHeight: 178 });

    expect(computeExportPixelRatio(node)).toBeCloseTo(4647 / 562, 4);
  });

  it('falls back to the device pixel ratio when the node holds no SVG', () => {
    setDevicePixelRatio(2);
    const node = makeNode(562);
    expect(computeExportPixelRatio(node)).toBe(2);
  });

  it('falls back to the device pixel ratio for an SVG with no viewBox', () => {
    setDevicePixelRatio(1);
    const node = makeNode(562);
    appendSvg(node, { viewBox: null, renderedWidth: 562, renderedHeight: 178 });

    expect(computeExportPixelRatio(node)).toBe(1);
  });

  it('caps a tall diagram on its height, which is the axis that overflows first', () => {
    // Height, not width, is what a many-step PlantUML flow runs out of: a
    // 7500px-tall render asking for its source scale would need a 30000px
    // canvas, and past 16384 html-to-image shrinks both axes back down —
    // spending the memory and returning the detail.
    setDevicePixelRatio(1);
    const node = makeNode(500);
    appendSvg(node, { viewBox: '0 0 2000 30000', renderedWidth: 500, renderedHeight: 7500 });

    expect(computeExportPixelRatio(node) * 7500).toBeLessThanOrEqual(16384);
  });

  it('caps the ratio so the canvas stays inside the browser dimension limit', () => {
    // A 40000px-wide source in a 500px column would ask for 80x, i.e. a
    // 40000px canvas; browsers cap a canvas dimension at 16384px and
    // html-to-image shrinks past it, which would undo the gain.
    setDevicePixelRatio(1);
    const node = makeNode(500);
    appendSvg(node, { viewBox: '0 0 40000 1000', renderedWidth: 500, renderedHeight: 12 });

    expect(computeExportPixelRatio(node) * 500).toBeLessThanOrEqual(16384);
  });
});
