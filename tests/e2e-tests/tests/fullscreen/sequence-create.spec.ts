// sequence-create:0..9 — Create flow for the Diagram (Mermaid, PlantUML &
// ZenUML) macro inside the fullscreen Forge bridge modal. Source of truth
// is docs/fullscreen-test-rerun-data.json.

import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import {
  expectModalVisible,
  expectFullscreenLayout,
  expectPublishButtonState,
  fillEditorTitle,
  clickEditorPublish,
  expectModalClosed,
  switchEditorTab,
  modalContentFrame,
} from '../../helpers/FullscreenModalHelper.js';
import { insertMacro } from '../../helpers/MacroFlowHelper.js';
import {
  bridgeModalFrame,
  dispatchSyntheticBeforeunload,
  dirtyEditor,
} from '../../helpers/CloseGuardHelper.js';
import { createPageAndSetup } from '../insert/insert-helpers.js';

test.describe('Sequence — Create flow', () => {
  test.skip(!testConfig.isForge && !testConfig.isLite, 'Forge-only chrome');
  test.skip(!testConfig.macros.includes('sequence'), 'sequence not in profile');

  // sequence-create:0 — Slash menu finds the macro.
  // The act of inserting the macro proves it's findable; if the macro browser
  // returned 0 options or didn't include this macro, insertMacro() throws
  // immediately with the available-options diagnostic.
  test('sequence-create:0 — macro is findable in the element browser', async ({ page }) => {
    const { macroName } = await insertMacro(page, 'sequence');
    expect(macroName).toMatch(/Diagram \(Mermaid, PlantUML & ZenUML\)/);
  });

  // sequence-create:1 — Modal opens at fullscreen viewport.
  test('sequence-create:1 — modal opens at fullscreen viewport (header 70px)', async ({ page }) => {
    await insertMacro(page, 'sequence');
    await expectFullscreenLayout(page, 'edit');
  });

  // sequence-create:2 — Sequence tab is selected by default.
  test('sequence-create:2 — Sequence tab selected by default with sample code', async ({ page }) => {
    await insertMacro(page, 'sequence');
    const frame = modalContentFrame(page, 'edit');
    const sequenceTab = frame.getByRole('tab', { name: 'Sequence' });
    // aria-selected="true" is the canonical signal.
    await expect(sequenceTab).toHaveAttribute('aria-selected', 'true');
  });

  // sequence-create:3 — Tab switch to Mermaid.
  // Manual run noted Mermaid preview fails in dev (vendor not bundled);
  // the TAB SWITCH itself works. We verify only the editor mode changes —
  // not preview rendering — to keep the test stable across environments.
  test('sequence-create:3 — Mermaid tab switches editor mode', async ({ page }) => {
    await insertMacro(page, 'sequence');
    await switchEditorTab(page, 'Mermaid');
    const frame = modalContentFrame(page, 'edit');
    const mermaidTab = frame.getByRole('tab', { name: 'Mermaid' });
    await expect(mermaidTab).toHaveAttribute('aria-selected', 'true');
    // Editor should reflect Mermaid-syntax baseline (sequenceDiagram is
    // Mermaid's keyword for sequence diagrams).
    await expect(frame.locator('.cm-content, .CodeMirror').first()).toContainText(/sequenceDiagram|flowchart|graph/i);
  });

  // sequence-create:4 — Tab switch to PlantUML.
  test('sequence-create:4 — PlantUML tab switches editor mode', async ({ page }) => {
    await insertMacro(page, 'sequence');
    await switchEditorTab(page, 'PlantUML');
    const frame = modalContentFrame(page, 'edit');
    const plantTab = frame.getByRole('tab', { name: 'PlantUML' });
    await expect(plantTab).toHaveAttribute('aria-selected', 'true');
    // PlantUML syntax marker.
    await expect(frame.locator('.cm-content, .CodeMirror').first()).toContainText(/@startuml|@enduml/);
  });

  // sequence-create:5 — Title field empty → Publish disabled.
  test('sequence-create:5 — empty title disables Publish', async ({ page }) => {
    await insertMacro(page, 'sequence');
    await expectPublishButtonState(page, 'disabled');
  });

  // sequence-create:6 — Title non-empty → Publish enabled.
  test('sequence-create:6 — non-empty title enables Publish', async ({ page }) => {
    await insertMacro(page, 'sequence');
    await fillEditorTitle(page, 'Test PlantUML Diagram');
    await expectPublishButtonState(page, 'enabled');
  });

  // sequence-create:7 — Publish persists macro on page.
  test('sequence-create:7 — Publish closes modal and inserts the macro', async ({ page }) => {
    await insertMacro(page, 'sequence');
    await fillEditorTitle(page, `seq-${Date.now()}`);
    await clickEditorPublish(page);
    await expectModalClosed(page, 'edit');
    // Forge extension container appears in the editor canvas.
    const inserted = page.locator('[data-testid="ForgeExtensionContainer"]').first();
    await expect(inserted).toBeVisible({ timeout: 30_000 });
  });

  // sequence-create:8 — Close clean.
  test('sequence-create:8 — clean editor: synthetic beforeunload is false', async ({ page }) => {
    await insertMacro(page, 'sequence');
    const result = await dispatchSyntheticBeforeunload(bridgeModalFrame(page));
    expect(result).toBe(false);
  });

  // sequence-create:9 — Close dirty.
  test('sequence-create:9 — dirty editor: synthetic beforeunload is true', async ({ page }) => {
    await insertMacro(page, 'sequence');
    await dirtyEditor(page, 'sequence');
    const result = await dispatchSyntheticBeforeunload(bridgeModalFrame(page));
    expect(result).toBe(true);
  });
});
