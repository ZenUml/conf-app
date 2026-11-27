import { test, expect } from '../../fixtures/mixpanel-test.js';
import type { FrameLocator, Locator, Page } from '@playwright/test';
import { testConfig, TIMEOUTS } from '../../config/test-config.js';
import { ConfluenceEditorPage } from '../../pages/EditorPage.js';
import { MacroPage } from '../../pages/MacroPage.js';
import { DiagramTestHelper } from '../../helpers/DiagramTestHelper.js';

/**
 * Mermaid inline edit, sequence and flowchart (docs/features/mermaid-inline-edit.md,
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

async function expectRingOn(ring: Locator, target: Locator, other: Locator): Promise<void> {
  await expect.poll(async () => {
    const [outline, expected, unexpected] = await Promise.all([
      ring.boundingBox(), target.boundingBox(), other.boundingBox(),
    ]);
    if (!outline || !expected || !unexpected) return false;
    const x = outline.x + outline.width / 2;
    const y = outline.y + outline.height / 2;
    const contains = (box: typeof outline) =>
      x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height;
    return contains(expected) && !contains(unexpected);
  }).toBe(true);
}

/**
 * The controller adds `mie-enabled` to the Mermaid container only when the
 * three-way equality holds (rendered code = source map = store) and no layer
 * is open. Waiting for it replaces a sleep before every double-click.
 */
async function waitEditable(frame: FrameLocator): Promise<void> {
  await expect(frame.locator('.mie-enabled').first()).toBeAttached({ timeout: TIMEOUTS.FRAME_LOAD });
}

async function setupSequence(page: Page, testName: string, source = SOURCE) {
  const editorPage = new ConfluenceEditorPage(page);
  const helper = new DiagramTestHelper(page, editorPage);
  await helper.createPageWithDiagramMacro(testName);
  await editorPage.switchToMacroTab('Mermaid');
  await helper.enterCodeInEditor(source);
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

// Each test builds its own page, so the planner may place tests of this
// file on different shards (scripts/test-selection/plan.mjs splits a
// file per test only when it declares parallel mode).
test.describe.configure({ mode: 'parallel' });

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

  test('select the second of two equal source labels, then type and edit it in the diagram', async ({ page }) => {
    const { frame, before } = await setupSequence(page, 'Mermaid Source Selection', SOURCE + '\n\n  Alice->>Bob: Hi');
    const editor = frame.locator('.cm-content[contenteditable="true"]').first();
    const ring = frame.getByTestId('mermaid-source-selection-ring');
    const hint = frame.getByTestId('mermaid-source-selection-hint');
    const duplicate = messageLabel(frame, 'Hi');
    await expect(duplicate).toHaveCount(2, { timeout: TIMEOUTS.FRAME_LOAD });

    await test.step('Move a collapsed caret between equal labels and through a blank line', async () => {
      await editor.locator('.cm-line').last().click();
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowLeft');
      await expectRingOn(ring, duplicate.last(), duplicate.first());
      await expect(hint).toHaveCount(0);
      await expect(editor).toBeFocused();
      expect(await editor.evaluate(element => element.ownerDocument.getSelection()?.isCollapsed)).toBe(true);

      await page.keyboard.press('ArrowUp');
      await expect(ring).toHaveCount(0);
      await page.keyboard.press('ArrowUp');
      await expectRingOn(ring, duplicate.first(), duplicate.last());
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await expectRingOn(ring, duplicate.last(), duplicate.first());
    });

    await test.step('Type at the caret and keep the ring on the edited label', async () => {
      await page.keyboard.insertText('e');
      const edited = messageLabel(frame, 'Hei');
      await expect(edited).toBeAttached({ timeout: TIMEOUTS.FRAME_LOAD });
      await expectRingOn(ring, edited, duplicate.first());
      await expect(hint).toHaveCount(0);
      await expect(editor).toBeFocused();
      await page.keyboard.press('Backspace');
      await expect(duplicate).toHaveCount(2, { timeout: TIMEOUTS.FRAME_LOAD });
      await expectRingOn(ring, duplicate.last(), duplicate.first());
      expect(await readCode(frame)).toBe(before);
    });

    await test.step('Select the second source label with the keyboard and verify its exact preview target', async () => {
      await editor.locator('.cm-line').last().click();
      await page.keyboard.press('End');
      await page.keyboard.press('Shift+ArrowLeft');
      await page.keyboard.press('Shift+ArrowLeft');
      await expect(hint).toHaveText('You can also double-click here to edit.');
      await expect(hint).toBeVisible();
      await expect(editor).toBeFocused();
      await expectRingOn(ring, duplicate.last(), duplicate.first());
    });

    const updated = before.slice(0, before.lastIndexOf('Hi')) + 'Updated';
    await test.step('Type in the focused source editor and clear the hint with a multiline selection', async () => {
      await page.keyboard.insertText('Updated');
      await expect.poll(() => readCode(frame)).toBe(updated);
      await expect(editor).toBeFocused();
      await expect(messageLabel(frame, 'Hi')).toHaveCount(1, { timeout: TIMEOUTS.FRAME_LOAD });
      await expect(messageLabel(frame, 'Updated')).toHaveCount(1);
      await expect(ring).toBeVisible();
      await expect(hint).toHaveCount(0);
      await page.keyboard.press('Shift+ArrowUp');
      await expect(ring).toHaveCount(0);
    });

    await test.step('Reselect the label and double-click the highlighted text to enter inline edit', async () => {
      await editor.locator('.cm-line').last().click();
      await page.keyboard.press('End');
      for (const _ of 'Updated') await page.keyboard.press('Shift+ArrowLeft');
      await expect(hint).toBeVisible();
      const layer = await openLayerOn(page, frame, messageLabel(frame, 'Updated'), 'Edit message text');
      await expect(layer).toHaveText('Updated');
      await expect(ring).toHaveCount(0);
      await expect(hint).toHaveCount(0);
      await page.keyboard.press('End');
      await page.keyboard.type(' again');
      await page.keyboard.press('Enter');
      await expect.poll(() => readCode(frame), { timeout: TIMEOUTS.FRAME_LOAD }).toBe(updated + ' again');
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

const FLOW_SOURCE = 'flowchart LR\n  A[Start] -->|yes| B(Round)\n  B --> C';
const FLOW_DUPLICATES = 'flowchart LR\n  A[Start]\n  B[Start]\n  A -->|yes| B\n  B --> C';

/** A rendered flowchart node label (HTML in a foreignObject) in the editor preview. */
function nodeLabel(frame: FrameLocator, text: string): Locator {
  return frame.locator('.diagram-viewport-content svg g.node span.nodeLabel').filter({ hasText: exact(text) });
}

/** A rendered flowchart edge label in the editor preview. */
function edgeLabel(frame: FrameLocator, text: string): Locator {
  return frame.locator('.diagram-viewport-content svg g.edgeLabel span.edgeLabel').filter({ hasText: exact(text) });
}

async function setupFlowchart(page: Page, testName: string, source = FLOW_SOURCE) {
  const editorPage = new ConfluenceEditorPage(page);
  const helper = new DiagramTestHelper(page, editorPage);
  await helper.createPageWithDiagramMacro(testName);
  await editorPage.switchToMacroTab('Mermaid');
  await helper.enterCodeInEditor(source);
  const frame = editorPage.getMacroEditorFrame();
  await waitEditable(frame);
  await expect(nodeLabel(frame, 'Start').first()).toBeAttached({ timeout: TIMEOUTS.FRAME_LOAD });
  const before = await readCode(frame);
  expect(before).toContain(source.split('\n')[1].trim());
  expect(before).toMatch(/^\s*B --> C$/m);
  console.log(`  ✓ Source in editor:\n${before}`);
  return { frame, before };
}

test.describe('Mermaid flowchart inline edit', { tag: ['@test:mermaid', '@variant:lite', '@variant:full', '@variant:diagramly', '@editor', '@mermaid', '@feature:editing', '@interface:editor', '@scenario:editing:editor'] }, () => {
  test.skip(skip, `Macro "${macroType}" not in app profile [${testConfig.macros.join(', ')}]`);

  test('edit a node label in place: live preview, source written once on Enter', async ({ page }) => {
    const { frame, before } = await setupFlowchart(page, 'Mermaid Flow Inline Node', FLOW_DUPLICATES);
    const labels = nodeLabel(frame, 'Start');
    const ring = frame.getByTestId('mermaid-source-selection-ring');
    const editor = frame.locator('.cm-content[contenteditable="true"]').first();
    const labelFor = (id: string) => frame.locator(`svg g.node[id*="-flowchart-${id}-"] span.nodeLabel`);
    await expect(labels).toHaveCount(2);

    await test.step('Click identical source labels and highlight their respective nodes without selecting text', async () => {
      for (const [id, otherId] of [['B', 'A'], ['A', 'B']]) {
        const line = editor.locator('.cm-line').filter({ hasText: `${id}[Start]` });
        const position = await line.evaluate(element => {
          const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          let offset = element.textContent!.indexOf('Start') + 2;
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const length = node.textContent!.length;
            if (offset < length) {
              const range = element.ownerDocument.createRange();
              range.setStart(node, offset);
              range.setEnd(node, offset + 1);
              const char = range.getBoundingClientRect();
              const line = element.getBoundingClientRect();
              return { x: char.left - line.left + char.width / 2, y: char.top - line.top + char.height / 2 };
            }
            offset -= length;
          }
          throw new Error('Flowchart source label is missing');
        });
        await line.click({ position });
        await expectRingOn(ring, labelFor(id), labelFor(otherId));
        await expect(editor).toBeFocused();
        expect(await editor.evaluate(element => element.ownerDocument.getSelection()?.isCollapsed)).toBe(true);
        await expect(frame.getByTestId('mermaid-source-selection-hint')).toHaveCount(0);
      }
    });

    await test.step('Double-click Start and replace the text', async () => {
      await openLayerOn(page, frame, labelFor('A'), 'Edit node label');
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('Begin here');
      await expect(nodeLabel(frame, 'Begin here').first()).toBeAttached({ timeout: TIMEOUTS.FRAME_LOAD });
      expect(await readCode(frame)).toBe(before);
    });

    await test.step('Enter writes only the label', async () => {
      await page.keyboard.press('Enter');
      const expected = before.replace('A[Start]', 'A[Begin here]');
      await expect.poll(() => readCode(frame), { timeout: TIMEOUTS.FRAME_LOAD }).toBe(expected);
      await expect(editLayer(frame)).toHaveCount(0, { timeout: TIMEOUTS.FRAME_LOAD });
      await expect(nodeLabel(frame, 'Begin here').first()).toBeAttached();
      await expect(labels).toHaveCount(1);
    });
  });

  test('edit an edge label in place: the pipe form stays', async ({ page }) => {
    const { frame, before } = await setupFlowchart(page, 'Mermaid Flow Inline Edge');

    await test.step('Double-click yes and replace the text', async () => {
      await openLayerOn(page, frame, edgeLabel(frame, 'yes'), 'Edit edge label');
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('confirmed');
      await expect(edgeLabel(frame, 'confirmed').first()).toBeAttached({ timeout: TIMEOUTS.FRAME_LOAD });
    });

    await test.step('Enter writes the edge text', async () => {
      await page.keyboard.press('Enter');
      await expect.poll(() => readCode(frame), { timeout: TIMEOUTS.FRAME_LOAD }).toBe(before.replace('-->|yes|', '-->|confirmed|'));
      await expect(editLayer(frame)).toHaveCount(0, { timeout: TIMEOUTS.FRAME_LOAD });
    });
  });

  test('a node that shows its id gets a label: C becomes C[text]', async ({ page }) => {
    const { frame, before } = await setupFlowchart(page, 'Mermaid Flow Inline Bare Id');

    await test.step('Double-click C and type a label', async () => {
      await openLayerOn(page, frame, nodeLabel(frame, 'C'), 'Edit node label');
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('Done');
      await expect(nodeLabel(frame, 'Done').first()).toBeAttached({ timeout: TIMEOUTS.FRAME_LOAD });
    });

    await test.step('Enter inserts [Done] after the id', async () => {
      await page.keyboard.press('Enter');
      const expected = before.replace(/^(\s*B --> C)$/m, '$1[Done]');
      expect(expected).not.toBe(before);
      await expect.poll(() => readCode(frame), { timeout: TIMEOUTS.FRAME_LOAD }).toBe(expected);
    });
  });

  test('Esc cancels a flowchart edit: code unchanged, no layer left', async ({ page }) => {
    const { frame, before } = await setupFlowchart(page, 'Mermaid Flow Inline Cancel');

    await test.step('Start editing Round', async () => {
      await openLayerOn(page, frame, nodeLabel(frame, 'Round'), 'Edit node label');
      await page.keyboard.press('End');
      await page.keyboard.type(' trip');
      await expect(nodeLabel(frame, 'Round trip').first()).toBeAttached({ timeout: TIMEOUTS.FRAME_LOAD });
    });

    await test.step('Esc restores the stored picture and writes nothing', async () => {
      await page.keyboard.press('Escape');
      await expect(editLayer(frame)).toHaveCount(0, { timeout: TIMEOUTS.FRAME_LOAD });
      await expect(page.getByTestId('custom-ui-fullscreen-modal-dialog')).toBeVisible();
      await expect(nodeLabel(frame, 'Round').first()).toBeAttached({ timeout: TIMEOUTS.FRAME_LOAD });
      await expect(nodeLabel(frame, 'Round trip')).toHaveCount(0);
      expect(await readCode(frame)).toBe(before);
    });
  });
});
