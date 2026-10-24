import { test, expect, type Download, type Page } from './mixpanel-test.js';
import { readFileSync } from 'node:fs';

const TEST_URL = '/test-viewer.html';

/**
 * Below this, in either dimension, the "export" is a blank/degenerate canvas
 * rather than a diagram. The sequence fixture renders several hundred px wide
 * (and the preview is captured at pixelRatio 2, so its decoded size is double
 * that again); the PlantUML fixture's server raster is ~400x200. 100px is
 * comfortably under all of those and comfortably over the failure mode this
 * guards (a 1x1 / 0.5x0.5 image, which still serializes to a perfectly
 * well-formed PNG).
 */
const MIN_EXPORT_DIMENSION_PX = 100;

// The sequence sandbox fixture (custom-content-by-id-v1-diagram-sequence.json)
// embeds title "20241006 Order Service (Demonstration only)" in its body.raw.value —
// that's what GenericViewer's `title` computed reads, and what ExportModal's
// `diagramTitle` prop (and therefore slugifyFilename()) actually receives.
const EXPECTED_EXPORT_FILENAME = '20241006-order-service-demonstration-only.png';

// ─── Shared Helpers ───

/**
 * Default is `seq-fullscreen`, NOT `seq-view`. Since the staged-header redesign
 * the inline viewer has no Export PNG button on the canvas: it lives in the
 * header More menu, and choosing it routes through forgeIndex's fullscreen
 * handler (`openModal` over the Forge bridge), which the standalone sandbox does
 * not have — the menu item does nothing here (measured 2026-10-21). In the
 * Fullscreen viewer Export PNG is a header button and opens the dialog in place,
 * which is the same dialog the Forge modal hosts. Other presets: see
 * src/sandbox/presets.ts.
 */
async function waitForViewerReady(page: Page, sandbox = 'seq-fullscreen') {
  await page.goto(`${TEST_URL}?outputType=display&sandbox=${sandbox}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.screen-capture-content', { timeout: 15000 });
  await page.waitForTimeout(1000);
}

/**
 * PNG IHDR width/height — bytes 16..23 of the file, after the 8-byte signature
 * and the IHDR length/type. Deliberately NOT a data-URL prefix check: a blank,
 * effectively zero-pixel canvas still serializes to a valid
 * `data:image/png;base64,...`, which is exactly how a blank PlantUML export
 * passed this suite unnoticed. Only real dimensions prove a real diagram.
 */
function readPngSize(bytes: Buffer | Uint8Array): { width: number; height: number } {
  const buf = Buffer.from(bytes);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(signature)) {
    throw new Error(`not a PNG: first bytes ${buf.subarray(0, 8).toString('hex')}`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Decoded dimensions of whatever the preview <img> is currently showing. */
async function previewImageSize(page: Page): Promise<{ width: number; height: number }> {
  const img = page.locator('img[alt="Diagram preview"]');
  await expect(img).toBeVisible({ timeout: 10000 });
  // naturalWidth stays 0 until the browser has decoded the src.
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 10000 })
    .toBeGreaterThan(0);
  return img.evaluate((el: HTMLImageElement) => ({ width: el.naturalWidth, height: el.naturalHeight }));
}

/** Read the bytes Playwright actually saved and decode their real size. */
async function downloadedPngSize(download: Download): Promise<{ width: number; height: number }> {
  const path = await download.path();
  expect(path).toBeTruthy();
  return readPngSize(readFileSync(path!));
}

function expectRealDiagram(size: { width: number; height: number }, what: string) {
  expect(size.width, `${what} width`).toBeGreaterThan(MIN_EXPORT_DIMENSION_PX);
  expect(size.height, `${what} height`).toBeGreaterThan(MIN_EXPORT_DIMENSION_PX);
}

async function openExportModal(page: Page) {
  const exportBtn = page.getByRole('button', { name: 'Export PNG', exact: true });
  await expect(exportBtn).toBeVisible({ timeout: 5000 });
  await exportBtn.click();
  await page.waitForSelector('.export-modal-backdrop', { timeout: 5000 });
  // The preview <img> only mounts once the DOM capture succeeded, so this wait
  // is also the "capture pipeline works" assertion.
  await page.waitForSelector('img[alt="Diagram preview"]', { timeout: 10000 });
}

// ─── Workspace locators (ExportWorkspace.vue, replaced the sidebar dialog in 1cff9a2a8) ───

const toolbarButton = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: 'Export tools' }).getByRole('button', { name, exact: true });
const annotationCanvas = (page: Page) => page.locator('svg.annotation-canvas');
const overlay = (page: Page) => page.locator('.rendered-annotations svg');
const annotationProps = (page: Page) => page.locator('.context-tools[aria-label="Annotation properties"]');
const watermarkProps = (page: Page) => page.locator('.context-tools[aria-label="Watermark properties"]');

async function canvasBox(page: Page) {
  const box = await annotationCanvas(page).boundingBox();
  if (!box) throw new Error('annotation canvas not found');
  return box;
}

/** Point inside the image, as fractions of its width/height. */
async function at(page: Page, fx: number, fy: number) {
  const box = await canvasBox(page);
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

async function clickTool(page: Page, label: string) {
  const btn = toolbarButton(page, label);
  await expect(btn).toBeVisible();
  await btn.click();
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

async function drawArrow(page: Page, from = [0.15, 0.2], to = [0.6, 0.5]) {
  await clickTool(page, 'Add arrow');
  await drag(page, await at(page, from[0], from[1]), await at(page, to[0], to[1]));
  await expect(overlay(page).locator('line')).toHaveCount(1);
}

async function drawRectangle(page: Page) {
  await clickTool(page, 'Add rectangle');
  await drag(page, await at(page, 0.2, 0.3), await at(page, 0.5, 0.6));
  await expect(overlay(page).locator('rect')).toHaveCount(1);
}

/** Note and callout are placed by a click and then typed in an inline input. */
async function placeText(page: Page, tool: 'Add text' | 'Add callout', text: string, fx: number, fy: number) {
  await clickTool(page, tool);
  const p = await at(page, fx, fy);
  await page.mouse.click(p.x, p.y);
  const input = page.getByLabel('Annotation text');
  await expect(input).toBeFocused();
  await input.fill(text);
  await input.press('Enter');
  await expect(overlay(page).locator('text', { hasText: text })).toHaveCount(1);
}

const placeNote = (page: Page, text = 'Note', fx = 0.7, fy = 0.15) => placeText(page, 'Add text', text, fx, fy);
const placeCallout = (page: Page, text = 'Callout', fx = 0.4, fy = 0.7) => placeText(page, 'Add callout', text, fx, fy);

async function addWatermark(page: Page) {
  await clickTool(page, 'Add watermark');
  await expect(watermarkProps(page)).toBeVisible();
}

/** Select an annotation by clicking its hit target (the `<g>` the canvas draws). */
async function selectAnnotation(page: Page, type: 'arrow' | 'note' | 'callout' | 'rectangle', nth = 0) {
  const target = annotationCanvas(page).locator(`g[data-annotation-id][aria-label^="${type}:"]`).nth(nth);
  const box = await target.boundingBox();
  if (!box) throw new Error(`no ${type} annotation on the canvas`);
  // Rectangles are hit on their stroke only; everything else on the box centre.
  const p = type === 'rectangle'
    ? { x: box.x + box.width / 2, y: box.y + 1 }
    : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.click(p.x, p.y);
  await expect(annotationProps(page)).toBeVisible();
}

async function pickColor(page: Page, swatchLabel: string, choice: string) {
  await annotationProps(page).getByRole('button', { name: swatchLabel }).click();
  await page.getByRole('menuitem', { name: choice, exact: true }).click();
}

const exportButton = (page: Page) => toolbarButton(page, 'Download image');

// ─── Modal Structure ───

test.describe('Modal Structure', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
  });

  test('export dialog opens with toolbar and canvas stage', async ({ page }) => {
    await openExportModal(page);
    await expect(page.getByRole('toolbar', { name: 'Export tools' })).toBeVisible();
    await expect(page.locator('.workspace-stage')).toBeVisible();
    await expect(annotationCanvas(page)).toBeVisible();
  });

  test('toolbar offers select, four annotation tools and watermark', async ({ page }) => {
    await openExportModal(page);
    for (const name of ['Select and move', 'Add text', 'Add arrow', 'Add callout', 'Add rectangle', 'Add watermark']) {
      await expect(toolbarButton(page, name), name).toBeVisible();
    }
  });

  test('toolbar shows the Background control and the fixed PNG format label', async ({ page }) => {
    await openExportModal(page);
    await expect(page.getByLabel('Image background')).toBeVisible();
    await expect(page.locator('.format-label')).toHaveText('PNG');
  });

  test('toolbar reports the image size and zoom', async ({ page }) => {
    await openExportModal(page);
    await expect(page.locator('.image-meta', { hasText: 'Image size' })).toContainText(/\d+ × \d+/);
    await expect(page.locator('.image-meta', { hasText: 'Zoom' })).toContainText(/\d+%/);
  });

  test('no annotation properties are shown until something is selected', async ({ page }) => {
    await openExportModal(page);
    await expect(annotationProps(page)).toHaveCount(0);
    await expect(watermarkProps(page)).toHaveCount(0);
  });

  test('preview shows captured diagram image', async ({ page }) => {
    await openExportModal(page);
    const img = page.locator('img[alt="Diagram preview"]');
    await expect(img).toBeVisible();
    const src = await img.getAttribute('src');
    // A raster the browser can decode — either an inline data URL (DOM
    // capture) or an object URL (PlantUML's server PNG).
    expect(src).toMatch(/^(data:image\/png|blob:)/);

    // The assertion that matters. Checking only the data-URL prefix let a
    // blank, effectively zero-pixel capture pass this suite for two months
    // (the PlantUML Export PNG bug): a degenerate canvas still produces a
    // well-formed `data:image/png;base64,...`. Decode it and demand pixels.
    expectRealDiagram(await previewImageSize(page), 'preview image');
  });

  test('close button dismisses the dialog', async ({ page }) => {
    await openExportModal(page);
    await toolbarButton(page, 'Close export').click();
    await expect(page.locator('.export-modal-backdrop')).not.toBeVisible();
  });

  test('Refresh preview recaptures the diagram', async ({ page }) => {
    await openExportModal(page);
    await toolbarButton(page, 'Refresh preview').click();
    expectRealDiagram(await previewImageSize(page), 'refreshed preview');
  });
});

// ─── Dialog Accessibility ───

test.describe('Dialog Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('dialog has role="dialog", aria-modal="true" and a name', async ({ page }) => {
    const dialog = page.locator('.export-modal');
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAttribute('aria-label', 'Export image');
  });

  test('Escape closes the dialog when no tool or annotation is active', async ({ page }) => {
    await page.keyboard.press('Escape');
    await expect(page.locator('.export-modal-backdrop')).not.toBeVisible();
  });

  test('active tool is exposed through aria-pressed', async ({ page }) => {
    const arrow = toolbarButton(page, 'Add arrow');
    await expect(arrow).toHaveAttribute('aria-pressed', 'false');
    await arrow.click();
    await expect(arrow).toHaveAttribute('aria-pressed', 'true');
    await expect(toolbarButton(page, 'Select and move')).toHaveAttribute('aria-pressed', 'false');
  });
});

// ─── Background ───

test.describe('Background', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('every background option repaints the image surface', async ({ page }) => {
    const select = page.getByLabel('Image background');
    const surface = page.locator('.image-surface');
    const expected: Record<string, string> = {
      transparent: 'rgba(0, 0, 0, 0)',
      white: 'rgb(255, 255, 255)',
      warm: 'rgb(255, 251, 240)',
      cool: 'rgb(240, 244, 255)',
    };
    for (const [value, color] of Object.entries(expected)) {
      await select.selectOption(value);
      await expect(surface, value).toHaveCSS('background-color', color);
    }
  });

  test('transparent background leaves the stage checkerboard visible', async ({ page }) => {
    await page.getByLabel('Image background').selectOption('transparent');
    const bgImage = await page.locator('.workspace-stage').evaluate(el => getComputedStyle(el).backgroundImage);
    expect(bgImage).toContain('conic-gradient');
  });

  test('custom background offers a colour menu and applies a chosen colour', async ({ page }) => {
    await page.getByLabel('Image background').selectOption('custom');
    await page.getByRole('button', { name: 'Custom background color', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Cool', exact: true }).click();
    await expect(page.locator('.image-surface')).toHaveCSS('background-color', 'rgb(240, 244, 255)');
  });

  test('custom background rejects a malformed hex value', async ({ page }) => {
    await page.getByLabel('Image background').selectOption('custom');
    await page.getByRole('button', { name: 'Custom background color', exact: true }).click();
    await page.getByLabel('Custom background hex').fill('#12');
    await expect(page.getByText('Use #RRGGBB')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  });
});

// ─── Arrow Tool ───

test.describe('Arrow Tool', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('clicking the arrow tool activates it and arms a crosshair canvas', async ({ page }) => {
    await clickTool(page, 'Add arrow');
    await expect(toolbarButton(page, 'Add arrow')).toHaveAttribute('aria-pressed', 'true');
    await expect(annotationCanvas(page)).toHaveCSS('cursor', 'crosshair');
  });

  test('drag creates an arrow with a line and an arrowhead', async ({ page }) => {
    await drawArrow(page);
    await expect(overlay(page).locator('line')).toHaveCount(1);
    await expect(overlay(page).locator('path')).toHaveCount(1);
  });

  test('arrow tool deactivates after drawing', async ({ page }) => {
    await drawArrow(page);
    await expect(toolbarButton(page, 'Add arrow')).toHaveAttribute('aria-pressed', 'false');
  });

  test('a very short drag does not create an arrow', async ({ page }) => {
    await clickTool(page, 'Add arrow');
    const p = await at(page, 0.3, 0.3);
    await drag(page, p, { x: p.x + 1, y: p.y + 1 });
    await expect(overlay(page).locator('line')).toHaveCount(0);
    await expect(annotationProps(page)).toHaveCount(0);
  });

  test('the new arrow is selected and shows its properties', async ({ page }) => {
    await drawArrow(page);
    const props = annotationProps(page);
    await expect(props).toBeVisible();
    await expect(props.getByLabel('Annotation color', { exact: true })).toBeVisible();
    await expect(props.getByLabel('Stroke width')).toBeVisible();
    await expect(props.getByLabel('Arrow direction')).toBeVisible();
    await expect(props.getByLabel('Delete annotation')).toBeVisible();
  });

  test('start and end handles appear while the arrow is selected', async ({ page }) => {
    await drawArrow(page);
    await expect(page.locator('circle[aria-label="Drag start handle"]')).toBeVisible();
    await expect(page.locator('circle[aria-label="Drag end handle"]')).toBeVisible();
  });

  test('changing the arrow colour updates the rendered line', async ({ page }) => {
    await drawArrow(page);
    await pickColor(page, 'Annotation color', 'Blue');
    await expect(overlay(page).locator('line')).toHaveAttribute('stroke', '#2563eb');
  });

  test('dragging the end handle repositions the endpoint', async ({ page }) => {
    await drawArrow(page);
    const line = overlay(page).locator('line');
    const before = Number(await line.getAttribute('x2'));
    const handle = await page.locator('circle[aria-label="Drag end handle"]').boundingBox();
    if (!handle) throw new Error('end handle missing');
    const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await drag(page, from, { x: from.x - 80, y: from.y + 40 });
    await expect.poll(async () => Number(await line.getAttribute('x2'))).toBeLessThan(before);
  });

  test('dragging the arrow body moves the whole arrow', async ({ page }) => {
    await drawArrow(page);
    const line = overlay(page).locator('line');
    const x1 = Number(await line.getAttribute('x1'));
    const y1 = Number(await line.getAttribute('y1'));
    const hit = await annotationCanvas(page).locator('g[data-annotation-id]').first().boundingBox();
    if (!hit) throw new Error('arrow hit target missing');
    const from = { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 };
    await drag(page, from, { x: from.x + 40, y: from.y + 30 });
    await expect.poll(async () => Number(await line.getAttribute('x1'))).toBeGreaterThan(x1);
    expect(Number(await line.getAttribute('y1'))).toBeGreaterThan(y1);
  });
});

// ─── Note Tool ───

test.describe('Note Tool', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('clicking the text tool activates it', async ({ page }) => {
    await clickTool(page, 'Add text');
    await expect(toolbarButton(page, 'Add text')).toHaveAttribute('aria-pressed', 'true');
  });

  test('clicking the canvas opens an inline editor and the typed text is rendered', async ({ page }) => {
    await placeNote(page, 'Hello export');
    await expect(overlay(page).locator('text')).toHaveText('Hello export');
  });

  test('text tool deactivates after placing', async ({ page }) => {
    await placeNote(page);
    await expect(toolbarButton(page, 'Add text')).toHaveAttribute('aria-pressed', 'false');
  });

  test('committing an empty note discards it', async ({ page }) => {
    await clickTool(page, 'Add text');
    const p = await at(page, 0.5, 0.5);
    await page.mouse.click(p.x, p.y);
    const input = page.getByLabel('Annotation text');
    await expect(input).toBeFocused();
    await input.press('Enter');
    await expect(overlay(page).locator('text')).toHaveCount(0);
    await expect(annotationProps(page)).toHaveCount(0);
  });

  test('Escape while typing cancels a fresh note', async ({ page }) => {
    await clickTool(page, 'Add text');
    const p = await at(page, 0.5, 0.5);
    await page.mouse.click(p.x, p.y);
    const input = page.getByLabel('Annotation text');
    await input.fill('never kept');
    await input.press('Escape');
    await expect(overlay(page).locator('text')).toHaveCount(0);
    await expect(page.locator('.export-modal-backdrop')).toBeVisible();
  });

  test('a selected note shows text-specific properties', async ({ page }) => {
    await placeNote(page);
    await selectAnnotation(page, 'note');
    const props = annotationProps(page);
    await expect(props.getByLabel('Edit text')).toBeVisible();
    await expect(props.getByLabel('Font size')).toBeVisible();
    await expect(props.getByLabel('Stroke width')).toHaveCount(0);
  });

  test('double-click re-opens the editor and updates the rendered text', async ({ page }) => {
    await placeNote(page, 'Before');
    const hit = await annotationCanvas(page).locator('g[data-annotation-id]').first().boundingBox();
    if (!hit) throw new Error('note hit target missing');
    await page.mouse.dblclick(hit.x + hit.width / 2, hit.y + hit.height / 2);
    const input = page.getByLabel('Annotation text');
    await expect(input).toBeFocused();
    await input.fill('After');
    await input.press('Enter');
    await expect(overlay(page).locator('text')).toHaveText('After');
  });

  test('the Edit text button updates the rendered text', async ({ page }) => {
    await placeNote(page, 'Before');
    await selectAnnotation(page, 'note');
    await annotationProps(page).getByLabel('Edit text').click();
    const input = page.getByLabel('Annotation text');
    await input.fill('Via button');
    await input.press('Enter');
    await expect(overlay(page).locator('text')).toHaveText('Via button');
  });

  test('note colour change updates the rendered fill', async ({ page }) => {
    await placeNote(page);
    await selectAnnotation(page, 'note');
    await pickColor(page, 'Annotation color', 'Red');
    await expect(overlay(page).locator('text')).toHaveAttribute('fill', '#dc2626');
  });

  test('note font size change updates the rendered font-size', async ({ page }) => {
    await placeNote(page);
    await selectAnnotation(page, 'note');
    const size = annotationProps(page).getByLabel('Font size');
    await size.fill('32');
    await size.press('Enter');
    await size.blur();
    await expect(overlay(page).locator('text')).toHaveAttribute('font-size', '32');
  });

  test('note has a drop shadow filter in the overlay', async ({ page }) => {
    await placeNote(page);
    await expect(overlay(page).locator('text')).toHaveAttribute('filter', 'url(#ds)');
    await expect(overlay(page).locator('filter#ds')).toHaveCount(1);
  });

  test('dragging a note moves it', async ({ page }) => {
    await placeNote(page);
    const text = overlay(page).locator('text');
    const x = Number(await text.getAttribute('x'));
    const hit = await annotationCanvas(page).locator('g[data-annotation-id]').first().boundingBox();
    if (!hit) throw new Error('note hit target missing');
    const from = { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 };
    await drag(page, from, { x: from.x - 100, y: from.y + 60 });
    await expect.poll(async () => Number(await text.getAttribute('x'))).toBeLessThan(x);
  });
});

// ─── Callout Tool ───

test.describe('Callout Tool', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('clicking the callout tool activates it', async ({ page }) => {
    await clickTool(page, 'Add callout');
    await expect(toolbarButton(page, 'Add callout')).toHaveAttribute('aria-pressed', 'true');
  });

  test('placing a callout renders a bubble path and its text', async ({ page }) => {
    await placeCallout(page, 'Look here');
    await expect(overlay(page).locator('path')).toHaveCount(1);
    await expect(overlay(page).locator('text')).toHaveText('Look here');
  });

  test('callout tool deactivates after placing', async ({ page }) => {
    await placeCallout(page);
    await expect(toolbarButton(page, 'Add callout')).toHaveAttribute('aria-pressed', 'false');
  });

  test('a selected callout shows text and fill properties', async ({ page }) => {
    await placeCallout(page);
    await selectAnnotation(page, 'callout');
    const props = annotationProps(page);
    await expect(props.getByLabel('Edit text')).toBeVisible();
    await expect(props.getByLabel('Callout fill')).toBeVisible();
    await expect(props.getByLabel('Font size')).toBeVisible();
  });

  test('the tip handle appears while the callout is selected', async ({ page }) => {
    await placeCallout(page);
    await selectAnnotation(page, 'callout');
    await expect(page.locator('circle[aria-label="Drag end handle"]')).toBeVisible();
    await expect(page.locator('circle[aria-label="Drag start handle"]')).toHaveCount(0);
  });

  test('dragging a callout body moves the whole callout', async ({ page }) => {
    await placeCallout(page);
    const text = overlay(page).locator('text');
    const x = Number(await text.getAttribute('x'));
    const hit = await annotationCanvas(page).locator('g[data-annotation-id]').first().boundingBox();
    if (!hit) throw new Error('callout hit target missing');
    const from = { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 - 10 };
    await drag(page, from, { x: from.x + 80, y: from.y - 30 });
    await expect.poll(async () => Number(await text.getAttribute('x'))).toBeGreaterThan(x);
  });

  test('editing callout text updates the rendered text', async ({ page }) => {
    await placeCallout(page, 'Before');
    await selectAnnotation(page, 'callout');
    await annotationProps(page).getByLabel('Edit text').click();
    const input = page.getByLabel('Annotation text');
    await input.fill('After');
    await input.press('Enter');
    await expect(overlay(page).locator('text')).toHaveText('After');
  });

  test('callout fill change updates the bubble fill', async ({ page }) => {
    await placeCallout(page);
    await selectAnnotation(page, 'callout');
    await pickColor(page, 'Callout fill', 'Blue');
    await expect(overlay(page).locator('path')).toHaveAttribute('fill', '#2563eb');
  });

  test('dragging the tip handle repositions the tip', async ({ page }) => {
    await placeCallout(page);
    await selectAnnotation(page, 'callout');
    const path = overlay(page).locator('path');
    const before = await path.getAttribute('d');
    const handle = await page.locator('circle[aria-label="Drag end handle"]').boundingBox();
    if (!handle) throw new Error('tip handle missing');
    const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await drag(page, from, { x: from.x + 90, y: from.y + 20 });
    await expect.poll(() => path.getAttribute('d')).not.toBe(before);
  });
});

// ─── Rectangle Tool ───

test.describe('Rectangle Tool', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('drag creates a rectangle', async ({ page }) => {
    await drawRectangle(page);
    await expect(toolbarButton(page, 'Add rectangle')).toHaveAttribute('aria-pressed', 'false');
    await expect(overlay(page).locator('rect')).toHaveAttribute('stroke', '#ef4444');
  });

  test('rectangle shows stroke width but no arrow direction', async ({ page }) => {
    await drawRectangle(page);
    await expect(annotationProps(page).getByLabel('Stroke width')).toBeVisible();
    await expect(annotationProps(page).getByLabel('Arrow direction')).toHaveCount(0);
  });

  test('rectangle colour change updates the stroke', async ({ page }) => {
    await drawRectangle(page);
    await pickColor(page, 'Annotation color', 'Green');
    await expect(overlay(page).locator('rect')).toHaveAttribute('stroke', '#16a34a');
  });
});

// ─── Watermark Tool ───

test.describe('Watermark Tool', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('clicking the watermark button adds a watermark immediately', async ({ page }) => {
    await addWatermark(page);
    await expect(overlay(page).locator('text')).toHaveCount(1);
  });

  test('the watermark is auto-selected and shows its properties', async ({ page }) => {
    await addWatermark(page);
    const props = watermarkProps(page);
    await expect(props.getByLabel('Watermark text')).toBeVisible();
    await expect(props.getByLabel('Watermark opacity')).toBeVisible();
    await expect(props.getByLabel('Watermark position')).toBeVisible();
    await expect(props.getByLabel('Delete watermark')).toBeVisible();
  });

  test('changing the watermark text updates the rendered text', async ({ page }) => {
    await addWatermark(page);
    await watermarkProps(page).getByLabel('Watermark text').fill('INTERNAL');
    await expect(overlay(page).locator('text')).toHaveText('INTERNAL');
  });

  test('a diagonal watermark is rotated', async ({ page }) => {
    await addWatermark(page);
    await expect(overlay(page).locator('text')).toHaveAttribute('transform', /rotate\(-45/);
  });

  test('bottom-right position removes the rotation', async ({ page }) => {
    await addWatermark(page);
    await watermarkProps(page).getByLabel('Watermark position').selectOption('bottom-right');
    await expect(overlay(page).locator('text')).not.toHaveAttribute('transform', /rotate/);
  });

  test('the opacity slider changes the rendered opacity', async ({ page }) => {
    await addWatermark(page);
    await watermarkProps(page).getByLabel('Watermark opacity').fill('40');
    await expect(overlay(page).locator('text')).toHaveAttribute('opacity', '0.4');
  });

  test('Delete watermark removes it and Add watermark brings it back', async ({ page }) => {
    await addWatermark(page);
    await watermarkProps(page).getByLabel('Delete watermark').click();
    await expect(overlay(page).locator('text')).toHaveCount(0);
    await expect(watermarkProps(page)).toHaveCount(0);
    await addWatermark(page);
    await expect(overlay(page).locator('text')).toHaveCount(1);
  });
});

// ─── SVG Overlay Layer ───

test.describe('SVG Overlay Layer', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('the rendered overlay uses the 600-unit reference viewBox', async ({ page }) => {
    const viewBox = await overlay(page).getAttribute('viewBox');
    expect(viewBox).toMatch(/^0 0 600 [\d.]+$/);
  });

  test('the interaction canvas has the same viewBox as the rendered overlay', async ({ page }) => {
    expect(await annotationCanvas(page).getAttribute('viewBox')).toBe(await overlay(page).getAttribute('viewBox'));
  });

  test('the canvas is a crosshair only while a drawing tool is armed', async ({ page }) => {
    await expect(annotationCanvas(page)).not.toHaveCSS('cursor', 'crosshair');
    await clickTool(page, 'Add rectangle');
    await expect(annotationCanvas(page)).toHaveCSS('cursor', 'crosshair');
  });
});

// ─── Selection & Delete ───

test.describe('Selection & Delete', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('Escape deactivates an armed tool without closing the dialog', async ({ page }) => {
    await clickTool(page, 'Add arrow');
    await page.keyboard.press('Escape');
    await expect(toolbarButton(page, 'Add arrow')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.export-modal-backdrop')).toBeVisible();
  });

  test('Escape deselects an annotation without closing the dialog', async ({ page }) => {
    await drawArrow(page);
    await expect(annotationProps(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(annotationProps(page)).toHaveCount(0);
    await expect(page.locator('.export-modal-backdrop')).toBeVisible();
  });

  test('Delete key removes the selected arrow', async ({ page }) => {
    await drawArrow(page);
    await page.keyboard.press('Delete');
    await expect(overlay(page).locator('line')).toHaveCount(0);
  });

  test('Delete key removes the selected note', async ({ page }) => {
    await placeNote(page);
    await selectAnnotation(page, 'note');
    await page.keyboard.press('Delete');
    await expect(overlay(page).locator('text')).toHaveCount(0);
  });

  test('Delete key removes the selected callout', async ({ page }) => {
    await placeCallout(page);
    await selectAnnotation(page, 'callout');
    await page.keyboard.press('Delete');
    await expect(overlay(page).locator('path')).toHaveCount(0);
  });

  test('Delete key removes the watermark', async ({ page }) => {
    await addWatermark(page);
    await page.keyboard.press('Delete');
    await expect(overlay(page).locator('text')).toHaveCount(0);
  });

  test('the Delete annotation button removes the selected arrow', async ({ page }) => {
    await drawArrow(page);
    await annotationProps(page).getByLabel('Delete annotation').click();
    await expect(overlay(page).locator('line')).toHaveCount(0);
    await expect(annotationProps(page)).toHaveCount(0);
  });

  test('drawing an arrow again after deleting one works', async ({ page }) => {
    await drawArrow(page);
    await annotationProps(page).getByLabel('Delete annotation').click();
    await expect(overlay(page).locator('line')).toHaveCount(0);
    await drawArrow(page);
  });

  test('clicking empty stage space deselects the annotation', async ({ page }) => {
    await drawArrow(page);
    await expect(annotationProps(page)).toBeVisible();
    const stage = await page.locator('.workspace-stage').boundingBox();
    if (!stage) throw new Error('stage missing');
    await page.mouse.click(stage.x + 15, stage.y + stage.height - 15);
    await expect(annotationProps(page)).toHaveCount(0);
  });
});

// ─── Multi-Annotation Interactions ───

test.describe('Multi-Annotation Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('all annotation types can coexist', async ({ page }) => {
    await drawArrow(page);
    await drawRectangle(page);
    await placeNote(page, 'N', 0.8, 0.1);
    await placeCallout(page, 'C', 0.4, 0.8);
    await addWatermark(page);
    const svg = overlay(page);
    await expect(svg.locator('line')).toHaveCount(1);
    await expect(svg.locator('rect')).toHaveCount(1);
    await expect(svg.locator('text')).toHaveCount(3); // note + callout + watermark
  });

  test('selecting a different annotation switches the properties bar', async ({ page }) => {
    await drawArrow(page);
    await placeNote(page, 'N', 0.8, 0.1);
    await selectAnnotation(page, 'arrow');
    await expect(annotationProps(page).getByLabel('Arrow direction')).toBeVisible();
    await selectAnnotation(page, 'note');
    await expect(annotationProps(page).getByLabel('Font size')).toBeVisible();
    await expect(annotationProps(page).getByLabel('Arrow direction')).toHaveCount(0);
  });
});

// ─── Property Variants ───

test.describe('Property Variants', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
    await drawArrow(page);
  });

  test('arrow direction "←→" draws two arrowheads', async ({ page }) => {
    await annotationProps(page).getByLabel('Arrow direction').selectOption('←→');
    await expect(overlay(page).locator('path')).toHaveCount(2);
  });

  test('arrow direction "←" draws a single arrowhead, at the start', async ({ page }) => {
    const line = overlay(page).locator('line');
    const x1 = Number(await line.getAttribute('x1'));
    await annotationProps(page).getByLabel('Arrow direction').selectOption('←');
    const heads = overlay(page).locator('path');
    await expect(heads).toHaveCount(1);
    // The head is drawn at (x1, y1): its tip coordinates start near x1.
    expect(Number((await heads.getAttribute('d'))!.match(/M\s*(-?[\d.]+)/)![1])).toBeLessThan(x1 + 40);
  });

  test('arrow direction offers exactly three options', async ({ page }) => {
    await expect(annotationProps(page).getByLabel('Arrow direction').locator('option')).toHaveText(['→', '←', '←→']);
  });

  test('stroke width changes the rendered stroke-width', async ({ page }) => {
    const line = overlay(page).locator('line');
    const before = Number(await line.getAttribute('stroke-width'));
    const width = annotationProps(page).getByLabel('Stroke width');
    await width.fill('8');
    await width.press('Enter');
    await width.blur();
    await expect.poll(async () => Number(await line.getAttribute('stroke-width'))).toBeGreaterThan(before);
  });

  test('a malformed custom colour is rejected', async ({ page }) => {
    await annotationProps(page).getByRole('button', { name: 'Annotation color' }).click();
    await page.getByLabel('Custom annotation color').fill('red');
    await expect(page.getByText('Use #RRGGBB')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  });

  test('a valid custom hex colour is applied', async ({ page }) => {
    await annotationProps(page).getByRole('button', { name: 'Annotation color' }).click();
    await page.getByLabel('Custom annotation color').fill('#123456');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(overlay(page).locator('line')).toHaveAttribute('stroke', '#123456');
  });
});

// ─── Export Pipeline ───

test.describe('Export Pipeline', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('Download image button is present and enabled', async ({ page }) => {
    await expect(exportButton(page)).toBeVisible();
    await expect(exportButton(page)).toBeEnabled();
  });

  test('export triggers a download with the right filename and real pixels', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await exportButton(page).click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(EXPECTED_EXPORT_FILENAME);
    // Not just "a file arrived" — a file with a diagram in it.
    expectRealDiagram(await downloadedPngSize(download), 'downloaded PNG');
  });

  test('a successful download closes the dialog', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await exportButton(page).click();
    await downloadPromise;
    await expect(page.locator('.export-modal-backdrop')).not.toBeVisible();
  });

  test('Copy image is present and does not crash on click', async ({ page }) => {
    // Clipboard-write may be denied by the test sandbox's permission model
    // (exportDiagramToClipboard catches that as 'clipboard_denied'), and the
    // button is disabled where the Clipboard API is unsupported. The point is
    // that clicking never throws and the dialog stays open — Copy, unlike
    // Download, does not close on success.
    const copy = toolbarButton(page, 'Copy image');
    await expect(copy).toBeVisible();
    if (await copy.isEnabled()) await copy.click();
    await expect(page.locator('.export-modal-backdrop')).toBeVisible();
  });

  test('the toolbar shows an Exporting status during export', async ({ page }) => {
    await exportButton(page).click();
    await expect(page.getByRole('status').filter({ hasText: 'Exporting' })).toBeVisible();
  });

  test('export with every annotation type produces a valid PNG', async ({ page }) => {
    await drawArrow(page);
    await drawRectangle(page);
    await placeNote(page, 'N', 0.8, 0.1);
    await placeCallout(page, 'C', 0.4, 0.8);
    await addWatermark(page);

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await exportButton(page).click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(EXPECTED_EXPORT_FILENAME);
    // "valid PNG" means the bytes decode AND carry real dimensions, not
    // merely that download.path() is truthy.
    expectRealDiagram(await downloadedPngSize(download), 'annotated export');
  });
});

// ─── PlantUML (regression: blank Export PNG) ───
//
// Every other test in this file runs against the default `seq-fullscreen` preset, so
// the whole suite only ever exercised the sequence renderer. PlantUML is the
// one macro type whose diagram is an SVG fetched from the remote PlantUML
// server and inlined with v-html — html-to-image cannot reliably rasterize
// that, and the Export PNG button silently produced a blank, effectively
// zero-pixel image for two months. The fix routes PlantUML to the server's own
// raster (/plantuml/png/<encoded>); these tests are what would have caught it.
//
// NOTE: this describe block reaches plantuml.com, exactly as the macro itself
// does at render time. A sandboxed network makes these fail, not flake quietly.
//
// HONEST LIMITATION — read before trusting these as a regression guard.
// The production defect does NOT reproduce here. Measured 2026-09-09 against
// pre-fix code in this exact harness: the preview and the download both came
// out 1000x188 / 16.9 KB, i.e. a perfectly good DOM capture. html-to-image's
// failure to rasterize PlantUML's inlined remote SVG is specific to the Forge
// macro's sandboxed cross-origin iframe (CSP, font access, rendering
// throttling) and is not reproducible in a plain headless page.
//
// So the dimension assertions below are healthy-path coverage, not a red->green
// proof. The test that IS a real regression guard is
// 'requests the raster from the PlantUML PNG server, not a DOM capture': it
// asserts the mechanism the fix establishes — the raster comes from
// /plantuml/png/, never from html-to-image — which holds in every environment
// and does fail against pre-fix code.
test.describe('PlantUML Export', () => {
  // The plantuml fixture (custom-content-by-id-v1-diagram-plantuml.json) has
  // title "Order Service (PlantUML)", which slugifyFilename turns into this.
  const PLANTUML_EXPORT_FILENAME = 'order-service-plantuml.png';

  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page, 'plantuml-fullscreen');
    await openExportModal(page);
  });

  test('preview shows the rendered PlantUML diagram, not a blank capture', async ({ page }) => {
    expectRealDiagram(await previewImageSize(page), 'PlantUML preview');
  });

  // THE regression guard. Environment-independent: it asserts where the pixels
  // came from, not how many survived. Pre-fix, the only plantuml.com traffic is
  // the /svg/ render fetch and the export rasterizes the DOM; post-fix, opening
  // the modal and exporting both pull /plantuml/png/<encoded>.
  test('requests the raster from the PlantUML PNG server, not a DOM capture', async ({ page }) => {
    const pngRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/plantuml/png/')) pngRequests.push(req.url());
    });

    // The modal's own open-time capture already happened in beforeEach, before
    // this listener existed — drive a fresh one through the Refresh button.
    await toolbarButton(page, 'Refresh preview').click();
    await expect.poll(() => pngRequests.length, { timeout: 15000 }).toBeGreaterThan(0);

    const before = pngRequests.length;
    const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
    await exportButton(page).click();
    await downloadPromise;

    // Export asked the server too, rather than falling back to html-to-image.
    await expect.poll(() => pngRequests.length, { timeout: 10000 }).toBeGreaterThan(before);
  });

  test('export downloads a PlantUML PNG with real pixel dimensions', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
    await exportButton(page).click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(PLANTUML_EXPORT_FILENAME);
    expectRealDiagram(await downloadedPngSize(download), 'PlantUML export');
  });

  test('export with annotations still produces a real PlantUML PNG', async ({ page }) => {
    await drawArrow(page);
    await placeNote(page);
    await addWatermark(page);

    const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
    await exportButton(page).click();

    const download = await downloadPromise;
    expectRealDiagram(await downloadedPngSize(download), 'annotated PlantUML export');
  });
});
