import { test, expect } from '@playwright/test';
import { ConfluenceEditorPage } from '../../pages/EditorPage.js';
import { DiagramTestHelper } from '../../helpers/DiagramTestHelper.js';

/**
 * AI Repair Feature Tests for OpenAPI
 * 
 * Test strategy:
 * - Each test creates a fresh new page with a macro
 * - Tests are independent and isolated
 * - Validates AI Repair functionality for fixing syntax errors
 */

test.describe('AI Repair - OpenAPI', () => {
  // Disable retries for this test suite
  //test.describe.configure({ retries: 0 });

  let editorPage: ConfluenceEditorPage;
  let testBase: DiagramTestHelper;

  test.beforeEach(async ({ page }) => {
    editorPage = new ConfluenceEditorPage(page);
    testBase = new DiagramTestHelper(page, editorPage);
    
    // Enable AI Repair BEFORE creating the page
    await testBase.enableAiRepair();
    
    await testBase.createPageWithOpenApiMacro('AI Repair OpenAPI Test');
  });

  test('should apply AI repair to fix OpenAPI syntax error', async ({ page }) => {
    await test.step('Enter invalid OpenAPI syntax', async () => {
      const invalidCode = `openapi: 3.0.0
info:
  title: User API
  version: 1.0.0
paths:
  /users:
    post:
      summary: Create a user
      requestBody
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string`;
      await testBase.enterCodeInAceEditor(invalidCode);
      console.log('✓ Invalid OpenAPI syntax entered');
    });

    await test.step('Verify error box and AI Repair button appear', async () => {
      await testBase.verifyErrorVisible();
      await testBase.verifyAiRepairButtonVisible();
    });

    await test.step('Open AI Repair dialog', async () => {
      await testBase.openAiRepairDialog();
    });

    await test.step('Apply AI repair', async () => {
      // AI repair may take up to 2 minutes for more complex examples
      await testBase.applyAiRepair();
    });

    await test.step('Verify error is cleared after AI repair', async () => {
      await testBase.verifyErrorCleared();
    });
  });
});
