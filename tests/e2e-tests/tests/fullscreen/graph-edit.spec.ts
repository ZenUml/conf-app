// graph-edit:0..4 — Edit flow for an existing Graph (DrawIO) macro.

import { test, expect, type FrameLocator } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import {
  expectFullscreenLayout,
  clickEditorPublish,
  expectModalClosed,
  modalContentFrame,
} from '../../helpers/FullscreenModalHelper.js';
import { insertAndPublishMacro, openEditModal } from '../../helpers/MacroFlowHelper.js';
import { MacroPage } from '../../pages/MacroPage.js';
import {
  bridgeModalFrame,
  dispatchSyntheticBeforeunload,
  dirtyEditor,
} from '../../helpers/CloseGuardHelper.js';

test.describe('Graph (DrawIO) — Edit flow', () => {
  test.skip(!testConfig.isForge && !testConfig.isLite, 'Forge-only chrome');
  test.skip(!testConfig.macros.includes('graph'), 'graph not in profile');

  async function seed(page: import('@playwright/test').Page, title: string) {
    return insertAndPublishMacro(page, 'graph', { title });
  }

  async function installDrawioSaveProbe(frame: FrameLocator): Promise<void> {
    await frame.locator('body').evaluate(() => {
      const target = window as unknown as {
        __drawioSaveEvents?: Array<{ event: 'save'; hasXml: boolean }>;
        __drawioSaveListener?: (event: MessageEvent) => void;
      };
      target.__drawioSaveEvents = [];
      target.__drawioSaveListener = (event: MessageEvent) => {
        let payload: unknown = event.data;
        if (typeof payload === 'string') {
          try {
            payload = JSON.parse(payload);
          } catch {
            return;
          }
        }
        if (!payload || typeof payload !== 'object' || (payload as { event?: unknown }).event !== 'save') {
          return;
        }
        target.__drawioSaveEvents?.push({
          event: 'save',
          hasXml: typeof (payload as { xml?: unknown }).xml === 'string',
        });
      };
      window.addEventListener('message', target.__drawioSaveListener);
    });
  }

  async function readDrawioSaveEvents(frame: FrameLocator) {
    return frame.locator('body').evaluate(() => (
      (window as unknown as {
        __drawioSaveEvents?: Array<{ event: 'save'; hasXml: boolean }>;
      }).__drawioSaveEvents ?? []
    ));
  }

  // graph-edit:0 — Edit button opens fullscreen modal.
  test('graph-edit:0 — Edit button opens fullscreen modal', async ({ page }) => {
    await seed(page, `graph-edit-${Date.now()}`);
    await openEditModal(page, 'graph');
    await expectFullscreenLayout(page, 'edit');
  });

  // graph-edit:1 — Edits update canvas. Manual run verified via "Undo button
  // becomes active after canvas mutation". We assert the same by dispatching
  // the autosave message and reading `_drawioModified`.
  test('graph-edit:1 — autosave dispatch flips the dirty flag', async ({ page }) => {
    await seed(page, `graph-canvas-${Date.now()}`);
    await openEditModal(page, 'graph');
    // Read window._drawioModified before/after dispatch — caveman-clean
    // observation that the message handler in ForgeGraphEditor.vue ran.
    const beforeAfter = await modalContentFrame(page, 'edit').locator('body').evaluate(() => {
      const before = (window as unknown as { _drawioModified?: boolean })._drawioModified ?? false;
      window.dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify({ event: 'autosave', modified: true }),
      }));
      const after = (window as unknown as { _drawioModified?: boolean })._drawioModified ?? false;
      return { before, after };
    });
    expect(beforeAfter.before).toBe(false);
    expect(beforeAfter.after).toBe(true);
  });

  // graph-edit:2 — Publish persists edit.
  test('graph-edit:2 — Publish closes the modal', async ({ page }) => {
    await seed(page, `graph-publish-${Date.now()}`);
    await openEditModal(page, 'graph');
    await clickEditorPublish(page, { nested: 'drawio' });
    await expectModalClosed(page, 'edit');
  });

  // graph-edit:5 — v31's embed action container is visible in Diagram mode.
  // This is intentionally asserted inside the nested DrawIO frame: the
  // publish action is DrawIO's save/publish protocol, not our outer Vue UI.
  test('graph-edit:5 — Diagram Publish is visible and closes the modal', async ({ page }) => {
    await seed(page, `graph-diagram-publish-${Date.now()}`);
    await openEditModal(page, 'graph');

    const outerFrame = modalContentFrame(page, 'edit');
    await installDrawioSaveProbe(outerFrame);
    const drawioFrame = outerFrame.locator('iframe').contentFrame();
    const publish = drawioFrame.locator('.geButtonContainer .geEmbedBtn');
    await expect(publish).toBeVisible();
    await expect(publish).toHaveText('Publish');
    await expect(publish).toBeEnabled();

    await publish.click();
    await expect.poll(() => readDrawioSaveEvents(outerFrame)).toEqual([
      { event: 'save', hasXml: true },
    ]);
    await expectModalClosed(page, 'edit');
  });

  // graph-edit:6 — the same action survives the Board/sketch reload.
  test('graph-edit:6 — Board Publish is visible and closes the modal', async ({ page }) => {
    await seed(page, `graph-board-publish-${Date.now()}`);
    await openEditModal(page, 'graph');

    const outerFrame = modalContentFrame(page, 'edit');
    let drawioFrame = outerFrame.locator('iframe').contentFrame();
    await expect(drawioFrame.locator('.graph-mode-switch button').nth(1)).toBeVisible();
    await drawioFrame.locator('.graph-mode-switch button').nth(1).click();
    await expect(outerFrame.locator('iframe')).toHaveAttribute('src', /ui=sketch&sketch=1/);

    // FrameLocator is dynamic, so this resolves against the reloaded Board
    // document rather than retaining the old Diagram document.
    drawioFrame = outerFrame.locator('iframe').contentFrame();
    // Install after the Board reload so the probe observes only the user's
    // Publish action, not any init/load traffic from the mode switch.
    await installDrawioSaveProbe(outerFrame);
    const publish = drawioFrame.locator('.geButtonContainer .geEmbedBtn');
    await expect(publish).toBeVisible();
    await expect(publish).toHaveText('Publish');
    await expect(publish).toBeEnabled();

    await publish.click();
    await expect.poll(() => readDrawioSaveEvents(outerFrame)).toEqual([
      { event: 'save', hasXml: true },
    ]);
    await expectModalClosed(page, 'edit');
  });

  // graph-edit:7 — Board is a real edit/publish/view lifecycle, not only a
  // button smoke test.  The palette click is intentionally kept as a real
  // DrawIO interaction: Board starts as an independent empty document, so a
  // vertex in boardGraphXml proves that the new surface was edited rather
  // than the legacy Diagram document being re-used.
  test('graph-edit:7 — add Board content, Publish, and render it in the viewer', async ({ page }) => {
    await seed(page, `graph-board-view-${Date.now()}`);
    await openEditModal(page, 'graph');

    const outerFrame = modalContentFrame(page, 'edit');
    let drawioFrame = outerFrame.locator('iframe').contentFrame();
    await drawioFrame.locator('.graph-mode-switch button').nth(1).click();
    await expect(outerFrame.locator('iframe')).toHaveAttribute('src', /ui=sketch&sketch=1/);

    drawioFrame = outerFrame.locator('iframe').contentFrame();
    await outerFrame.locator('body').evaluate(() => {
      const target = window as unknown as { __latestBoardAutosave?: string; __boardAutosaveListener?: (event: MessageEvent) => void };
      target.__latestBoardAutosave = undefined;
      target.__boardAutosaveListener = (event: MessageEvent) => {
        let payload: unknown = event.data;
        if (typeof payload === 'string') {
          try { payload = JSON.parse(payload); } catch { return; }
        }
        if (payload && typeof payload === 'object' && (payload as { event?: unknown }).event === 'autosave') {
          const xml = (payload as { xml?: unknown }).xml;
          if (typeof xml === 'string') target.__latestBoardAutosave = xml;
        }
      };
      window.addEventListener('message', target.__boardAutosaveListener);
    });
    const sidebarShape = drawioFrame.locator('.geSidebarContainer a').nth(2);
    await expect(sidebarShape).toBeVisible({ timeout: 30_000 });
    await sidebarShape.click();
    // The freshly inserted palette cell is selected by DrawIO.  Typing its
    // label is the same interaction a user performs after dropping a shape;
    // it gives the viewer assertion a Board-specific marker.
    await drawioFrame.locator('body').press('F2');
    await drawioFrame.locator('body').pressSequentially('Board lifecycle');
    await drawioFrame.locator('body').press('Enter');

    // DrawIO emits the active mode's XML through the editor bridge.  Require
    // an actual vertex before publishing; an empty Board would make this
    // test a false positive for the old "Publish only" coverage.
    await expect.poll(async () => outerFrame.locator('body').evaluate(() => {
      const boardXml = (window as unknown as { __latestBoardAutosave?: unknown }).__latestBoardAutosave;
      return typeof boardXml === 'string' && /vertex=["']1["']/.test(boardXml);
    }), { timeout: 15_000 }).toBe(true);

    await drawioFrame.locator('.geButtonContainer .geEmbedBtn').click();
    await expectModalClosed(page, 'edit');

    // The editor close handler reloads the viewer after save.  Assert the
    // published Board document is rendered, not merely that save closed.
    const viewer = new MacroPage(page);
    const graphFrame = viewer.getGraphMacroFrame();
    await expect(graphFrame.locator('body')).toBeVisible({ timeout: 30_000 });
    await expect(graphFrame.locator('svg').first()).toBeVisible({ timeout: 30_000 });
    await expect(graphFrame.getByText('Board lifecycle', { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  });

  // graph-edit:3 — Close clean.
  test('graph-edit:3 — re-open clean: synthetic beforeunload is false', async ({ page }) => {
    await seed(page, `graph-clean-${Date.now()}`);
    await openEditModal(page, 'graph');
    const result = await dispatchSyntheticBeforeunload(bridgeModalFrame(page));
    expect(result).toBe(false);
  });

  // graph-edit:4 — Close dirty.
  test('graph-edit:4 — re-open dirty (autosave): synthetic beforeunload is true', async ({ page }) => {
    await seed(page, `graph-dirty-${Date.now()}`);
    await openEditModal(page, 'graph');
    await dirtyEditor(page, 'graph');
    const result = await dispatchSyntheticBeforeunload(bridgeModalFrame(page));
    expect(result).toBe(true);
  });
});
