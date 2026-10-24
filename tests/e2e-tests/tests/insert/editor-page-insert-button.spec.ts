import { expect, test } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { ConfluenceEditorPage } from '../../pages/EditorPage.js';

test.use({ storageState: { cookies: [], origins: [] } });

test('selects the modal Insert action when a search result also contains Insert', { tag: ['@test:sequence', '@variant:lite', '@variant:full', '@variant:diagramly', '@editor', '@sequence'] }, async ({ page }) => {
  // Minimal DOM observed in the failed CI trace. It guards our locator adapter
  // against this ambiguity; it does not assert live Atlassian behavior.
  await page.setContent(`
    <section role="dialog" aria-label="Browse">
      <input role="combobox" />
      <button role="option">Diagram (Mermaid, PlantUML &amp; ZenUML) ${testConfig.appLabel}</button>
      <button data-testid="element-item-2" aria-describedby="draw.io Diagram">
        <span>draw.io Diagram</span>
        <span>Inserts a new draw.io diagram</span>
      </button>
      <button data-testid="ModalElementBrowser__insert-button">Insert</button>
    </section>
    <script>
      document.querySelector('[role="option"]').addEventListener('click', event => {
        event.currentTarget.setAttribute('aria-selected', 'true');
      });
      document.querySelector('[data-testid="ModalElementBrowser__insert-button"]').addEventListener('click', () => {
        document.querySelector('[role="dialog"]').remove();
      });
    </script>
  `);

  const editorPage = new ConfluenceEditorPage(page);
  await editorPage.searchAndSelectMacro('diagram', 'Diagram (Mermaid, PlantUML & ZenUML)');

  await expect(page.getByRole('dialog', { name: 'Browse' })).toBeHidden();
});
