/**
 * Engine-agnostic geometry probes for the shared pan/zoom viewport.
 *
 * One control drives three engines — svg-pan-zoom for Mermaid and PlantUML,
 * mxGraph for Graph, a CSS transform for Sequence — so the render specs assert
 * what the reader sees rather than how it was produced. Everything here reads
 * painted geometry only, and nothing reaches into a component's state.
 */
import { expect, type FrameLocator } from '@playwright/test';
import { TIMEOUTS } from '../config/test-config.js';

/**
 * The horizontal scale actually painted, or null when nothing has rendered yet.
 *
 * `getScreenCTM().a` covers both SVG engines: svg-pan-zoom writes a transform
 * onto its viewport group, mxGraph onto the view's. Sequence renders HTML, so
 * its CSS transform is read from the element instead.
 */
export async function readDrawnScale(frame: FrameLocator): Promise<number | null> {
  return frame.locator('body').evaluate(() => {
    const cssTarget = document.querySelector<HTMLElement>('.zenuml > div');
    if (cssTarget) {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(cssTarget).transform);
      return matrix.a || null;
    }
    // The biggest SVG is the diagram; the small ones are toolbar icons — the
    // same reasoning as MacroPage.assertMacroRendersDiagram. The licence
    // watermark overlay is excluded for the same reason as there.
    const measured = ([...document.querySelectorAll('svg:not([data-testid="license-watermark"])')] as SVGSVGElement[])
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { el, area: rect.width * rect.height };
      })
      .sort((a, b) => b.area - a.area)[0];
    if (!measured || measured.area === 0) return null;
    // svg-pan-zoom writes its transform onto a named group; mxGraph onto the
    // view's first one. Prefer the named one so this cannot read an inner group.
    const group =
      measured.el.querySelector('.svg-pan-zoom_viewport') ?? measured.el.querySelector('g');
    return (group as SVGGraphicsElement | null)?.getScreenCTM()?.a ?? null;
  });
}

/** Wait for the diagram to report a scale at all, then return it. */
export async function settledScale(frame: FrameLocator): Promise<number> {
  await expect
    .poll(() => readDrawnScale(frame), {
      timeout: TIMEOUTS.FRAME_LOAD,
      message: 'the diagram never reported a drawn scale — nothing rendered in the macro frame',
    })
    .not.toBeNull();
  return (await readDrawnScale(frame)) as number;
}

/**
 * The initial view is fitted, never magnified.
 *
 * The regression this pins: `fit: true` scales to fill the box in BOTH axes, so
 * a diagram smaller than its column was enlarged rather than fitted — a 247x188
 * PlantUML measured 2.36x in a 760px column and ~3x in the editor pane. Opening
 * a diagram is not a request to magnify it. The tolerance absorbs sub-pixel
 * rounding in the CTM.
 */
export async function expectNotMagnified(frame: FrameLocator): Promise<void> {
  const scale = await settledScale(frame);
  expect(scale, `initial render is magnified ${scale.toFixed(2)}x`).toBeLessThanOrEqual(1.01);
  expect(scale, `initial render collapsed to ${scale.toFixed(2)}x`).toBeGreaterThan(0);
}

/**
 * Zoom in grows the diagram, up to natural size and no further.
 *
 * Each engine steps by its own factor (svg-pan-zoom 1.1, the Graph and CSS
 * viewports 1.2), so this asserts the direction rather than the size. The
 * ceiling is natural size: a diagram that already opens there has nothing to
 * zoom into, and its Zoom in button is disabled instead of doing nothing.
 */
export async function expectZoomInGrows(frame: FrameLocator, label: string): Promise<void> {
  const before = await settledScale(frame);
  // Scoped to this toolbar rather than matched by name across the frame:
  // getByRole matches the accessible name by SUBSTRING, which is how
  // viewer-preview-overflow-menu.spec.ts hit a strict-mode violation once a
  // second button shared a word.
  const zoomIn = frame
    .getByRole('toolbar', { name: `${label} zoom controls` })
    .getByRole('button', { name: 'Zoom in' });
  // The button decides the branch, not the measured scale: a diagram that fits
  // at 0.99x still has 1% to go and keeps Zoom in, which a scale threshold here
  // misread as "already natural size" (Mermaid, CI 2026-11-18).
  if (await zoomIn.isDisabled()) {
    expect(before, `Zoom in is disabled at ${before.toFixed(2)}x, below natural size`).toBeGreaterThanOrEqual(NATURAL_SIZE);
    return;
  }
  await zoomIn.click();
  await expect
    .poll(() => readDrawnScale(frame), {
      timeout: TIMEOUTS.FRAME_LOAD,
      message: 'the diagram did not grow after Zoom in',
    })
    .toBeGreaterThan(before);
  // Never past natural size, however many steps.
  for (let i = 0; i < 30 && (await zoomIn.isEnabled()); i += 1) await zoomIn.click();
  await expect(zoomIn, 'Zoom in still enabled after zooming to the ceiling').toBeDisabled();
  const after = await readDrawnScale(frame);
  expect(after, `zoomed past natural size: ${after?.toFixed(2)}x`).toBeLessThanOrEqual(1.01);
}

/** A drawn scale at or above this is natural size, allowing sub-pixel rounding. */
const NATURAL_SIZE = 0.99;

/**
 * The zoom chip is present and named for its renderer. Named, not positional:
 * DiagramViewport and ForgeGraphViewer render the same chip, and the accessible
 * label is what says which engine is behind it.
 */
export async function expectZoomControls(frame: FrameLocator, label: string): Promise<void> {
  await expect(frame.getByRole('toolbar', { name: `${label} zoom controls` })).toBeVisible({
    timeout: TIMEOUTS.FRAME_LOAD,
  });
}
