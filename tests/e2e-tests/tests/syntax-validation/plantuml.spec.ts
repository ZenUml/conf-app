import { test, expect } from '@playwright/test';
import { ConfluenceEditorPage } from '../../pages/EditorPage.js';
import { DiagramTestHelper } from '../../helpers/DiagramTestHelper.js';

/**
 * PlantUML Syntax Error Detection Tests
 * 
 * Test strategy:
 * - Each test creates a fresh new page with a macro
 * - Tests are independent and isolated
 * - Validates error detection and error clearing for PlantUML diagrams
 */

test.describe('PlantUML Syntax Error Detection', () => {
  // Disable retries for this test suite
  //test.describe.configure({ retries: 0 });

  let editorPage: ConfluenceEditorPage;
  let testBase: DiagramTestHelper;

  test.beforeEach(async ({ page }) => {
    editorPage = new ConfluenceEditorPage(page);
    testBase = new DiagramTestHelper(page, editorPage);
    
    await testBase.createPageWithDiagramMacro('PlantUML Test');
  });

  test('should detect syntax error in PlantUML diagram - invalid arrow syntax', async ({ page }) => {
    await test.step('Switch to PlantUML tab and enter invalid syntax', async () => {
      await editorPage.switchToMacroTab('PlantUML');
      
      // Invalid PlantUML syntax (invalid arrow -1>)
      const invalidCode = `@startuml\nAlice -1> Bob: Hello\n@enduml`;
      await testBase.enterPlantUmlCode(invalidCode);
    });

    await test.step('Verify error box appears', async () => {
      await testBase.verifyErrorVisible();
    });

    await test.step('Correct the syntax', async () => {
      const validCode = `@startuml\nAlice -> Bob: Hello\n@enduml`;
      await testBase.enterPlantUmlCode(validCode);
      console.log('✓ Valid PlantUML syntax entered');
    });

    await test.step('Verify error is cleared', async () => {
      await testBase.verifyErrorCleared();
    });
  });
});
