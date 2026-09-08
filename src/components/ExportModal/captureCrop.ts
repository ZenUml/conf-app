/**
 * Cropping a capture down to the diagram box the viewer itself lays out.
 *
 * WHY. The capture node is `.screen-capture-content`, and in fullscreen
 * GenericViewer gives it the layout column's width, not the diagram's:
 *
 *   .viewer-frame--fullscreen .screen-capture-content { width: 100%; max-width: 1000px }
 *   .viewer-frame--fullscreen .screen-capture-content--uncapped { max-width: none }
 *
 * That column is deliberate — it is what lines the byline up with the diagram —
 * but the exported PNG then carries the column's slack. Measured on lite-dev: a
 * small DrawIO graph exported as a 1630x151 strip with its nodes crowded at the
 * left edge.
 *
 * WHAT THE CROP MUST PRESERVE. The PNG has to look like view mode: same
 * framing, same relative positions, same proportions, same whitespace the
 * diagram renders for itself. So this neither trims to the ink nor adds padding
 * of its own — both would invent a framing the user never saw.
 *
 * HOW. Walk the single-child chain from the capture node. A wrapper the same
 * size as the capture is part of the column and is passed through; the first
 * element that is genuinely smaller is the diagram's own box, and the walk
 * stops there, keeping everything inside it exactly as laid out. A branch (more
 * than one child) means the capture node is itself the diagram's box, and
 * nothing is cropped. The measurement is geometric, never colour-based: a
 * white-pixel scan cannot tell a diagram's intended background from the
 * column's.
 */

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Tolerance for "same size as its parent", in CSS pixels. */
const SIZE_SLACK = 0.5;

/**
 * The diagram box must be at most this fraction of the capture before cropping
 * is worth doing. Above it the capture is already close to the diagram's own
 * size (the inline case, where the frame shrink-wraps it) and the difference is
 * the frame's own border/padding, not a column to remove.
 */
const MAX_KEPT_FRACTION = 0.75;

function contains(outer: CropBox, inner: CropBox): boolean {
  return outer.x <= inner.x + SIZE_SLACK
    && outer.y <= inner.y + SIZE_SLACK
    && outer.x + outer.width >= inner.x + inner.width - SIZE_SLACK
    && outer.y + outer.height >= inner.y + inner.height - SIZE_SLACK;
}

/**
 * The diagram's own box inside `node`, or null when the capture already is
 * that box.
 */
export function measureDiagramBox(node: HTMLElement): CropBox | null {
  const nodeRect = node.getBoundingClientRect();
  if (!nodeRect.width || !nodeRect.height) return null;

  const toLocal = (rect: DOMRect): CropBox => ({
    x: rect.left - nodeRect.left,
    y: rect.top - nodeRect.top,
    width: rect.width,
    height: rect.height,
  });

  let current: Element = node;
  let currentRect: CropBox = { x: 0, y: 0, width: nodeRect.width, height: nodeRect.height };
  while (true) {
    // An <svg> ends the walk: its children report SVG user units, not CSS
    // pixels, so their rects say nothing about the page's layout.
    if (current.tagName.toLowerCase() === 'svg') break;
    const children = Array.from(current.children)
      .map((child) => ({ child, rect: toLocal(child.getBoundingClientRect()) }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0);
    if (children.length !== 1) break;

    const [only] = children;
    if (!contains(currentRect, only.rect)) break;
    const shrank = only.rect.width < currentRect.width - SIZE_SLACK
      || only.rect.height < currentRect.height - SIZE_SLACK;
    current = only.child;
    currentRect = only.rect;
    if (shrank) break;
  }
  if (current === node) return null;

  const x = Math.max(0, Math.floor(currentRect.x));
  const y = Math.max(0, Math.floor(currentRect.y));
  const width = Math.min(nodeRect.width, Math.ceil(currentRect.x + currentRect.width)) - x;
  const height = Math.min(nodeRect.height, Math.ceil(currentRect.y + currentRect.height)) - y;
  if (width <= 0 || height <= 0) return null;

  const worthCropping = width <= nodeRect.width * MAX_KEPT_FRACTION
    || height <= nodeRect.height * MAX_KEPT_FRACTION;
  return worthCropping ? { x, y, width, height } : null;
}

/**
 * Crop `canvas` to `box`, where `box` is in CSS pixels of a node captured at
 * `scale` device pixels per CSS pixel. Returns null when there is nothing to do.
 */
export function cropCanvasToBox(
  canvas: HTMLCanvasElement,
  box: CropBox,
  scale: number,
): HTMLCanvasElement | null {
  const x = Math.max(0, Math.round(box.x * scale));
  const y = Math.max(0, Math.round(box.y * scale));
  const width = Math.min(canvas.width - x, Math.round(box.width * scale));
  const height = Math.min(canvas.height - y, Math.round(box.height * scale));
  if (width <= 0 || height <= 0) return null;
  if (width === canvas.width && height === canvas.height) return null;

  const cropped = document.createElement('canvas');
  cropped.width = width;
  cropped.height = height;
  const ctx = cropped.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(canvas, x, y, width, height, 0, 0, width, height);
  return cropped;
}

/** The whole measurement, for a node that is about to be captured. */
export function measureCaptureCrop(node: HTMLElement): CropBox | null {
  return measureDiagramBox(node);
}
