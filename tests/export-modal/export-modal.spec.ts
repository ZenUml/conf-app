import { test, expect, type Page } from '@playwright/test';

const TEST_URL = '/test-viewer.html';

// ─── Shared Helpers ───

async function waitForViewerReady(page: Page) {
  await page.goto(TEST_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.screen-capture-content', { timeout: 15000 });
  await page.waitForTimeout(1000);
}

async function openExportModal(page: Page) {
  const exportBtn = page.locator('button[aria-label="Download PNG"]');
  await expect(exportBtn).toBeVisible({ timeout: 5000 });
  await exportBtn.click();
  await page.waitForSelector('.export-modal-backdrop', { timeout: 5000 });
  await page.waitForSelector('.preview-real-diagram', { timeout: 10000 });
}

function getCanvasBox(page: Page) {
  return page.locator('.preview-canvas').boundingBox();
}

async function clickTool(page: Page, titleMatch: string) {
  const btn = page.locator(`.tool-btn[title*="${titleMatch}"]`);
  await expect(btn).toBeVisible();
  await btn.click();
}

async function drawArrow(page: Page) {
  await clickTool(page, 'Arrow');
  const box = await getCanvasBox(page);
  if (!box) throw new Error('preview-canvas not found');

  const startX = box.x + box.width * 0.15;
  const startY = box.y + box.height * 0.2;
  const endX = box.x + box.width * 0.6;
  const endY = box.y + box.height * 0.5;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function placeNote(page: Page) {
  await clickTool(page, 'Note');
  const box = await getCanvasBox(page);
  if (!box) throw new Error('preview-canvas not found');
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.15);
  await page.waitForTimeout(200);
}

async function placeCallout(page: Page) {
  await clickTool(page, 'Callout');
  const box = await getCanvasBox(page);
  if (!box) throw new Error('preview-canvas not found');
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.7);
  await page.waitForTimeout(200);
}

async function selectAnnotation(page: Page, className: string) {
  const el = page.locator(`.overlay-layer .${className}`);
  await el.first().dispatchEvent('click');
  await page.waitForTimeout(200);
}

async function focusOverlay(page: Page) {
  const overlay = page.locator('.overlay-layer');
  if (await overlay.count() > 0) {
    await overlay.first().focus();
  }
}

// ─── Modal Structure ───

test.describe('Modal Structure', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
  });

  test('export modal opens with preview and sidebar', async ({ page }) => {
    await openExportModal(page);
    await expect(page.locator('.export-preview-pane')).toBeVisible();
    await expect(page.locator('.export-sidebar')).toBeVisible();
    await expect(page.locator('.export-divider')).toBeVisible();
  });

  test('annotation toolbar has 4 tool buttons', async ({ page }) => {
    await openExportModal(page);
    const tools = page.locator('.annotation-toolbar .tool-btn');
    await expect(tools).toHaveCount(4);
  });

  test('sidebar shows Background section', async ({ page }) => {
    await openExportModal(page);
    const headings = await page.locator('.section-heading').allTextContents();
    const lower = headings.map(h => h.trim().toLowerCase());
    expect(lower).toContain('background');
  });

  test('sidebar shows hint when no annotation selected', async ({ page }) => {
    await openExportModal(page);
    const hint = page.locator('.annotation-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Use the toolbar');
  });

  test('preview shows captured diagram image', async ({ page }) => {
    await openExportModal(page);
    const img = page.locator('.preview-real-diagram');
    await expect(img).toBeVisible();
    const src = await img.getAttribute('src');
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

// ─── Background ───

test.describe('Background', () => {
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

// ─── Arrow Tool ───

test.describe('Arrow Tool', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('clicking arrow tool activates it with highlight', async ({ page }) => {
    const arrowBtn = page.locator('.tool-btn[title*="Arrow"]');
    await arrowBtn.click();
    await expect(arrowBtn).toHaveClass(/active/);
  });

  test('arrow tool shows drag hint', async ({ page }) => {
    await clickTool(page, 'Arrow');
    await expect(page.locator('.arrow-click-hint', { hasText: 'Drag to draw arrow' })).toBeVisible();
  });

  test('drag creates arrow with line and arrowhead visible', async ({ page }) => {
    await drawArrow(page);

    const arrowLine = page.locator('.overlay-layer .arrow-overlay line').first();
    await expect(arrowLine).toBeVisible({ timeout: 3000 });

    const arrowHead = page.locator('.overlay-layer .arrow-overlay path').first();
    await expect(arrowHead).toBeVisible();
  });

  test('arrow tool deactivates after drawing', async ({ page }) => {
    await drawArrow(page);
    const arrowBtn = page.locator('.tool-btn[title*="Arrow"]');
    await expect(arrowBtn).not.toHaveClass(/active/);
  });

  test('shows "Release to finish" hint during drag', async ({ page }) => {
    await clickTool(page, 'Arrow');
    const box = await getCanvasBox(page);
    if (!box) throw new Error('preview-canvas not found');

    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 3 });

    await expect(page.locator('.arrow-click-hint', { hasText: 'Release to finish' })).toBeVisible();

    await page.mouse.up();
  });

  test('very short drag does not create arrow', async ({ page }) => {
    await clickTool(page, 'Arrow');
    const box = await getCanvasBox(page);
    if (!box) throw new Error('preview-canvas not found');
    const x = box.x + box.width * 0.5;
    const y = box.y + box.height * 0.5;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 1, y + 1);
    await page.mouse.up();

    const arrowLine = page.locator('.overlay-layer .arrow-overlay line');
    await expect(arrowLine).not.toBeVisible();
  });

  test('selecting arrow shows Arrow Properties in sidebar', async ({ page }) => {
    await drawArrow(page);
    await selectAnnotation(page, 'arrow-overlay');

    const propsSection = page.locator('.annotation-props').filter({ hasText: 'Arrow Properties' });
    await expect(propsSection).toBeVisible();
    await expect(propsSection.locator('.field-select')).toBeVisible();
    await expect(propsSection.locator('.field-color')).toBeVisible();
    await expect(propsSection.locator('.field-range')).toBeVisible();
  });

  test('grip handles appear when arrow is selected', async ({ page }) => {
    await drawArrow(page);
    await selectAnnotation(page, 'arrow-overlay');

    const grips = page.locator('.overlay-layer .arrow-overlay .grip-handle');
    await expect(grips).toHaveCount(2);
  });

  test('changing arrow color in sidebar updates SVG', async ({ page }) => {
    await drawArrow(page);
    await selectAnnotation(page, 'arrow-overlay');

    const colorInput = page.locator('.annotation-props .field-color');
    await expect(colorInput).toBeVisible();
    await colorInput.fill('#00ff00');
    await page.waitForTimeout(200);

    const line = page.locator('.overlay-layer .arrow-overlay .arrow-line-body');
    const stroke = await line.getAttribute('stroke');
    expect(stroke).toBe('#00ff00');
  });

  test('arrow grip drag repositions endpoint', async ({ page }) => {
    await drawArrow(page);
    await selectAnnotation(page, 'arrow-overlay');

    const grips = page.locator('.overlay-layer .arrow-overlay .grip-handle');
    await expect(grips).toHaveCount(2);

    const endGrip = grips.nth(1);
    const gripBox = await endGrip.boundingBox();
    if (!gripBox) throw new Error('grip not found');

    const gripCenterX = gripBox.x + gripBox.width / 2;
    const gripCenterY = gripBox.y + gripBox.height / 2;

    const line = page.locator('.overlay-layer .arrow-overlay .arrow-line-body');
    const x2Before = await line.getAttribute('x2');

    await page.mouse.move(gripCenterX, gripCenterY);
    await page.mouse.down();
    await page.mouse.move(gripCenterX - 50, gripCenterY - 30, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const x2After = await line.getAttribute('x2');
    expect(x2After).not.toBe(x2Before);
  });

  test('arrow body drag moves entire arrow', async ({ page }) => {
    await drawArrow(page);
    await selectAnnotation(page, 'arrow-overlay');

    const line = page.locator('.overlay-layer .arrow-overlay .arrow-line-body');
    const x1Before = parseFloat((await line.getAttribute('x1'))!);
    const y1Before = parseFloat((await line.getAttribute('y1'))!);

    const hitArea = page.locator('.overlay-layer .arrow-overlay .arrow-hit-area');
    const hitBox = await hitArea.boundingBox();
    if (!hitBox) throw new Error('arrow hit area not found');

    const midX = hitBox.x + hitBox.width / 2;
    const midY = hitBox.y + hitBox.height / 2;

    await page.mouse.move(midX, midY);
    await page.mouse.down();
    await page.mouse.move(midX + 30, midY + 20, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const x1After = parseFloat((await line.getAttribute('x1'))!);
    const y1After = parseFloat((await line.getAttribute('y1'))!);
    expect(x1After).not.toBeCloseTo(x1Before, 0);
    expect(y1After).not.toBeCloseTo(y1Before, 0);
  });

  test('adding label in sidebar shows label on arrow', async ({ page }) => {
    await drawArrow(page);
    await selectAnnotation(page, 'arrow-overlay');

    const labelInput = page.locator('.annotation-props .field-input[placeholder*="label" i]');
    await expect(labelInput).toBeVisible();
    await labelInput.fill('Important');
    await page.waitForTimeout(200);

    const labelText = page.locator('.overlay-layer .arrow-overlay text');
    await expect(labelText).toBeVisible();
    await expect(labelText).toHaveText('Important');
  });
});

// ─── Note Tool ───

test.describe('Note Tool', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('clicking note tool activates it', async ({ page }) => {
    const noteBtn = page.locator('.tool-btn[title*="Note"]');
    await noteBtn.click();
    await expect(noteBtn).toHaveClass(/active/);
    await expect(page.locator('.arrow-click-hint', { hasText: 'Click to place note' })).toBeVisible();
  });

  test('clicking canvas places note with default text', async ({ page }) => {
    await placeNote(page);
    const noteText = page.locator('.overlay-layer .note-overlay text');
    await expect(noteText).toBeVisible({ timeout: 3000 });
    await expect(noteText).toHaveText('Note');
  });

  test('note tool deactivates after placing', async ({ page }) => {
    await placeNote(page);
    const noteBtn = page.locator('.tool-btn[title*="Note"]');
    await expect(noteBtn).not.toHaveClass(/active/);
  });

  test('note has draggable-note class and grab cursor', async ({ page }) => {
    await placeNote(page);
    const noteText = page.locator('.overlay-layer .note-overlay text');
    await expect(noteText).toBeVisible();
    await expect(noteText).toHaveClass(/draggable-note/);
    const cursor = await noteText.evaluate(el => getComputedStyle(el).cursor);
    expect(cursor).toBe('grab');
  });

  test('selecting note shows Note Properties in sidebar', async ({ page }) => {
    await placeNote(page);
    await selectAnnotation(page, 'note-overlay');

    const propsSection = page.locator('.annotation-props').filter({ hasText: 'Note Properties' });
    await expect(propsSection).toBeVisible();
    await expect(propsSection.locator('.field-input')).toBeVisible();
    await expect(propsSection.locator('.field-range')).toBeVisible();
    await expect(propsSection.locator('.field-color')).toBeVisible();
  });

  test('double-click note opens edit input', async ({ page }) => {
    await placeNote(page);
    const noteText = page.locator('.overlay-layer .note-overlay text');
    await expect(noteText).toBeVisible();
    await noteText.dispatchEvent('dblclick');

    const editInput = page.locator('.note-edit-input');
    await expect(editInput).toBeVisible({ timeout: 3000 });
  });

  test('editing note text via in-place editor updates SVG', async ({ page }) => {
    await placeNote(page);
    const noteText = page.locator('.overlay-layer .note-overlay text');
    await expect(noteText).toBeVisible();
    await noteText.dispatchEvent('dblclick');

    const editInput = page.locator('.note-edit-input');
    await expect(editInput).toBeVisible({ timeout: 3000 });
    await editInput.fill('My Annotation');
    await editInput.press('Enter');

    await expect(page.locator('.overlay-layer .note-overlay text')).toHaveText('My Annotation');
  });

  test('editing note text via sidebar updates SVG', async ({ page }) => {
    await placeNote(page);
    await selectAnnotation(page, 'note-overlay');

    const textInput = page.locator('.annotation-props .field-input').first();
    await expect(textInput).toBeVisible();
    await textInput.fill('Sidebar Text');
    await page.waitForTimeout(200);

    const noteText = page.locator('.overlay-layer .note-overlay text');
    await expect(noteText).toHaveText('Sidebar Text');
  });

  test('note drag moves it to new position', async ({ page }) => {
    await placeNote(page);
    const noteText = page.locator('.overlay-layer .note-overlay text');
    await expect(noteText).toBeVisible();

    const xBefore = parseFloat((await noteText.getAttribute('x'))!);
    const yBefore = parseFloat((await noteText.getAttribute('y'))!);

    const noteBox = await noteText.boundingBox();
    if (!noteBox) throw new Error('note bounding box not found');

    await page.mouse.move(noteBox.x + noteBox.width / 2, noteBox.y + noteBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(noteBox.x + noteBox.width / 2 + 40, noteBox.y + noteBox.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const xAfter = parseFloat((await noteText.getAttribute('x'))!);
    const yAfter = parseFloat((await noteText.getAttribute('y'))!);
    expect(xAfter).not.toBeCloseTo(xBefore, 0);
    expect(yAfter).not.toBeCloseTo(yBefore, 0);
  });
});

// ─── Callout Tool ───

test.describe('Callout Tool', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('clicking callout tool activates it', async ({ page }) => {
    const calloutBtn = page.locator('.tool-btn[title*="Callout"]');
    await calloutBtn.click();
    await expect(calloutBtn).toHaveClass(/active/);
    await expect(page.locator('.arrow-click-hint', { hasText: 'Click to place callout' })).toBeVisible();
  });

  test('clicking canvas places callout with speech bubble and default text', async ({ page }) => {
    await placeCallout(page);

    const calloutPath = page.locator('.overlay-layer .callout-overlay path');
    await expect(calloutPath).toBeVisible({ timeout: 3000 });
    const d = await calloutPath.getAttribute('d');
    expect(d).toBeTruthy();
    expect(d).toContain('Q');

    const calloutText = page.locator('.overlay-layer .callout-overlay text');
    await expect(calloutText).toHaveText('Callout');
  });

  test('callout tool deactivates after placing', async ({ page }) => {
    await placeCallout(page);
    const calloutBtn = page.locator('.tool-btn[title*="Callout"]');
    await expect(calloutBtn).not.toHaveClass(/active/);
  });

  test('selecting callout shows Callout Properties in sidebar', async ({ page }) => {
    await placeCallout(page);
    await selectAnnotation(page, 'callout-overlay');

    const propsSection = page.locator('.annotation-props').filter({ hasText: 'Callout Properties' });
    await expect(propsSection).toBeVisible();
    await expect(propsSection.locator('.field-input')).toBeVisible();
    await expect(propsSection.locator('.field-range')).toBeVisible();
  });

  test('callout tip grip appears when selected', async ({ page }) => {
    await placeCallout(page);
    await selectAnnotation(page, 'callout-overlay');

    const gripHandle = page.locator('.overlay-layer .callout-overlay .grip-handle');
    await expect(gripHandle).toBeVisible({ timeout: 3000 });
  });

  test('callout body has move cursor', async ({ page }) => {
    await placeCallout(page);
    const calloutGroup = page.locator('.overlay-layer .callout-overlay');
    await expect(calloutGroup).toBeVisible();
    const style = await calloutGroup.getAttribute('style');
    expect(style).toContain('cursor: move');
  });

  test('callout body drag moves the entire callout', async ({ page }) => {
    await placeCallout(page);

    const calloutText = page.locator('.overlay-layer .callout-overlay text');
    const xBefore = parseFloat((await calloutText.getAttribute('x'))!);

    const calloutBox = await calloutText.boundingBox();
    if (!calloutBox) throw new Error('callout bounding box not found');

    await page.mouse.move(calloutBox.x + calloutBox.width / 2, calloutBox.y + calloutBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      calloutBox.x + calloutBox.width / 2 + 40,
      calloutBox.y + calloutBox.height / 2 + 30,
      { steps: 5 }
    );
    await page.mouse.up();
    await page.waitForTimeout(200);

    const xAfter = parseFloat((await calloutText.getAttribute('x'))!);
    expect(xAfter).not.toBeCloseTo(xBefore, 0);
  });

  test('editing callout text in sidebar updates SVG', async ({ page }) => {
    await placeCallout(page);
    await selectAnnotation(page, 'callout-overlay');

    const textInput = page.locator('.annotation-props .field-input').first();
    await expect(textInput).toBeVisible();
    await textInput.fill('Look here!');
    await page.waitForTimeout(200);

    const calloutText = page.locator('.overlay-layer .callout-overlay text');
    await expect(calloutText).toHaveText('Look here!');
  });

  test('callout tip grip drag repositions the tip', async ({ page }) => {
    await placeCallout(page);
    await selectAnnotation(page, 'callout-overlay');

    const calloutPath = page.locator('.overlay-layer .callout-overlay path');
    const dBefore = await calloutPath.getAttribute('d');

    const gripHandle = page.locator('.overlay-layer .callout-overlay .grip-handle');
    const gripBox = await gripHandle.boundingBox();
    if (!gripBox) throw new Error('callout grip not found');

    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      gripBox.x + gripBox.width / 2 + 40,
      gripBox.y + gripBox.height / 2 + 20,
      { steps: 5 }
    );
    await page.mouse.up();
    await page.waitForTimeout(200);

    const dAfter = await calloutPath.getAttribute('d');
    expect(dAfter).not.toBe(dBefore);
  });
});

// ─── Watermark Tool ───

test.describe('Watermark Tool', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('clicking watermark tool adds watermark immediately', async ({ page }) => {
    await clickTool(page, 'Watermark');

    const svgText = page.locator('.overlay-layer .watermark-overlay text');
    await expect(svgText).toBeVisible({ timeout: 3000 });
    await expect(svgText).toHaveText('Confidential');
  });

  test('watermark is auto-selected and shows properties', async ({ page }) => {
    await clickTool(page, 'Watermark');

    const propsSection = page.locator('.annotation-props').filter({ hasText: 'Watermark Properties' });
    await expect(propsSection).toBeVisible();
    await expect(propsSection.locator('.field-input')).toBeVisible();
    await expect(propsSection.locator('.field-range')).toHaveCount(2);
    await expect(propsSection.locator('.field-select')).toBeVisible();
  });

  test('watermark button toggles off', async ({ page }) => {
    await clickTool(page, 'Watermark');
    const svgText = page.locator('.overlay-layer .watermark-overlay text');
    await expect(svgText).toBeVisible({ timeout: 3000 });

    await clickTool(page, 'Watermark');
    await expect(svgText).not.toBeVisible({ timeout: 3000 });
  });

  test('changing watermark text in sidebar updates SVG', async ({ page }) => {
    await clickTool(page, 'Watermark');
    await page.waitForTimeout(200);

    const textInput = page.locator('.annotation-props .field-input').first();
    await expect(textInput).toBeVisible();
    await textInput.fill('DRAFT');
    await page.waitForTimeout(200);

    const svgText = page.locator('.overlay-layer .watermark-overlay text');
    await expect(svgText).toHaveText('DRAFT');
  });

  test('watermark diagonal has rotation transform', async ({ page }) => {
    await clickTool(page, 'Watermark');
    const svgText = page.locator('.overlay-layer .watermark-overlay text');
    await expect(svgText).toBeVisible({ timeout: 3000 });

    const transform = await svgText.getAttribute('transform');
    expect(transform).toContain('rotate(-45');
  });

  test('re-enabling watermark after removal works', async ({ page }) => {
    await clickTool(page, 'Watermark');
    const svgText = page.locator('.overlay-layer .watermark-overlay text');
    await expect(svgText).toBeVisible({ timeout: 3000 });

    await clickTool(page, 'Watermark');
    await expect(svgText).not.toBeVisible({ timeout: 3000 });

    await clickTool(page, 'Watermark');
    await expect(svgText).toBeVisible({ timeout: 3000 });
    await expect(svgText).toHaveText('Confidential');
  });
});

// ─── SVG Overlay Layer ───

test.describe('SVG Overlay Layer', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('SVG overlay has proper viewBox', async ({ page }) => {
    await placeNote(page);
    const svg = page.locator('.overlay-layer');
    await expect(svg).toBeVisible({ timeout: 3000 });
    const viewBox = await svg.getAttribute('viewBox');
    expect(viewBox).toMatch(/^0 0 \d+ \d+$/);
  });

  test('note has drop shadow filter', async ({ page }) => {
    await placeNote(page);
    const svgText = page.locator('.overlay-layer .note-overlay text');
    await expect(svgText).toBeVisible({ timeout: 3000 });
    const filter = await svgText.getAttribute('filter');
    expect(filter).toContain('drop-shadow');
  });

  test('overlay becomes interactive when tool is active', async ({ page }) => {
    await clickTool(page, 'Arrow');
    const svg = page.locator('.overlay-layer');
    await expect(svg).toBeVisible();
    const style = await svg.getAttribute('style');
    expect(style).toContain('pointer-events: auto');
    expect(style).toContain('cursor: crosshair');
  });
});

// ─── Selection & Delete ───

test.describe('Selection & Delete', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('Escape key deactivates active tool', async ({ page }) => {
    await clickTool(page, 'Arrow');
    const arrowBtn = page.locator('.tool-btn[title*="Arrow"]');
    await expect(arrowBtn).toHaveClass(/active/);

    await focusOverlay(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expect(arrowBtn).not.toHaveClass(/active/);
  });

  test('Escape key deselects annotation', async ({ page }) => {
    await placeNote(page);
    await selectAnnotation(page, 'note-overlay');

    const propsSection = page.locator('.annotation-props').filter({ hasText: 'Note Properties' });
    await expect(propsSection).toBeVisible();

    await focusOverlay(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expect(propsSection).not.toBeVisible();
  });

  test('Delete key removes selected arrow', async ({ page }) => {
    await drawArrow(page);
    const arrowLine = page.locator('.overlay-layer .arrow-overlay line').first();
    await expect(arrowLine).toBeVisible({ timeout: 3000 });

    await selectAnnotation(page, 'arrow-overlay');
    await focusOverlay(page);
    await page.keyboard.press('Delete');

    await expect(arrowLine).not.toBeVisible({ timeout: 3000 });
  });

  test('Delete key removes selected note', async ({ page }) => {
    await placeNote(page);
    const noteText = page.locator('.overlay-layer .note-overlay text');
    await expect(noteText).toBeVisible({ timeout: 3000 });

    await selectAnnotation(page, 'note-overlay');
    await focusOverlay(page);
    await page.keyboard.press('Delete');

    await expect(noteText).not.toBeVisible({ timeout: 3000 });
  });

  test('Delete key removes selected callout', async ({ page }) => {
    await placeCallout(page);
    const calloutPath = page.locator('.overlay-layer .callout-overlay path');
    await expect(calloutPath).toBeVisible({ timeout: 3000 });

    await selectAnnotation(page, 'callout-overlay');
    await focusOverlay(page);
    await page.keyboard.press('Delete');

    await expect(calloutPath).not.toBeVisible({ timeout: 3000 });
  });

  test('Remove button in sidebar deletes arrow', async ({ page }) => {
    await drawArrow(page);
    await selectAnnotation(page, 'arrow-overlay');

    const removeBtn = page.locator('.btn-delete-annotation', { hasText: 'Remove Arrow' });
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();

    const arrowLine = page.locator('.overlay-layer .arrow-overlay line');
    await expect(arrowLine).not.toBeVisible({ timeout: 3000 });
  });

  test('Remove button in sidebar deletes watermark', async ({ page }) => {
    await clickTool(page, 'Watermark');
    const svgText = page.locator('.overlay-layer .watermark-overlay text');
    await expect(svgText).toBeVisible({ timeout: 3000 });

    const removeBtn = page.locator('.btn-delete-annotation', { hasText: 'Remove Watermark' });
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();

    await expect(svgText).not.toBeVisible({ timeout: 3000 });
  });

  test('re-drawing arrow after deletion works', async ({ page }) => {
    await drawArrow(page);
    await selectAnnotation(page, 'arrow-overlay');
    await focusOverlay(page);
    await page.keyboard.press('Delete');

    const arrowLine = page.locator('.overlay-layer .arrow-overlay line');
    await expect(arrowLine).not.toBeVisible({ timeout: 3000 });

    await drawArrow(page);
    await expect(arrowLine.first()).toBeVisible({ timeout: 3000 });
  });

  test('clicking empty space deselects annotation', async ({ page }) => {
    await placeNote(page);
    await selectAnnotation(page, 'note-overlay');

    const propsSection = page.locator('.annotation-props').filter({ hasText: 'Note Properties' });
    await expect(propsSection).toBeVisible();

    await clickTool(page, 'Arrow');
    const box = await getCanvasBox(page);
    if (!box) throw new Error('preview-canvas not found');
    await page.mouse.click(box.x + 5, box.y + 5);
    await page.waitForTimeout(200);
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
    await placeNote(page);
    await placeCallout(page);
    await clickTool(page, 'Watermark');
    await page.waitForTimeout(300);

    await expect(page.locator('.overlay-layer .arrow-overlay line').first()).toBeVisible();
    await expect(page.locator('.overlay-layer .note-overlay text')).toBeVisible();
    await expect(page.locator('.overlay-layer .callout-overlay path')).toBeVisible();
    await expect(page.locator('.overlay-layer .watermark-overlay text')).toBeVisible();
  });

  test('selecting different annotations switches sidebar context', async ({ page }) => {
    await drawArrow(page);
    await placeNote(page);

    await selectAnnotation(page, 'arrow-overlay');
    await expect(page.locator('.annotation-props').filter({ hasText: 'Arrow Properties' })).toBeVisible();

    await selectAnnotation(page, 'note-overlay');
    await expect(page.locator('.annotation-props').filter({ hasText: 'Note Properties' })).toBeVisible();
    await expect(page.locator('.annotation-props').filter({ hasText: 'Arrow Properties' })).not.toBeVisible();
  });
});

// ─── Sidebar Property Variants ───

test.describe('Sidebar Property Variants', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('watermark bottom-right position removes rotation', async ({ page }) => {
    await clickTool(page, 'Watermark');
    await page.waitForTimeout(200);

    const posSelect = page.locator('.annotation-props .field-select');
    await posSelect.selectOption('bottom-right');
    await page.waitForTimeout(200);

    const svgText = page.locator('.overlay-layer .watermark-overlay text');
    await expect(svgText).toBeVisible();
    const transform = await svgText.getAttribute('transform');
    expect(transform).toBeNull();

    const textAnchor = await svgText.getAttribute('text-anchor');
    expect(textAnchor).toBe('end');
  });

  test('arrow type "double" shows two arrowheads', async ({ page }) => {
    await drawArrow(page);
    await selectAnnotation(page, 'arrow-overlay');

    const typeSelect = page.locator('.annotation-props .field-select');
    await typeSelect.selectOption('←→');
    await page.waitForTimeout(200);

    const paths = page.locator('.overlay-layer .arrow-overlay path');
    await expect(paths).toHaveCount(2);
  });

  test('arrow type "left" reverses arrowhead direction', async ({ page }) => {
    await drawArrow(page);
    await selectAnnotation(page, 'arrow-overlay');

    const typeSelect = page.locator('.annotation-props .field-select');
    await typeSelect.selectOption('←');
    await page.waitForTimeout(200);

    const paths = page.locator('.overlay-layer .arrow-overlay path');
    await expect(paths).toHaveCount(1);
  });

  test('callout background color change updates SVG fill', async ({ page }) => {
    await placeCallout(page);
    await selectAnnotation(page, 'callout-overlay');

    const colorInputs = page.locator('.annotation-props .field-color');
    const bgColorInput = colorInputs.nth(1);
    await expect(bgColorInput).toBeVisible();
    await bgColorInput.fill('#ff0000');
    await page.waitForTimeout(200);

    const calloutPath = page.locator('.overlay-layer .callout-overlay path');
    const fill = await calloutPath.getAttribute('fill');
    expect(fill).toBe('#ff0000');
  });

  test('note font size slider changes SVG font-size', async ({ page }) => {
    await placeNote(page);
    await selectAnnotation(page, 'note-overlay');

    const noteText = page.locator('.overlay-layer .note-overlay text');
    const sizeBefore = await noteText.getAttribute('font-size');

    const rangeInput = page.locator('.annotation-props .field-range');
    await rangeInput.fill('20');
    await page.waitForTimeout(200);

    const sizeAfter = await noteText.getAttribute('font-size');
    expect(sizeAfter).toBe('20');
    expect(sizeAfter).not.toBe(sizeBefore);
  });

  test('watermark opacity slider changes SVG opacity', async ({ page }) => {
    await clickTool(page, 'Watermark');
    await page.waitForTimeout(200);

    const svgText = page.locator('.overlay-layer .watermark-overlay text');
    const opacityBefore = await svgText.getAttribute('opacity');

    const rangeInputs = page.locator('.annotation-props .field-range');
    const opacitySlider = rangeInputs.first();
    await opacitySlider.fill('40');
    await page.waitForTimeout(200);

    const opacityAfter = await svgText.getAttribute('opacity');
    expect(opacityAfter).not.toBe(opacityBefore);
    expect(parseFloat(opacityAfter!)).toBeCloseTo(0.4, 1);
  });

  test('note color change updates SVG fill', async ({ page }) => {
    await placeNote(page);
    await selectAnnotation(page, 'note-overlay');

    const colorInput = page.locator('.annotation-props .field-color');
    await colorInput.fill('#ff6600');
    await page.waitForTimeout(200);

    const noteText = page.locator('.overlay-layer .note-overlay text');
    const fill = await noteText.getAttribute('fill');
    expect(fill).toBe('#ff6600');
  });

  test('arrow thickness slider changes SVG stroke-width', async ({ page }) => {
    await drawArrow(page);
    await selectAnnotation(page, 'arrow-overlay');

    const line = page.locator('.overlay-layer .arrow-overlay .arrow-line-body');
    const thicknessBefore = await line.getAttribute('stroke-width');

    const rangeInput = page.locator('.annotation-props .field-range');
    await rangeInput.fill('5');
    await page.waitForTimeout(200);

    const thicknessAfter = await line.getAttribute('stroke-width');
    expect(thicknessAfter).toBe('5');
    expect(thicknessAfter).not.toBe(thicknessBefore);
  });

  test('remove note via sidebar button', async ({ page }) => {
    await placeNote(page);
    await selectAnnotation(page, 'note-overlay');

    const removeBtn = page.locator('.btn-delete-annotation', { hasText: 'Remove Note' });
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();

    const noteText = page.locator('.overlay-layer .note-overlay text');
    await expect(noteText).not.toBeVisible({ timeout: 3000 });
  });

  test('remove callout via sidebar button', async ({ page }) => {
    await placeCallout(page);
    await selectAnnotation(page, 'callout-overlay');

    const removeBtn = page.locator('.btn-delete-annotation', { hasText: 'Remove Callout' });
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();

    const calloutPath = page.locator('.overlay-layer .callout-overlay path');
    await expect(calloutPath).not.toBeVisible({ timeout: 3000 });
  });
});

// ─── Export Pipeline ───

test.describe('Export Pipeline', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    await openExportModal(page);
  });

  test('download PNG button is present and enabled', async ({ page }) => {
    const downloadBtn = page.locator('.btn-export');
    await expect(downloadBtn).toBeVisible();
    await expect(downloadBtn).toHaveText(/Download PNG/);
    await expect(downloadBtn).toBeEnabled();
  });

  test('export triggers download with correct filename', async ({ page }) => {
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

  test('export with all annotation overlays produces valid PNG', async ({ page }) => {
    await drawArrow(page);
    await placeNote(page);
    await placeCallout(page);
    await clickTool(page, 'Watermark');
    await page.waitForTimeout(300);

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.locator('.btn-export').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('zenuml-diagram-export.png');
    const path = await download.path();
    expect(path).toBeTruthy();
  });
});
