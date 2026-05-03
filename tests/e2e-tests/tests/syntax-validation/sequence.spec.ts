import { test, expect } from '@playwright/test';
import { ConfluenceEditorPage } from '../../pages/EditorPage.js';
import { DiagramTestHelper } from '../../helpers/DiagramTestHelper.js';

/**
 * ZenUML Syntax Error Detection Tests
 * 
 * Test strategy:
 * - Each test creates a fresh new page with a macro
 * - Tests are independent and isolated
 * - Validates error detection and error clearing for ZenUML diagrams
 */

test.describe('ZenUML Syntax Error Detection', () => {
  // Disable retries for this test suite
  //test.describe.configure({ retries: 0 });

  let editorPage: ConfluenceEditorPage;
  let testBase: DiagramTestHelper;

  test.beforeEach(async ({ page }) => {
    editorPage = new ConfluenceEditorPage(page);
    testBase = new DiagramTestHelper(page, editorPage);
    
    await testBase.createPageWithDiagramMacro('ZenUML Test');
  });

  test('should detect syntax error in ZenUML sequence diagram', async ({ page }) => {
    await test.step('Enter invalid ZenUML syntax', async () => {
      // Type invalid syntax (invalid method syntax)
      const invalidCode = `A.-method(）`;
      await testBase.enterCodeInEditor(invalidCode);
    });

    await test.step('Verify error box appears', async () => {
      await testBase.verifyErrorVisible();
    });

    await test.step('Correct the syntax', async () => {
      const validCode = `A.method()`;
      await testBase.enterCodeInEditor(validCode);
      console.log('✓ Valid ZenUML syntax entered');
    });

    await test.step('Verify error is cleared', async () => {
      await testBase.verifyErrorCleared();
    });
  });
});
