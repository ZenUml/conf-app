import { test, expect, type Page } from '@playwright/test';

const TEST_URL = '/test-viewer.html';

async function waitForViewerReady(page: Page) {
  await page.goto(TEST_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.screen-capture-content', { timeout: 15000 });
  await page.waitForTimeout(1000);
}

async function openExportModal(page: Page) {
  const exportBtn = page.locator('button', { hasText: 'Export' });
  await expect(exportBtn).toBeVisible({ timeout: 5000 });
  await exportBtn.click();
  await page.waitForSelector('.export-modal-backdrop', { timeout: 5000 });
}

test.describe('Stage 11: Component Split', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
  });

  test('export modal opens with preview and sidebar', async ({ page }) => {
    await openExportModal(page);

    await expect(page.locator('.export-preview-pane')).toBeVisible();
    await expect(page.locator('.export-sidebar')).toBeVisible();
    await expect(page.locator('.export-divider')).toBeVisible();
  });

  test('sidebar has all 5 settings sections', async ({ page }) => {
    await openExportModal(page);

    const sections = page.locator('.section-heading');
    await expect(sections).toHaveCount(6);

    const headings = await sections.allTextContents();
    expect(headings.map(h => h.trim().toLowerCase())).toEqual(
      expect.arrayContaining(['theme', 'background', 'note', 'callout', 'arrow', 'watermark'])
    );
  });

  test('preview shows captured diagram image', async ({ page }) => {
    await openExportModal(page);
    await page.waitForSelector('.preview-real-diagram', { timeout: 10000 });
    const img = page.locator('.preview-real-diagram');
    await expect(img).toBeVisible();
    const src = await img.getAttribute('src');
    expect(src).toBeTruthy();
    expect(src).toContain('data:image/png');
  });

  test('close button dismisses modal', async ({ page }) => {
    await openExportModal(page);
    await page.locator('.sidebar-close').click();
    await expect(page.locator('.export-modal-backdrop')).not.toBeVisible();
  });

  test('backdrop click dismisses modal', async ({ page }) => {
    await openExportModal(page);
    await page.locator('.export-modal-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.export-modal-backdrop')).not.toBeVisible();
  });

  test('cancel button dismisses modal', async ({ page }) => {
    await openExportModal(page);
    await page.locator('.btn-cancel').click();
    await expect(page.locator('.export-modal-backdrop')).not.toBeVisible();
  });
});

test.describe('Stage 11: Theme Selection', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('theme cards are clickable and show active state', async ({ page }) => {
    const themeCards = page.locator('.theme-card');
    await expect(themeCards).toHaveCount(4);

    for (let i = 0; i < 4; i++) {
      await themeCards.nth(i).click();
      await expect(themeCards.nth(i)).toHaveClass(/active/);
    }
  });

  test('dark theme changes preview background when background is default', async ({ page }) => {
    const autoCard = page.locator('.theme-card', { hasText: 'Auto' });
    await autoCard.click();

    const darkCard = page.locator('.theme-card', { hasText: 'Dark' });
    await darkCard.click();

    await page.waitForTimeout(300);
    const wrap = page.locator('.preview-canvas-wrap');
    const bg = await wrap.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(255, 255, 255)');

    await page.locator('.swatch-transparent').click();
    const bgImg = await wrap.evaluate(el => getComputedStyle(el).backgroundImage);
    expect(bgImg).toContain('linear-gradient');
  });
});

test.describe('Stage 11: Background Selection', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('background swatches are clickable', async ({ page }) => {
    const swatches = page.locator('.bg-swatch');
    const count = await swatches.count();
    expect(count).toBeGreaterThanOrEqual(4);

    for (let i = 0; i < count; i++) {
      await swatches.nth(i).click();
      await expect(swatches.nth(i)).toHaveClass(/active/);
    }
  });

  test('transparent background shows checkerboard', async ({ page }) => {
    await page.locator('.swatch-transparent').click();
    const wrap = page.locator('.preview-canvas-wrap');
    const bgImage = await wrap.evaluate(el => getComputedStyle(el).backgroundImage);
    expect(bgImage).toContain('linear-gradient');
  });
});

test.describe('Stage 11: Note Settings', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('note text input works', async ({ page }) => {
    const input = page.locator('.settings-section').filter({ hasText: 'Note' }).locator('.field-input');
    await input.fill('Test annotation');
    await expect(input).toHaveValue('Test annotation');
  });

  test('click-to-place note mode toggles', async ({ page }) => {
    const placeBtn = page.locator('.btn-place-note');
    await placeBtn.click();
    await expect(placeBtn).toHaveClass(/active/);

    await expect(page.locator('.arrow-click-hint', { hasText: 'Click to place note' })).toBeVisible();
  });
});

test.describe('Stage 11: Arrow Settings', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('arrow toggle enables arrow settings', async ({ page }) => {
    const arrowSection = page.locator('.settings-section').filter({ hasText: 'Arrow' });
    const toggle = arrowSection.locator('.toggle');
    await toggle.click();
    await expect(toggle).toHaveClass(/on/);

    await expect(arrowSection.locator('.field-select')).toBeVisible();
    await expect(arrowSection.locator('.field-color')).toBeVisible();
  });

  test('arrow drag-to-draw shows hint', async ({ page }) => {
    const arrowSection = page.locator('.settings-section').filter({ hasText: 'Arrow' });
    await arrowSection.locator('.toggle').click();

    await expect(page.locator('.arrow-click-hint', { hasText: 'Drag to draw arrow' })).toBeVisible();
  });
});

test.describe('Stage 11: Watermark Settings', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('watermark toggle enables watermark settings', async ({ page }) => {
    const wmSection = page.locator('.settings-section').filter({ hasText: 'Watermark' });
    const toggle = wmSection.locator('.toggle');
    await toggle.click();
    await expect(toggle).toHaveClass(/on/);

    await expect(wmSection.locator('.field-input')).toBeVisible();
  });
});

test.describe('Stage 12: SVG Overlay Layer', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('note overlay renders as SVG text', async ({ page }) => {
    const noteInput = page.locator('.settings-section').filter({ hasText: 'Note' }).locator('.field-input');
    await noteInput.fill('SVG Note Test');

    const svgText = page.locator('.overlay-layer .note-overlay text');
    await expect(svgText).toBeVisible({ timeout: 3000 });
    await expect(svgText).toHaveText('SVG Note Test');
  });

  test('watermark overlay renders as SVG text', async ({ page }) => {
    const wmSection = page.locator('.settings-section').filter({ hasText: 'Watermark' });
    await wmSection.locator('.toggle').click();

    const svgText = page.locator('.overlay-layer .watermark-overlay text');
    await expect(svgText).toBeVisible({ timeout: 3000 });
    await expect(svgText).toHaveText('Confidential');
  });

  test('arrow overlay renders as SVG line when drawn via drag', async ({ page }) => {
    const arrowSection = page.locator('.settings-section').filter({ hasText: 'Arrow' });
    await arrowSection.locator('.toggle').click();

    const canvas = page.locator('.preview-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + box!.width * 0.2;
    const startY = box!.y + box!.height * 0.3;
    const endX = box!.x + box!.width * 0.8;
    const endY = box!.y + box!.height * 0.7;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();

    const arrowLine = page.locator('.overlay-layer .arrow-overlay line').first();
    await expect(arrowLine).toBeVisible({ timeout: 3000 });
  });

  test('SVG overlay layer has proper viewBox', async ({ page }) => {
    const noteInput = page.locator('.settings-section').filter({ hasText: 'Note' }).locator('.field-input');
    await noteInput.fill('ViewBox Test');

    const svg = page.locator('.overlay-layer');
    await expect(svg).toBeVisible({ timeout: 3000 });
    const viewBox = await svg.getAttribute('viewBox');
    expect(viewBox).toMatch(/^0 0 \d+ \d+$/);
  });

  test('note with drop shadow filter is applied', async ({ page }) => {
    const noteInput = page.locator('.settings-section').filter({ hasText: 'Note' }).locator('.field-input');
    await noteInput.fill('Shadow Test');

    const svgText = page.locator('.overlay-layer .note-overlay text');
    await expect(svgText).toBeVisible({ timeout: 3000 });
    const filter = await svgText.getAttribute('filter');
    expect(filter).toContain('drop-shadow');
  });

  test('all overlays are SVG elements (zero HTML div overlays)', async ({ page }) => {
    const noteInput = page.locator('.settings-section').filter({ hasText: 'Note' }).locator('.field-input');
    await noteInput.fill('All SVG Test');

    const wmSection = page.locator('.settings-section').filter({ hasText: 'Watermark' });
    await wmSection.locator('.toggle').click();

    const noteDiv = page.locator('.preview-note');
    await expect(noteDiv).not.toBeVisible();

    const watermarkDiv = page.locator('.preview-watermark');
    await expect(watermarkDiv).not.toBeVisible();

    await expect(page.locator('.overlay-layer .note-overlay text')).toBeVisible();
    await expect(page.locator('.overlay-layer .watermark-overlay text')).toBeVisible();
  });
});

test.describe('Stage 11: Export Action', () => {
  test('download PNG button is present and clickable', async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);

    const downloadBtn = page.locator('.btn-export');
    await expect(downloadBtn).toBeVisible();
    await expect(downloadBtn).toHaveText(/Download PNG/);
    await expect(downloadBtn).toBeEnabled();
  });
});

test.describe('Stage 15: Draggable Note with In-Place Editing', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('note is draggable after placement via click-to-place', async ({ page }) => {
    const noteInput = page.locator('.settings-section').filter({ hasText: 'Note' }).locator('.field-input');
    await noteInput.fill('Drag me');

    const placeBtn = page.locator('.btn-place-note');
    await placeBtn.click();

    const canvas = page.locator('.preview-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box!.width * 0.5, y: box!.height * 0.5 } });

    const noteText = page.locator('.overlay-layer .note-overlay text');
    await expect(noteText).toBeVisible();
    await expect(noteText).toHaveClass(/draggable-note/);
  });

  test('note text renders as SVG text element', async ({ page }) => {
    const noteInput = page.locator('.settings-section').filter({ hasText: 'Note' }).locator('.field-input');
    await noteInput.fill('SVG text');

    const svgText = page.locator('.overlay-layer .note-overlay text');
    await expect(svgText).toBeVisible({ timeout: 3000 });
    await expect(svgText).toHaveText('SVG text');
  });

  test('double-click note opens edit input (when placed)', async ({ page }) => {
    const noteInput = page.locator('.settings-section').filter({ hasText: 'Note' }).locator('.field-input');
    await noteInput.fill('Edit me');

    const placeBtn = page.locator('.btn-place-note');
    await placeBtn.click();

    const canvas = page.locator('.preview-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box!.width * 0.5, y: box!.height * 0.5 } });

    const noteText = page.locator('.overlay-layer .note-overlay text');
    await expect(noteText).toBeVisible();

    await noteText.dispatchEvent('dblclick');

    const editInput = page.locator('.note-edit-input');
    await expect(editInput).toBeVisible({ timeout: 3000 });
    await expect(editInput).toHaveValue('Edit me');
  });

  test('editing note text updates the note', async ({ page }) => {
    const noteInput = page.locator('.settings-section').filter({ hasText: 'Note' }).locator('.field-input');
    await noteInput.fill('Original');

    const placeBtn = page.locator('.btn-place-note');
    await placeBtn.click();

    const canvas = page.locator('.preview-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box!.width * 0.5, y: box!.height * 0.5 } });

    const noteText = page.locator('.overlay-layer .note-overlay text');
    await expect(noteText).toBeVisible();
    await noteText.dispatchEvent('dblclick');

    const editInput = page.locator('.note-edit-input');
    await expect(editInput).toBeVisible({ timeout: 3000 });
    await editInput.fill('Updated text');
    await editInput.press('Enter');

    await expect(page.locator('.overlay-layer .note-overlay text')).toHaveText('Updated text');
  });
});

test.describe('Stage 14: Drag-to-Draw Arrow', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
    const arrowSection = page.locator('.settings-section').filter({ hasText: 'Arrow' });
    await arrowSection.locator('.toggle').click();
  });

  test('drag creates arrow in real-time', async ({ page }) => {
    const canvas = page.locator('.preview-canvas');
    const box = await canvas.boundingBox();

    const startX = box!.x + box!.width * 0.2;
    const startY = box!.y + box!.height * 0.3;
    const endX = box!.x + box!.width * 0.8;
    const endY = box!.y + box!.height * 0.7;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 5 });

    const arrowLine = page.locator('.overlay-layer .arrow-overlay line').first();
    await expect(arrowLine).toBeVisible({ timeout: 3000 });

    await page.mouse.up();

    await expect(page.locator('.overlay-layer .arrow-overlay line').first()).toBeVisible();
  });

  test('arrow shows hint to drag', async ({ page }) => {
    await expect(page.locator('.arrow-click-hint', { hasText: 'Drag to draw arrow' })).toBeVisible();
  });

  test('arrow hint updates during creation', async ({ page }) => {
    const canvas = page.locator('.preview-canvas');
    const box = await canvas.boundingBox();

    await page.mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5, { steps: 3 });

    await expect(page.locator('.arrow-click-hint', { hasText: 'Release to finish' })).toBeVisible();

    await page.mouse.up();
  });

  test('grip handles appear when arrow is selected', async ({ page }) => {
    const canvas = page.locator('.preview-canvas');
    const box = await canvas.boundingBox();

    await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.8, box!.y + box!.height * 0.7, { steps: 5 });
    await page.mouse.up();

    const arrowGroup = page.locator('.overlay-layer .arrow-overlay');
    await arrowGroup.click();
    await page.waitForTimeout(200);

    const grips = page.locator('.overlay-layer .arrow-overlay .grip-handle');
    await expect(grips).toHaveCount(2);
  });

  test('very short drag does not create arrow', async ({ page }) => {
    const canvas = page.locator('.preview-canvas');
    const box = await canvas.boundingBox();

    const x = box!.x + box!.width * 0.5;
    const y = box!.y + box!.height * 0.5;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 1, y + 1);
    await page.mouse.up();

    const arrowLine = page.locator('.overlay-layer .arrow-overlay line');
    await expect(arrowLine).not.toBeVisible();
  });
});

test.describe('Stage 13: SVG-to-Canvas Export Pipeline', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('export triggers download with SVG rasterization', async ({ page }) => {
    const noteInput = page.locator('.settings-section').filter({ hasText: 'Note' }).locator('.field-input');
    await noteInput.fill('Export Test Note');

    const wmSection = page.locator('.settings-section').filter({ hasText: 'Watermark' });
    await wmSection.locator('.toggle').click();

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.locator('.btn-export').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('zenuml-diagram-export.png');
  });

  test('export button shows loading state during export', async ({ page }) => {
    const exportBtn = page.locator('.btn-export');
    await exportBtn.click();

    await expect(exportBtn).toContainText(/Exporting/);
  });

  test('export with all overlays produces valid PNG', async ({ page }) => {
    const noteInput = page.locator('.settings-section').filter({ hasText: 'Note' }).locator('.field-input');
    await noteInput.fill('Full overlay test');

    const arrowSection = page.locator('.settings-section').filter({ hasText: 'Arrow' });
    await arrowSection.locator('.toggle').click();
    const canvas = page.locator('.preview-canvas');
    const box = await canvas.boundingBox();
    await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.8, box!.y + box!.height * 0.7, { steps: 5 });
    await page.mouse.up();

    const wmSection = page.locator('.settings-section').filter({ hasText: 'Watermark' });
    await wmSection.locator('.toggle').click();

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.locator('.btn-export').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('zenuml-diagram-export.png');
    const path = await download.path();
    expect(path).toBeTruthy();
  });
});

test.describe('Stage 16: Callout Marker', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('callout section is present in sidebar', async ({ page }) => {
    const calloutSection = page.locator('.settings-section').filter({ hasText: 'Callout' });
    await expect(calloutSection).toBeVisible();
  });

  test('callout toggle enables callout settings', async ({ page }) => {
    const calloutSection = page.locator('.settings-section').filter({ hasText: 'Callout' });
    const toggle = calloutSection.locator('.toggle');
    await toggle.click();
    await expect(toggle).toHaveClass(/on/);
    await expect(calloutSection.locator('.field-input')).toBeVisible();
  });

  test('callout can be placed by clicking on preview', async ({ page }) => {
    const calloutSection = page.locator('.settings-section').filter({ hasText: 'Callout' });
    await calloutSection.locator('.toggle').click();

    const textInput = calloutSection.locator('.field-input');
    await textInput.fill('Important!');

    const placeBtn = calloutSection.locator('.btn-place-note');
    await placeBtn.click();

    await expect(page.locator('.arrow-click-hint', { hasText: 'Click to place callout' })).toBeVisible();

    const canvas = page.locator('.preview-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box!.width * 0.5, y: box!.height * 0.4 } });

    const calloutPath = page.locator('.overlay-layer .callout-overlay path');
    await expect(calloutPath).toBeVisible({ timeout: 3000 });

    const calloutText = page.locator('.overlay-layer .callout-overlay text');
    await expect(calloutText).toHaveText('Important!');
  });

  test('callout renders with speech bubble shape', async ({ page }) => {
    const calloutSection = page.locator('.settings-section').filter({ hasText: 'Callout' });
    await calloutSection.locator('.toggle').click();
    await calloutSection.locator('.field-input').fill('Bubble');
    await calloutSection.locator('.btn-place-note').click();

    const canvas = page.locator('.preview-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box!.width * 0.5, y: box!.height * 0.4 } });

    const calloutPath = page.locator('.overlay-layer .callout-overlay path');
    await expect(calloutPath).toBeVisible({ timeout: 3000 });
    const d = await calloutPath.getAttribute('d');
    expect(d).toBeTruthy();
    expect(d).toContain('Q');
  });

  test('callout tip grip appears when selected', async ({ page }) => {
    const calloutSection = page.locator('.settings-section').filter({ hasText: 'Callout' });
    await calloutSection.locator('.toggle').click();
    await calloutSection.locator('.field-input').fill('Select me');
    await calloutSection.locator('.btn-place-note').click();

    const canvas = page.locator('.preview-canvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box!.width * 0.5, y: box!.height * 0.4 } });

    const calloutGroup = page.locator('.overlay-layer .callout-overlay');
    await expect(calloutGroup).toBeVisible({ timeout: 3000 });
    await calloutGroup.dispatchEvent('click');
    await page.waitForTimeout(200);

    const gripHandle = page.locator('.overlay-layer .callout-overlay .grip-handle');
    await expect(gripHandle).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Stage 17: Selection Model & Delete', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('clicking note selects it', async ({ page }) => {
    const noteInput = page.locator('.settings-section').filter({ hasText: 'Note' }).locator('.field-input');
    await noteInput.fill('Select this');

    const noteText = page.locator('.overlay-layer .note-overlay text');
    await expect(noteText).toBeVisible({ timeout: 3000 });

    await noteText.click();
    await page.waitForTimeout(200);
  });

  test('clicking arrow selects it and shows grips', async ({ page }) => {
    const arrowSection = page.locator('.settings-section').filter({ hasText: 'Arrow' });
    await arrowSection.locator('.toggle').click();

    const canvas = page.locator('.preview-canvas');
    const box = await canvas.boundingBox();
    await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.8, box!.y + box!.height * 0.7, { steps: 5 });
    await page.mouse.up();

    const arrowGroup = page.locator('.overlay-layer .arrow-overlay');
    await arrowGroup.click();
    await page.waitForTimeout(200);

    const grips = page.locator('.overlay-layer .arrow-overlay .grip-handle');
    await expect(grips).toHaveCount(2);
  });

  test('Escape key deselects annotation', async ({ page }) => {
    const noteInput = page.locator('.settings-section').filter({ hasText: 'Note' }).locator('.field-input');
    await noteInput.fill('Press Escape');

    const noteText = page.locator('.overlay-layer .note-overlay text');
    await expect(noteText).toBeVisible({ timeout: 3000 });
    await noteText.click();

    const overlay = page.locator('.overlay-layer');
    await overlay.press('Escape');
    await page.waitForTimeout(200);
  });

  test('Delete key removes selected arrow', async ({ page }) => {
    const arrowSection = page.locator('.settings-section').filter({ hasText: 'Arrow' });
    await arrowSection.locator('.toggle').click();

    const canvas = page.locator('.preview-canvas');
    const box = await canvas.boundingBox();
    await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.8, box!.y + box!.height * 0.7, { steps: 5 });
    await page.mouse.up();

    const arrowLine = page.locator('.overlay-layer .arrow-overlay line').first();
    await expect(arrowLine).toBeVisible({ timeout: 3000 });

    const arrowGroup = page.locator('.overlay-layer .arrow-overlay');
    await arrowGroup.click();

    const overlay = page.locator('.overlay-layer');
    await overlay.focus();
    await overlay.press('Delete');

    await expect(arrowLine).not.toBeVisible({ timeout: 3000 });
  });

  test('Delete key removes selected note text', async ({ page }) => {
    const noteInput = page.locator('.settings-section').filter({ hasText: 'Note' }).locator('.field-input');
    await noteInput.fill('Delete me');

    const noteText = page.locator('.overlay-layer .note-overlay text');
    await expect(noteText).toBeVisible({ timeout: 3000 });
    await noteText.click();

    const overlay = page.locator('.overlay-layer');
    await overlay.focus();
    await overlay.press('Delete');

    await expect(noteText).not.toBeVisible({ timeout: 3000 });
    await expect(noteInput).toHaveValue('');
  });

  test('clicking empty space deselects', async ({ page }) => {
    const arrowSection = page.locator('.settings-section').filter({ hasText: 'Arrow' });
    await arrowSection.locator('.toggle').click();

    const canvas = page.locator('.preview-canvas');
    const box = await canvas.boundingBox();
    await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.8, box!.y + box!.height * 0.7, { steps: 5 });
    await page.mouse.up();

    const arrowGroup = page.locator('.overlay-layer .arrow-overlay');
    await arrowGroup.click();

    const grips = page.locator('.overlay-layer .arrow-overlay .grip-handle');
    await expect(grips).toHaveCount(2);

    await arrowSection.locator('.toggle').click();
    await arrowSection.locator('.toggle').click();
  });
});
