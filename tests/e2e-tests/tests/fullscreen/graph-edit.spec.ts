// graph-edit:0..4 — Edit flow for an existing Graph (DrawIO) macro.

import { test, expect, type FrameLocator } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import {
  expectFullscreenLayout,
  clickEditorPublish,
  clickHeaderClose,
  expectModalClosed,
  modalContentFrame,
} from '../../helpers/FullscreenModalHelper.js';
import { insertAndPublishMacro, openEditModal } from '../../helpers/MacroFlowHelper.js';
import { MacroPage } from '../../pages/MacroPage.js';
import {
  bridgeModalFrame,
  dispatchSyntheticBeforeunload,
  dirtyEditor,
  readPersistedDraft,
  GRAPH_DIRTY_MARKER,
} from '../../helpers/CloseGuardHelper.js';

test.describe('Graph (DrawIO) — Edit flow', () => {
  // Every test seeds its own page (`seed()` publishes a fresh macro) and reads
  // only that page's state, so there is nothing to share between them. Without
  // this, the root config's `fullyParallel: false` makes the whole file ONE
  // indivisible shard group: `--shard=N/4` put all 8 tests on shard 1 and left
  // shards 2-4 with zero tests, so the DrawIO Publish gate ran 7.6 min serially
  // and became the critical path of the whole build (run 33156603821). Parallel
  // mode makes each test its own group, so the existing 4 shard runners split
  // the work.
  test.describe.configure({ mode: 'parallel' });

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
  // graph-edit:1 — the autosave handler consumed the dispatched XML.
  //
  // This used to read `window._drawioModified`. That was never a window global:
  // it was ForgeGraphEditor.vue component data, renamed to `drawioModified` on
  // 2026-05-11 by 56a7d6b6 ("fix(lint): avoid vue/no-reserved-keys on component
  // data"). The read returned undefined and the assertion could not pass. It
  // went unnoticed because the `fullscreen` project had never run in CI — the
  // DrawIO Publish gate this branch adds is the first job to execute it.
  //
  // The observable the app actually produces is the debounced localStorage
  // draft (draftStore.ts, 500ms), which is also what protects unsaved work.
  test('graph-edit:1 — an autosave with xml reaches the persisted draft', async ({ page }) => {
    await seed(page, `graph-canvas-${Date.now()}`);
    await openEditModal(page, 'graph');
    const frame = bridgeModalFrame(page);

    expect(await readPersistedDraft(frame)).toBeNull();
    await dirtyEditor(page, 'graph');

    await expect.poll(
      async () => (await readPersistedDraft(frame))?.code ?? '',
      { timeout: 15_000 },
    ).toContain(GRAPH_DIRTY_MARKER);
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

  // graph-edit:7 — Board is a real publish/view lifecycle, not only a button
  // smoke test: content authored on the Board surface must reach Confluence as
  // the Board document and come back out of the viewer.
  //
  // The Board content is injected through DrawIO's own `load` action — the
  // same embed protocol ForgeGraphEditor.vue uses on every frame load — rather
  // than by clicking a palette shape. The sketch UI collapses its shapes panel
  // to width 0 and defers palette initialisation, so `.geSidebar` holds zero
  // anchors until the user opens it (probed on lite-stg 2026-08-26:
  // `container display=block visibility=visible w=0`, `visible .geSidebar a
  // count=0`), and a canvas double-click inserts nothing. Driving DrawIO's own
  // chrome is not what this test is for; the code under test is our document
  // routing — which surface's XML the save handler publishes, and which one the
  // viewer reads back.
  test('graph-edit:7 — publish Board content and render it in the viewer', async ({ page }) => {
    const marker = `board-lifecycle-${Date.now()}`;
    const boardXml = '<mxfile><diagram name="Board-1"><mxGraphModel><root>'
      + '<mxCell id="0" /><mxCell id="1" parent="0" />'
      + `<mxCell id="board-card" value="${marker}" vertex="1" parent="1" style="rounded=0;">`
      + '<mxGeometry x="80" y="80" width="200" height="60" as="geometry" /></mxCell>'
      + '</root></mxGraphModel></diagram></mxfile>';

    await seed(page, `graph-board-view-${Date.now()}`);
    await openEditModal(page, 'graph');

    const outerFrame = modalContentFrame(page, 'edit');
    let drawioFrame = outerFrame.locator('iframe').contentFrame();
    await expect(drawioFrame.locator('.graph-mode-switch button').nth(1)).toBeVisible({ timeout: 30_000 });
    await drawioFrame.locator('.graph-mode-switch button').nth(1).click();
    await expect(outerFrame.locator('iframe')).toHaveAttribute('src', /ui=sketch&sketch=1/);

    // FrameLocator is dynamic, so this resolves against the reloaded Board
    // document rather than retaining the old Diagram document.
    drawioFrame = outerFrame.locator('iframe').contentFrame();
    await expect(drawioFrame.locator('.geDiagramContainer')).toBeVisible({ timeout: 30_000 });

    // Record the DrawIO `save` payload — the event ForgeGraphEditor.vue's
    // handler consumes to build the publish — then load the Board content.
    // DrawIO emits `autosave` on model CHANGES, not on a programmatic load, so
    // the save payload is the observable that proves which document the Board
    // surface published.
    await outerFrame.locator('body').evaluate((_el, xml) => {
      const target = window as unknown as { __boardSave?: string };
      target.__boardSave = undefined;
      window.addEventListener('message', (event: MessageEvent) => {
        let payload: unknown = event.data;
        if (typeof payload === 'string') {
          try { payload = JSON.parse(payload); } catch { return; }
        }
        if (payload && typeof payload === 'object' && (payload as { event?: unknown }).event === 'save') {
          const saved = (payload as { xml?: unknown }).xml;
          if (typeof saved === 'string') target.__boardSave = saved;
        }
      });
      const frame = document.querySelector('iframe') as HTMLIFrameElement | null;
      frame?.contentWindow?.postMessage(JSON.stringify({ action: 'load', xml, autosave: 1 }), '*');
    }, boardXml);

    // Wait for the loaded cell to reach the canvas before publishing; a
    // Publish that raced the load would persist an empty Board document.
    await expect(drawioFrame.locator('.geDiagramContainer')).toContainText(marker, { timeout: 30_000 });

    await drawioFrame.locator('.geButtonContainer .geEmbedBtn').click();

    await expect.poll(
      async () => outerFrame.locator('body').evaluate(
        (_el, needle) => ((window as unknown as { __boardSave?: string }).__boardSave ?? '').includes(needle),
        marker,
      ),
      { timeout: 30_000 },
    ).toBe(true);
    await expectModalClosed(page, 'edit');

    // The editor close handler reloads the viewer after save. Assert the
    // published Board document is rendered, not merely that save closed.
    const viewer = new MacroPage(page);
    const graphFrame = viewer.getGraphMacroFrame();
    await expect(graphFrame.locator('body')).toBeVisible({ timeout: 30_000 });
    await expect(graphFrame.locator('svg').first()).toBeVisible({ timeout: 30_000 });
    await expect(graphFrame.getByText(marker, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  });

  // graph-edit:3 — Close clean.
  test('graph-edit:3 — re-open clean: synthetic beforeunload is false', async ({ page }) => {
    await seed(page, `graph-clean-${Date.now()}`);
    await openEditModal(page, 'graph');
    const result = await dispatchSyntheticBeforeunload(bridgeModalFrame(page));
    expect(result).toBe(false);
  });

  // graph-edit:4 — Close dirty.
  //
  // This used to assert dispatchSyntheticBeforeunload() === true. closeGuard.ts
  // deliberately REPLACED beforeunload with view.onClose (its header explains
  // why: a parent JS-destroying an iframe fires beforeunload but suppresses the
  // dialog), so no beforeunload listener exists and the helper can only ever
  // return false. CloseGuardHelper.ts's own doc comment states the replacement
  // contract: "the draft is what actually protects unsaved work, so that is
  // what the dirty-path tests assert."
  test('graph-edit:4 — a dirty autosave leaves a draft that survives the close', async ({ page }) => {
    await seed(page, `graph-dirty-${Date.now()}`);
    await openEditModal(page, 'graph');
    const frame = bridgeModalFrame(page);
    await dirtyEditor(page, 'graph');
    await expect.poll(
      async () => (await readPersistedDraft(frame))?.code ?? '',
      { timeout: 15_000 },
    ).toContain(GRAPH_DIRTY_MARKER);

    // The draft must still be there after the modal closes — that is the
    // recovery anchor a user gets back on the next open.
    await clickHeaderClose(page, 'edit');
    await expectModalClosed(page, 'edit');
    await openEditModal(page, 'graph');
    await expect.poll(
      async () => (await readPersistedDraft(bridgeModalFrame(page)))?.code ?? '',
      { timeout: 15_000 },
    ).toContain(GRAPH_DIRTY_MARKER);
  });
});
