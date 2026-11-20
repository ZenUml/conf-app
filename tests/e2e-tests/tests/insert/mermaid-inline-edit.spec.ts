import { test, expect } from '../../fixtures/mixpanel-test.js';
import type { FrameLocator, Locator, Page } from '@playwright/test';
import { testConfig, TIMEOUTS } from '../../config/test-config.js';
import { ConfluenceEditorPage } from '../../pages/EditorPage.js';
import { MacroPage } from '../../pages/MacroPage.js';
import { DiagramTestHelper } from '../../helpers/DiagramTestHelper.js';

/**
 * Mermaid sequence inline edit (docs/features/mermaid-inline-edit.md,
 * src/features/mermaidInlineEdit/).
 *
 * In the macro editor preview (Workspace.vue), double-clicking a participant
 * label or a message text opens a contenteditable layer (`div.mie-layer`) over
 * the text. Typing re-renders the preview without writing the source; Enter
 * writes the source once; Esc cancels. The page viewer never mounts it.
 *
 * Each test builds its own draft page: the `insert` project is fullyParallel,
 * so tests in one file can land on different shards.
 *
 * Input rules that matter here:
 * - Real mouse double-clicks and `page.keyboard` only. The layer reacts to
 *   `input` events from the contenteditable itself; `fill()` bypasses them.
 * - A double-click selects the word under the pointer, so a suffix needs
 *   `End` first and a replacement needs select-all first.
 * - The code is typed with `enterCodeInEditor` (pressSequentially). CodeMirror
 *   may add indentation on Enter, so expected code is derived from the code
 *   actually in the editor, never from the literal typed string.
 */

const macroType = 'mermaid' as const;
const skip = !testConfig.macros.includes(macroType);

const SOURCE = 'sequenceDiagram\n  participant Alice\n  participant Bob\n  Alice->>Bob: Hi';
const NAME_EXISTS_HINT = 'A participant with that name already exists.';

const exact = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/** The source, line by line, as CodeMirror holds it (`.cm-content` textContent drops the newlines). */
async function readCode(frame: FrameLocator): Promise<string> {
  const lines = await frame.locator('.cm-content[contenteditable="true"]').first().locator('.cm-line').allTextContents();
  return lines.join('\n');
}

/** A rendered participant label in the editor preview SVG (top or bottom copy). */
function actorLabel(frame: FrameLocator, name: string): Locator {
  return frame.locator('.diagram-viewport-content svg text.actor').filter({ hasText: exact(name) });
}

/** A rendered message label line in the editor preview SVG. */
function messageLabel(frame: FrameLocator, text: string): Locator {
  return frame.locator('.diagram-viewport-content svg text.messageText').filter({ hasText: exact(text) });
}

function editLayer(frame: FrameLocator): Locator {
  return frame.locator('div.mie-layer');
}

/**
 * The controller adds `mie-enabled` to the Mermaid container only when the
 * three-way equality holds (rendered code = source map = store) and no layer
 * is open. Waiting for it replaces a sleep before every double-click.
 */
async function waitEditable(frame: FrameLocator): Promise<void> {
  await expect(frame.locator('.mie-enabled').first()).toBeAttached({ timeout: TIMEOUTS.FRAME_LOAD });
}

async function setupSequence(page: Page, testName: string) {
  const editorPage = new ConfluenceEditorPage(page);
  const helper = new DiagramTestHelper(page, editorPage);
  await helper.createPageWithDiagramMacro(testName);
  await editorPage.switchToMacroTab('Mermaid');
  await helper.enterCodeInEditor(SOURCE);
  const frame = editorPage.getMacroEditorFrame();
  await waitEditable(frame);
  await expect(actorLabel(frame, 'Bob').first()).toBeAttached({ timeout: TIMEOUTS.FRAME_LOAD });
  const before = await readCode(frame);
  // Sanity: the typed source landed (indentation may differ, see file header).
  expect(before).toMatch(/^\s*participant Bob$/m);
  expect(before).toContain('Alice->>Bob: Hi');
  console.log(`  ✓ Source in editor:\n${before}`);
  return { editorPage, frame, before };
}

/** Expected code after renaming participant Bob (no alias) to `name`: its declaration and every use. */
function renamedBob(before: string, name: string): string {
  return before
    .replace(/^(\s*participant )Bob$/m, `$1${name}`)
    .replace('Alice->>Bob: Hi', `Alice->>${name}: Hi`);
}

async function openLayerOn(_page: Page, frame: FrameLocator, label: Locator, ariaLabel: string): Promise<Locator> {
  await waitEditable(frame);
  await label.first().dblclick();
  const layer = editLayer(frame);
  await expect(layer).toHaveCount(1, { timeout: TIMEOUTS.BUTTON_VISIBLE });
  await expect(layer).toHaveAttribute('aria-label', ariaLabel);
  await expect(layer).toBeFocused();
  return layer;
}

test.describe('Mermaid sequence inline edit', { tag: ['@test:mermaid', '@variant:lite', '@variant:full', '@variant:diagramly', '@editor', '@viewer', '@mermaid', '@feature:editing', '@interface:editor', '@scenario:editing:editor'] }, () => {
  test.skip(skip, `Macro "${macroType}" not in app profile [${testConfig.macros.join(', ')}]`);

  test('rename a participant in place: live preview, source written once on Enter', async ({ page }) => {
    const { frame, before } = await setupSequence(page, 'Mermaid Inline Rename');

    await test.step('Double-click the Bob label and type a suffix', async () => {
      await openLayerOn(page, frame, actorLabel(frame, 'Bob'), 'Edit participant name');
      await page.keyboard.press('End');
      await page.keyboard.type('by');
    });

    await test.step('Preview shows Bobby; the code is not written yet', async () => {
      await expect(actorLabel(frame, 'Bobby').first()).toBeAttached({ timeout: TIMEOUTS.FRAME_LOAD });
      expect(await readCode(frame)).toBe(before);
    });

    await test.step('Enter writes the source once', async () => {
      await page.keyboard.press('Enter');
      const expected = renamedBob(before, 'Bobby');
      await expect.poll(() => readCode(frame), { timeout: TIMEOUTS.FRAME_LOAD }).toBe(expected);
      expect(expected).toMatch(/^\s*participant Bobby$/m);
      expect(expected).toContain('Alice->>Bobby: Hi');
      await expect(editLayer(frame)).toHaveCount(0, { timeout: TIMEOUTS.FRAME_LOAD });
      await expect(actorLabel(frame, 'Bob')).toHaveCount(0);
    });
  });

  test('edit a message text in place: only that message line changes', async ({ page }) => {
    const { frame, before } = await setupSequence(page, 'Mermaid Inline Message');

    await test.step('Double-click Hi and replace the text', async () => {
      await openLayerOn(page, frame, messageLabel(frame, 'Hi'), 'Edit message text');
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('Hello there');
      await expect(messageLabel(frame, 'Hello there').first()).toBeAttached({ timeout: TIMEOUTS.FRAME_LOAD });
      expect(await readCode(frame)).toBe(before);
    });

    await test.step('Enter writes only the message line', async () => {
      await page.keyboard.press('Enter');
      const expected = before.replace('Alice->>Bob: Hi', 'Alice->>Bob: Hello there');
      await expect.poll(() => readCode(frame), { timeout: TIMEOUTS.FRAME_LOAD }).toBe(expected);
      const beforeLines = before.split('\n');
      const afterLines = expected.split('\n');
      const changed = afterLines.filter((line, i) => line !== beforeLines[i]);
      expect(changed).toHaveLength(1);
      expect(changed[0]).toMatch(/^\s*Alice->>Bob: Hello there$/);
      await expect(editLayer(frame)).toHaveCount(0, { timeout: TIMEOUTS.FRAME_LOAD });
    });
  });

  test('Esc cancels the edit: code unchanged, no layer left', async ({ page }) => {
    const { frame, before } = await setupSequence(page, 'Mermaid Inline Cancel');

    await test.step('Start a rename', async () => {
      await openLayerOn(page, frame, actorLabel(frame, 'Bob'), 'Edit participant name');
      await page.keyboard.press('End');
      await page.keyboard.type('Cancelled');
      await expect(actorLabel(frame, 'BobCancelled').first()).toBeAttached({ timeout: TIMEOUTS.FRAME_LOAD });
    });

    await test.step('Esc restores the stored picture and writes nothing', async () => {
      await page.keyboard.press('Escape');
      await expect(editLayer(frame)).toHaveCount(0, { timeout: TIMEOUTS.FRAME_LOAD });
      // Not verified before this spec (feature doc, "Not verified"): the
      // Confluence host must not close the editor modal on this Esc.
      await expect(page.getByTestId('custom-ui-fullscreen-modal-dialog')).toBeVisible();
      await expect(actorLabel(frame, 'Bob').first()).toBeAttached({ timeout: TIMEOUTS.FRAME_LOAD });
      await expect(actorLabel(frame, 'BobCancelled')).toHaveCount(0);
      expect(await readCode(frame)).toBe(before);
    });
  });

  test('a duplicate participant name is refused with a hint', async ({ page }) => {
    const { frame, before } = await setupSequence(page, 'Mermaid Inline Duplicate');

    let layer: Locator;
    await test.step('Rename Bob to Alice', async () => {
      layer = await openLayerOn(page, frame, actorLabel(frame, 'Bob'), 'Edit participant name');
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('Alice');
      await expect(frame.getByTestId('mermaid-inline-edit-hint')).toHaveText(NAME_EXISTS_HINT, { timeout: TIMEOUTS.BUTTON_VISIBLE });
      await expect(layer).toHaveAttribute('aria-invalid', 'true');
    });

    await test.step('Enter keeps editing and writes nothing', async () => {
      await page.keyboard.press('Enter');
      // Negative case: there is no change to wait for. Give a wrong write
      // (store -> CodeMirror) time to land before checking that none did.
      await page.waitForTimeout(1500);
      await expect(layer!).toHaveCount(1);
      await expect(layer!).toHaveAttribute('aria-invalid', 'true');
      expect(await readCode(frame)).toBe(before);
    });

    await test.step('Esc closes the layer; code still unchanged', async () => {
      await page.keyboard.press('Escape');
      await expect(editLayer(frame)).toHaveCount(0, { timeout: TIMEOUTS.FRAME_LOAD });
      await expect(frame.getByTestId('mermaid-inline-edit-hint')).toHaveCount(0);
      await expect(page.getByTestId('custom-ui-fullscreen-modal-dialog')).toBeVisible();
      expect(await readCode(frame)).toBe(before);
    });
  });

  test('after publish the viewer shows the rename and offers no inline edit', async ({ page }) => {
    const { editorPage, frame, before } = await setupSequence(page, 'Mermaid Inline Publish');

    await test.step('Rename Bob to Bobby in place', async () => {
      await openLayerOn(page, frame, actorLabel(frame, 'Bob'), 'Edit participant name');
      await page.keyboard.press('End');
      await page.keyboard.type('by');
      await page.keyboard.press('Enter');
      await expect.poll(() => readCode(frame), { timeout: TIMEOUTS.FRAME_LOAD }).toBe(renamedBob(before, 'Bobby'));
      await expect(editLayer(frame)).toHaveCount(0, { timeout: TIMEOUTS.FRAME_LOAD });
    });

    await test.step('Publish the macro and the page', async () => {
      // Tab is already Mermaid; this fills the title, clicks Publish and waits for the modal to close.
      await editorPage.interactWithDiagramMacro(`Mermaid Inline Edit ${Date.now()}`);
      await editorPage.publishPage();
    });

    const macroPage = new MacroPage(page);
    await macroPage.dismissSpotlightModal();
    const viewer = macroPage.getSequenceMacroFrame();

    await test.step('Viewer renders the renamed participant', async () => {
      const bobby = viewer.locator('svg text.actor').filter({ hasText: exact('Bobby') });
      await expect(bobby.first()).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
      await expect(viewer.locator('svg text.actor').filter({ hasText: exact('Bob') })).toHaveCount(0);
    });

    await test.step('Double-click in the viewer opens no edit layer', async () => {
      await expect(viewer.locator('.mie-enabled')).toHaveCount(0);
      await viewer.locator('svg text.actor').filter({ hasText: exact('Bobby') }).first().dblclick();
      // Negative case: give a layer time to appear before checking that none did.
      await page.waitForTimeout(1500);
      await expect(viewer.locator('div.mie-layer')).toHaveCount(0);
    });
  });
});
