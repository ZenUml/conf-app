import { test, expect } from '@playwright/test';
import { ConfluenceEditorPage } from '../../pages/EditorPage.js';
import { DiagramTestHelper } from '../../helpers/DiagramTestHelper.js';

/**
 * OpenAPI Syntax Error Detection Tests
 * 
 * Test strategy:
 * - Each test creates a fresh new page with an OpenAPI macro
 * - Tests are independent and isolated
 * - Validates error detection and error clearing for OpenAPI specifications
 */

test.describe('OpenAPI Syntax Error Detection', () => {
  // Disable retries for this test suite
  //test.describe.configure({ retries: 0 });

  let editorPage: ConfluenceEditorPage;
  let testBase: DiagramTestHelper;

  test.beforeEach(async ({ page }) => {
    editorPage = new ConfluenceEditorPage(page);
    testBase = new DiagramTestHelper(page, editorPage);
    
    await testBase.createPageWithOpenApiMacro('OpenAPI Test');
  });

  test('should detect syntax error in OpenAPI specification', async ({ page }) => {
    await test.step('Enter invalid syntax', async () => {
      const invalidCode = `openapi: 3.0.0
info:
  title: Pet Store API
  version: 1.0.0
paths:
  /pets:
    get:
      summary: List all pets
      parameters:
        - name: limit
          in: query
          schema
            type: integer`;
      await testBase.enterCodeInAceEditor(invalidCode);
    });

    await test.step('Verify error box appears', async () => {
      await testBase.verifyErrorVisible();
    });

    await test.step('Correct the syntax', async () => {
      const validCode = `openapi: 3.0.0
info:
  title: Pet Store API
  version: 1.0.0
paths:
  /pets:
    get:
      summary: List all pets
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
      responses:
        '200':
          description: Success`;
      await testBase.enterCodeInAceEditor(validCode);
      console.log('✓ Valid OpenAPI syntax entered');
    });

    await test.step('Verify error is cleared', async () => {
      await testBase.verifyErrorCleared();
    });
  });
});
