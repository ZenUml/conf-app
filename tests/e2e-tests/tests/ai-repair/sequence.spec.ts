import { test } from '@playwright/test';
import { ConfluenceEditorPage } from '../../pages/EditorPage.js';
import { DiagramTestHelper } from '../../helpers/DiagramTestHelper.js';

/**
 * AI Repair Feature Tests for ZenUML
 * 
 * Test strategy:
 * - Each test creates a fresh new page with a macro
 * - Tests are independent and isolated
 * - Validates AI Repair functionality for fixing syntax errors
 */

test.describe('AI Repair - ZenUML', () => {
  // Disable retries for this test suite
  //test.describe.configure({ retries: 0 });

  let editorPage: ConfluenceEditorPage;
  let testBase: DiagramTestHelper;

  test.beforeEach(async ({ page }) => {
    editorPage = new ConfluenceEditorPage(page);
    testBase = new DiagramTestHelper(page, editorPage);
    
    // Enable AI Repair BEFORE creating the page
    await testBase.enableAiRepair();
    
    await testBase.createPageWithDiagramMacro('AI Repair Test');
  });

  test('should apply AI repair to fix syntax error', async () => {
    await test.step('Enter invalid ZenUML syntax', async () => {
      // Type invalid syntax (invalid method syntax)
      const invalidCode = `A.-method(）`;
      await testBase.enterCodeInEditor(invalidCode);
      console.log('✓ Invalid syntax entered');
    });

    await test.step('Verify error box and AI Repair button appear', async () => {
      await testBase.verifyErrorVisible();
      await testBase.verifyAiRepairButtonVisible();
    });

    await test.step('Open AI Repair dialog', async () => {
      await testBase.openAiRepairDialog();
    });

    await test.step('Apply AI repair', async () => {
      await testBase.applyAiRepair();
    });

    await test.step('Verify error is cleared after AI repair', async () => {
      await testBase.verifyErrorCleared();
    });
  });
});
