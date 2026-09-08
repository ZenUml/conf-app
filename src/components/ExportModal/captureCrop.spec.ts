import { describe, expect, it, vi } from 'vitest';
import { cropCanvasToBox, measureCaptureCrop, measureDiagramBox } from './captureCrop';

/**
 * jsdom lays nothing out, so every rect is stubbed. The shapes below are the
 * ones the bug takes: a fullscreen capture column far wider than the diagram
 * inside it (DrawIO and ZenUML sequence alike), and a diagram that already
 * fills its box (the inline case, which must stay untouched).
 */
function stubRect(el: Element, rect: { x: number; y: number; width: number; height: number }) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    x: rect.x, y: rect.y, left: rect.x, top: rect.y,
    width: rect.width, height: rect.height,
    right: rect.x + rect.width, bottom: rect.y + rect.height,
    toJSON() {},
  } as DOMRect);
}

function el(tag: string, rect: { x: number; y: number; width: number; height: number }) {
  const node = tag === 'svg'
    ? document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    : document.createElement(tag);
  stubRect(node, rect);
  return node;
}

describe('measureDiagramBox', () => {
  it('crops a short sequence diagram to its own box, keeping the padding it renders', () => {
    // .screen-capture-content, the 1000px fullscreen column
    const node = el('div', { x: 0, y: 0, width: 1000, height: 200 }) as HTMLElement;
    // The diagram's own box: its 24px padding is whitespace the viewer draws,
    // and the PNG has to keep it.
    const diagram = el('div', { x: 0, y: 0, width: 340, height: 160 });
    const ink = el('span', { x: 24, y: 24, width: 292, height: 112 });
    diagram.appendChild(ink);
    node.appendChild(diagram);

    expect(measureDiagramBox(node)).toEqual({ x: 0, y: 0, width: 340, height: 160 });
  });

  it('passes through full-width wrappers and stops at the graph box', () => {
    const node = el('div', { x: 0, y: 0, width: 1630, height: 200 }) as HTMLElement;
    // A wrapper as wide as the column belongs to the column, not the diagram.
    const wrapper = el('div', { x: 0, y: 0, width: 1630, height: 200 });
    const graph = el('div', { x: 8, y: 10, width: 260, height: 150 });
    const svg = el('svg', { x: 28, y: 30, width: 220, height: 110 });
    // SVG children report user units, not CSS pixels; the walk must not follow
    // them.
    svg.appendChild(el('path', { x: 0, y: 0, width: 5000, height: 5000 }));
    graph.appendChild(svg);
    wrapper.appendChild(graph);
    node.appendChild(wrapper);

    expect(measureDiagramBox(node)).toEqual({ x: 8, y: 10, width: 260, height: 150 });
  });

  it('adds no padding of its own', () => {
    const node = el('div', { x: 0, y: 0, width: 900, height: 300 }) as HTMLElement;
    const diagram = el('div', { x: 12, y: 20, width: 200, height: 100 });
    diagram.appendChild(el('span', { x: 12, y: 20, width: 200, height: 100 }));
    node.appendChild(diagram);

    // Flush with the diagram box, because that is how the viewer renders it.
    expect(measureDiagramBox(node)).toEqual({ x: 12, y: 20, width: 200, height: 100 });
  });

  it('does not crop when the capture already shrink-wraps the diagram', () => {
    // The inline case: the frame is the diagram's own width, so there is no
    // column slack and cropping could only shave its edge.
    const node = el('div', { x: 0, y: 0, width: 420, height: 200 }) as HTMLElement;
    const diagram = el('div', { x: 10, y: 10, width: 400, height: 180 });
    diagram.appendChild(el('span', { x: 10, y: 10, width: 400, height: 180 }));
    node.appendChild(diagram);

    expect(measureCaptureCrop(node)).toBeNull();
  });

  it('does not crop when the capture node holds the layout itself', () => {
    // Several siblings: the capture node IS the diagram's box, and any smaller
    // box would be one this code invented.
    const node = el('div', { x: 0, y: 0, width: 1000, height: 200 }) as HTMLElement;
    node.appendChild(el('div', { x: 24, y: 24, width: 300, height: 40 }));
    node.appendChild(el('div', { x: 24, y: 80, width: 320, height: 40 }));

    expect(measureDiagramBox(node)).toBeNull();
  });

  it('returns null for an empty capture', () => {
    expect(measureDiagramBox(el('div', { x: 0, y: 0, width: 500, height: 200 }) as HTMLElement)).toBeNull();
  });
});

describe('cropCanvasToBox', () => {
  it('scales the CSS-pixel box into capture pixels', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2000;
    canvas.height = 400;
    const drawImage = vi.fn();

    const target = document.createElement('canvas');
    vi.spyOn(target, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(document, 'createElement').mockReturnValueOnce(target);

    const cropped = cropCanvasToBox(canvas, { x: 8, y: 10, width: 260, height: 150 }, 2);
    expect(cropped).toBe(target);
    expect(target.width).toBe(520);
    expect(target.height).toBe(300);
    expect(drawImage).toHaveBeenCalledWith(canvas, 16, 20, 520, 300, 0, 0, 520, 300);
    vi.restoreAllMocks();
  });

  it('declines when the box already covers the canvas', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 200;
    expect(cropCanvasToBox(canvas, { x: 0, y: 0, width: 600, height: 200 }, 1)).toBeNull();
  });
});
