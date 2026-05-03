import { test } from '@playwright/test';
import { ConfluenceEditorPage } from '../../pages/EditorPage.js';
import { DiagramTestHelper } from '../../helpers/DiagramTestHelper.js';

/**
 * AI Repair Feature Tests for PlantUML
 * 
 * Test strategy:
 * - Each test creates a fresh new page with a macro
 * - Tests are independent and isolated
 * - Validates AI Repair functionality for fixing syntax errors
 */

test.describe('AI Repair - PlantUML', () => {
  let editorPage: ConfluenceEditorPage;
  let testBase: DiagramTestHelper;

  test.beforeEach(async ({ page }) => {
    editorPage = new ConfluenceEditorPage(page);
    testBase = new DiagramTestHelper(page, editorPage);
    
    // Enable AI Repair BEFORE creating the page
    await testBase.enableAiRepair();
    
    await testBase.createPageWithDiagramMacro('AI Repair PlantUML Test');
    
    // Close GenerationPrompt if it appears
    await editorPage.closeGenerationPromptIfVisible();
  });

  test('should apply AI repair to fix PlantUML syntax error', async () => {
    await test.step('Switch to PlantUML tab and enter invalid syntax', async () => {
      await editorPage.switchToMacroTab('PlantUML');
      
      // Invalid PlantUML syntax (invalid arrow -1>)
      const invalidCode = `@startuml\nAlice -1> Bob: Hello\n@enduml`;
      await testBase.enterCodeInEditor(invalidCode);
      console.log('✓ Invalid PlantUML syntax entered');
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
