import { test, expect } from '@playwright/test';
import { ConfluenceEditorPage } from '../../pages/EditorPage.js';
import { DiagramTestHelper } from '../../helpers/DiagramTestHelper.js';

/**
 * Mermaid Syntax Error Detection Tests
 * 
 * Test strategy:
 * - Each test creates a fresh new page with a macro
 * - Tests are independent and isolated
 * - Validates error detection and error clearing for Mermaid diagrams
 */

test.describe('Mermaid Syntax Error Detection', () => {
  // Disable retries for this test suite
  //test.describe.configure({ retries: 0 });

  let editorPage: ConfluenceEditorPage;
  let testBase: DiagramTestHelper;

  test.beforeEach(async ({ page }) => {
    editorPage = new ConfluenceEditorPage(page);
    testBase = new DiagramTestHelper(page, editorPage);
    
    await testBase.createPageWithDiagramMacro('Mermaid Test');
  });

  test('should detect syntax error in Mermaid diagram', async ({ page }) => {
    await test.step('Switch to Mermaid tab and enter invalid syntax', async () => {
      await editorPage.switchToMacroTab('Mermaid');
      
      // Invalid Mermaid syntax (missing arrow between nodes)
      const invalidCode = `graph TD\n  A B`;
      await testBase.enterCodeInEditor(invalidCode);
    });

    await test.step('Verify error box appears', async () => {
      await testBase.verifyErrorVisible();
    });

    await test.step('Correct the syntax', async () => {
      const validCode = `graph TD\n  A --> B`;
      await testBase.enterCodeInEditor(validCode);
      console.log('✓ Valid Mermaid syntax entered');
    });

    await test.step('Verify error is cleared', async () => {
      await testBase.verifyErrorCleared();
    });
  });
});
