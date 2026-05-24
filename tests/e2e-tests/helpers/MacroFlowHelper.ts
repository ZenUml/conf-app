// High-level macro flow primitives: open the bridge modal via slash menu
// (insert flow) or via toolbar Edit (edit flow). Used by every spec under
// tests/fullscreen/, so spec files don't repeat the editor-page boilerplate.
//
// CAVEATS:
//  - testConfig.macros gates which macros are present in the active profile;
//    callers MUST `test.skip(!testConfig.macros.includes(kind), ...)` first.
//  - createPageAndSetup() issues a real Confluence /create-content/page nav.
//    Do NOT call repeatedly inside one test — reuse the editorPage instance.
//  - For edit flow, the page must already have a published macro of the same
//    kind. We don't manage that lifecycle here; the Edit-flow specs first run
//    the create flow to seed the macro, then click Edit.

import { Page, FrameLocator, expect } from '@playwright/test';
import { ConfluenceEditorPage } from '../pages/EditorPage.js';
import { MacroPage } from '../pages/MacroPage.js';
import { testConfig } from '../config/test-config.js';
import { createPageAndSetup } from '../tests/insert/insert-helpers.js';
import {
  expectModalVisible,
  modalContentFrame,
  fillEditorTitle,
  clickEditorPublish,
  expectModalClosed,
} from './FullscreenModalHelper.js';

export type MacroKind = 'sequence' | 'graph' | 'openapi';

const MACRO_BASE_NAMES: Record<MacroKind, string> = {
  sequence: 'Diagram (Mermaid, PlantUML & ZenUML)',
  graph: 'Graph (DrawIO)',
  openapi: 'OpenAPI / Swagger',
};

const MACRO_SEARCH_TERMS: Record<MacroKind, string> = {
  sequence: 'diagram',
  graph: 'graph',
  openapi: 'openapi',
};

/**
 * Insert a macro via the slash menu / element browser. Leaves the bridge
 * modal open and waits for the editor iframe to be visible.
 */
export async function insertMacro(
  page: Page,
  kind: MacroKind,
): Promise<{ editorPage: ConfluenceEditorPage; macroName: string }> {
  if (!testConfig.macros.includes(kind)) {
    throw new Error(`insertMacro: macro "${kind}" not in active profile [${testConfig.macros.join(', ')}]`);
  }
  const variantLabel = testConfig.isLite ? ' Lite' : '';
  const editorPage = await createPageAndSetup(page, variantLabel);
  await editorPage.dismissLearnTheBasicsPanel();

  const macroName = editorPage.getMacroName(MACRO_BASE_NAMES[kind]);
  await editorPage.clickInsertElements();
  await editorPage.searchAndSelectMacro(MACRO_SEARCH_TERMS[kind], macroName);
  await expectModalVisible(page, 'edit');
  // Vue/React mount + spec listeners need a beat to settle; the OpenAPI
  // baseline isn't captured otherwise. Same delay as close-guard.spec.ts.
  await page.waitForTimeout(1500);
  return { editorPage, macroName };
}

/**
 * Insert + publish a macro to seed an Edit-flow test. Returns once the
 * macro is rendered on the published page and the toolbar is visible.
 */
export async function insertAndPublishMacro(
  page: Page,
  kind: MacroKind,
  options: { title?: string } = {},
): Promise<{ editorPage: ConfluenceEditorPage; macroPage: MacroPage; pageId: string }> {
  const { editorPage } = await insertMacro(page, kind);
  const title = options.title ?? `Test ${kind} ${Date.now()}`;
  await fillEditorTitle(page, title);

  if (kind === 'graph') {
    // DrawIO Publish is in the inner iframe.
    await clickEditorPublish(page, { nested: 'drawio' });
  } else {
    await clickEditorPublish(page);
  }
  await expectModalClosed(page, 'edit');

  // Now publish the page so the viewer toolbar mounts.
  await editorPage.publishPage();
  const macroPage = new MacroPage(page);
  await macroPage.dismissSpotlightModal();

  const pageId = page.url().match(/\/pages\/(\d+)\//)?.[1] ?? '';
  return { editorPage, macroPage, pageId };
}

/**
 * Click the Edit button in a published macro's viewer toolbar and wait for
 * the bridge modal to open with the existing source loaded.
 */
export async function openEditModal(page: Page, kind: MacroKind): Promise<FrameLocator> {
  const macroPage = new MacroPage(page);
  let frame: FrameLocator;
  switch (kind) {
    case 'sequence': frame = macroPage.getSequenceMacroFrame(); break;
    case 'graph':    frame = macroPage.getGraphMacroFrame();    break;
    case 'openapi':  frame = macroPage.getOpenApiMacroFrame();  break;
  }
  await expect(frame.locator('body')).toBeVisible({ timeout: 30_000 });
  await macroPage.editMacro(frame);
  await expectModalVisible(page, 'edit');
  await page.waitForTimeout(1500); // mount settle
  return modalContentFrame(page, 'edit');
}
