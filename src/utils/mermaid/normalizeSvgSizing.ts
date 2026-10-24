/**
 * Strip the fixed pixel height mermaid emits under `useMaxWidth: false`.
 *
 * Mermaid.vue renders the SVG inside a `flex justify-center` container. Flexbox
 * shrinks a flex item's *width* to fit, but nothing touches an explicit `height`
 * attribute. With `preserveAspectRatio` at its default `xMidYMid meet` the
 * drawing therefore scales down to the container width and is then centred in a
 * box that is still as tall as the diagram's unscaled height — a white band
 * above it and another below.
 *
 * Measured on Lite production 2026-09-07 in a 562px viewer: a 1766x4754 diagram
 * drew 562x1493 inside a 4754px-tall box, i.e. 1630px of white on top.
 *
 * The fix rewrites that shape into the one mermaid produces under its default
 * `useMaxWidth: true` — `width="100%"`, no height, `max-width` at the diagram's
 * natural width — which the browser sizes from the viewBox with no gap. The
 * rendered scale is unchanged; only the dead space goes away.
 *
 * Anything else (already-relative width, no width/height, non-SVG input) is
 * returned byte-for-byte.
 */
export function normalizeSvgSizing(svg: string): string {
  if (typeof svg !== 'string' || svg === '') return svg;

  const openTag = /<svg\b[^>]*>/i.exec(svg);
  if (!openTag) return svg;

  const tag = openTag[0];
  const width = readAttribute(tag, 'width');
  const height = readAttribute(tag, 'height');

  // Only the fixed-pixel pair letterboxes. `width="100%"` with no height is
  // already correct, and a diagram with neither is sized from its viewBox.
  if (!isPixelLength(width) || !isPixelLength(height)) return svg;

  let rewritten = tag
    .replace(/\s+height\s*=\s*("[^"]*"|'[^']*')/i, '')
    .replace(/\s+width\s*=\s*("[^"]*"|'[^']*')/i, ' width="100%"');
  rewritten = withMaxWidth(rewritten, `${width}px`);

  return svg.slice(0, openTag.index) + rewritten + svg.slice(openTag.index + tag.length);
}

function readAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  if (!match) return null;
  return match[2] ?? match[3] ?? null;
}

/** A bare number, which SVG reads as user units — mermaid never emits a unit here. */
function isPixelLength(value: string | null): boolean {
  return value !== null && value !== '' && Number.isFinite(Number(value));
}

function withMaxWidth(tag: string, maxWidth: string): string {
  const style = readAttribute(tag, 'style');
  if (style === null) {
    return tag.replace(/<svg\b/i, `<svg style="max-width: ${maxWidth};"`);
  }
  if (/(^|;)\s*max-width\s*:/i.test(style)) return tag;
  const separator = style.trim().endsWith(';') || style.trim() === '' ? '' : ';';
  return tag.replace(
    /\bstyle\s*=\s*("[^"]*"|'[^']*')/i,
    `style="${style}${separator} max-width: ${maxWidth};"`,
  );
}
