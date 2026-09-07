/**
 * Make a plantuml.com SVG scale proportionally inside the macro frame (conf-app#626).
 *
 * The server emits a root like
 *   <svg width="6228px" height="2564px" preserveAspectRatio="none"
 *        style="width:6228px;height:2564px;background:#FFFFFF;" viewBox="0 0 6228 2564">
 *
 * PlantUml.vue injects that into `.flex.justify-center`, so the SVG is a flex item and
 * shrinks from 6228px to the frame width. `preserveAspectRatio="none"` then stretches the
 * drawing to the new box instead of scaling it: the width collapses ~8x while the height
 * stays at 2564px, and the diagram reads as a blank sliver. Nothing errors, and
 * `macro_viewed` still reports a successful render, so the defect is invisible in telemetry.
 *
 * Constraining width alone does not help — squashing is already what the layout does. The
 * root has to give up its fixed pixel sizing and keep its ratio: drop width/height, keep the
 * viewBox as the coordinate system, and let `height:auto` plus PlantUml.vue's
 * `max-width:100%` size it.
 */

const ROOT_TAG = /<svg\b[^>]*>/i;

/** Strip an attribute from a root tag string, e.g. ` width="6228px"`. */
function withoutAttr(tag: string, name: string): string {
  return tag.replace(new RegExp(`\\s${name}="[^"]*"`, 'i'), '');
}

function readAttr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'));
  return m ? m[1] : null;
}

/** `"6228px"` / `"6228"` -> 6228; anything else -> null. */
function toPx(value: string | null): number | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d+(?:\.\d+)?)(px)?$/i);
  return m ? Number(m[1]) : null;
}

/**
 * Drop the declarations that pin a fixed size, keep everything else the server set
 * (`background` in particular), then add the proportional sizing.
 */
function normalizeStyle(style: string | null): string {
  const kept = (style || '')
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => !/^(width|height|max-width)\s*:/i.test(d));
  // `height:auto` has to be inline: it pairs with the dropped height attribute so the
  // root keeps its ratio even before any stylesheet applies. The fit-to-width cap is
  // NOT inline — PlantUml.vue owns it in CSS, so the fullscreen rule can override it
  // (an inline max-width would outrank every stylesheet and pin the diagram to the
  // column width, leaving nothing to scroll).
  kept.push('height:auto');
  return `${kept.join(';')};`;
}

/**
 * The diagram's intrinsic pixel size, read from the root's width/height or its viewBox.
 *
 * Normalising drops the width/height attributes, so this is the only way left to know how
 * wide the drawing really is — fullscreen uses it to render at 1:1 and scroll, instead of
 * fitting a 6000px diagram into the column at unreadable size.
 */
export function readPlantUmlSvgSize(
  svg: string,
): { width: number; height: number } | null {
  const match = svg?.match(ROOT_TAG);
  if (!match) return null;
  const tag = match[0];

  const width = toPx(readAttr(tag, 'width'));
  const height = toPx(readAttr(tag, 'height'));
  if (width !== null && height !== null) return { width, height };

  const viewBox = readAttr(tag, 'viewBox');
  if (!viewBox) return null;
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  if (parts[2] <= 0 || parts[3] <= 0) return null;
  return { width: parts[2], height: parts[3] };
}

export function normalizePlantUmlSvg(svg: string): string {
  if (!svg) return svg;
  const match = svg.match(ROOT_TAG);
  if (!match) return svg;

  const original = match[0];
  const width = toPx(readAttr(original, 'width'));
  const height = toPx(readAttr(original, 'height'));

  let tag = withoutAttr(withoutAttr(original, 'width'), 'height');

  // The viewBox is the only remaining record of the diagram's intrinsic size once the
  // width/height attributes are gone, so synthesise one when the server omitted it.
  if (!readAttr(tag, 'viewBox') && width !== null && height !== null) {
    tag = tag.replace(/<svg\b/i, `<svg viewBox="0 0 ${width} ${height}"`);
  }

  const style = normalizeStyle(readAttr(tag, 'style'));
  tag = withoutAttr(tag, 'style');
  tag = withoutAttr(tag, 'preserveAspectRatio');
  tag = tag.replace(
    /\s*(\/?)>$/,
    ` preserveAspectRatio="xMidYMid meet" style="${style}"$1>`,
  );

  return svg.replace(original, tag);
}
