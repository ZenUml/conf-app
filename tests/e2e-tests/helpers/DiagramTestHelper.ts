import { Page, expect } from '@playwright/test';
import { TIMEOUTS } from '../config/test-config.js';
import { ConfluenceEditorPage } from '../pages/EditorPage.js';

/**
 * Helper class for diagram-related tests (AI Repair and Syntax Validation)
 * 
 * Provides common functionality for:
 * - Code editor interactions (CodeMirror and ACE)
 * - Error validation
 * - AI Repair feature
 * - Feature flag management
 */
export class DiagramTestHelper {
  constructor(
    protected page: Page,
    protected editorPage: ConfluenceEditorPage
  ) {}

  // ── Page Setup ──

  /**
   * Creates a new page with a Diagram macro
   */
  async createPageWithDiagramMacro(testName: string): Promise<void> {
    console.log('✓ Creating new test page...');
    await this.editorPage.navigateToParentPage();
    await this.editorPage.createChildPage();
    await this.editorPage.typePageTitle(`${testName} ${Date.now()}`);
    await this.editorPage.dismissLearnTheBasicsPanel();

    const macroName = this.editorPage.getMacroName('Diagram (Mermaid, PlantUML & ZenUML)');
    await this.editorPage.clickInsertElements();
    await this.editorPage.searchAndSelectMacro('diagram', macroName);
    console.log(`✓ Macro （${macroName}） inserted, waiting for dialog to load...`);
    await this.page.waitForTimeout(8000);
  }

  /**
   * Creates a new page with an OpenAPI / Swagger macro
   */
  async createPageWithOpenApiMacro(testName: string): Promise<void> {
    console.log('✓ Creating new test page...');
    await this.editorPage.navigateToParentPage();
    await this.editorPage.createChildPage();
    await this.editorPage.typePageTitle(`${testName} ${Date.now()}`);
    await this.editorPage.dismissLearnTheBasicsPanel();

    const macroName = this.editorPage.getMacroName('OpenAPI / Swagger');
    await this.editorPage.clickInsertElements();
    await this.editorPage.searchAndSelectMacro('openapi', macroName);
    console.log(`✓ Macro （${macroName}） inserted, waiting for dialog to load...`);
    await this.page.waitForTimeout(8000);
  }

  // ── Feature Flag Management ──

  /**
   * Enable AI Repair feature by mocking the feature flags API
   */
  async enableAiRepair(): Promise<void> {
    await this.page.route('**/feature-flags?**', async (route: any) => {
      const url = new URL(route.request().url());
      const features = url.searchParams.get('features')?.split(',') || [];
      
      const response: Record<string, { enabled: boolean; reason: string }> = {};
      features.forEach(feature => {
        if (feature === 'AI_TITLE') {
          response[feature] = { enabled: true, reason: 'TEST_OVERRIDE' };
        } else {
          response[feature] = { enabled: false, reason: 'DEFAULT' };
        }
      });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response)
      });
    });
    console.log('✓ AI Repair feature enabled for testing');
  }

  // ── Code Editor Interactions ──

  /**
   * Enter code into the CodeMirror editor (used for ZenUML and Mermaid)
   */
  async enterCodeInEditor(code: string, clearFirst: boolean = true): Promise<void> {
    const frame = this.editorPage.getMacroEditorFrame();
    const editor = frame.locator('.cm-content[contenteditable="true"]').first();
    await editor.click();
    
    if (clearFirst) {
      await this.page.keyboard.press('Control+A');
      await this.page.keyboard.press('Backspace');
      await this.page.waitForTimeout(500);
    }
    
    await editor.pressSequentially(code);
    await this.page.waitForTimeout(2000);
    console.log('✓ Code entered in CodeMirror editor');
  }

  /**
   * Enter PlantUML code into the CodeMirror editor
   * PlantUML has protected first and last lines (@startuml/@enduml)
   * This method only replaces the content between them
   */
  async enterPlantUmlCode(code: string): Promise<void> {
    const frame = this.editorPage.getMacroEditorFrame();
    const editor = frame.locator('.cm-content[contenteditable="true"]').first();
    
    // Extract the content between @startuml and @enduml
    const lines = code.split('\n');
    const startIndex = lines.findIndex(line => line.trim().startsWith('@startuml'));
    const endIndex = lines.findIndex(line => line.trim().startsWith('@enduml'));
    
    if (startIndex === -1 || endIndex === -1) {
      throw new Error('PlantUML code must contain @startuml and @enduml');
    }
    
    // Get the content between the markers
    const contentLines = lines.slice(startIndex + 1, endIndex);
    const content = contentLines.join('\n');
    
    // Click on the editor to focus
    await editor.click();
    await this.page.waitForTimeout(200);
    
    // Select all and delete
    // The readonly filter will preserve @startuml and @enduml automatically
    await this.page.keyboard.press('Control+A');
    await this.page.keyboard.press('Backspace');
    await this.page.waitForTimeout(300);
    
    // After deletion, editor should have:
    // @startuml
    // @enduml
    // But cursor position might not be correct
    
    // Move to the beginning and then to the second line
    await this.page.keyboard.press('Control+Home');
    await this.page.waitForTimeout(100);
    
    // Move down to the second line (after @startuml)
    await this.page.keyboard.press('ArrowDown');
    await this.page.waitForTimeout(100);
    
    // Now cursor is at the beginning of the second line (between @startuml and @enduml)
    // Type the content
    if (content) {
      await editor.pressSequentially(content);
    }
    
    await this.page.waitForTimeout(2000);
    console.log('✓ PlantUML code entered in CodeMirror editor');
  }

  /**
   * Enter code into the ACE editor (used for OpenAPI)
   */
  async enterCodeInAceEditor(code: string, clearFirst: boolean = true): Promise<void> {
    const frame = this.editorPage.getMacroEditorFrame();
    
    // Wait for ACE editor to be ready and click to focus
    const aceContent = frame.locator('.ace_content');
    await aceContent.waitFor({ state: 'visible', timeout: TIMEOUTS.FRAME_LOAD });
    await aceContent.click();
    await this.page.waitForTimeout(500);
    
    const textarea = frame.locator('textarea');
    if (clearFirst) {
      await textarea.press('ControlOrMeta+a');
    }
    await textarea.fill(code);
    await this.page.waitForTimeout(2000);
    console.log('✓ Code entered in ACE editor');
  }

  // ── Error Validation ──

  /**
   * Verify that the error container is visible and contains error text
   */
  async verifyErrorVisible(): Promise<void> {
    const frame = this.editorPage.getMacroEditorFrame();
    const errorContainer = frame.locator('.error-container');
    await expect(errorContainer).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    
    const errorText = frame.locator('output[name="diagram-error"]');
    await expect(errorText).toBeVisible();
    
    const errorContent = await errorText.textContent();
    expect(errorContent).toBeTruthy();
    console.log('✓ Error detected:', errorContent);
  }

  /**
   * Verify that the error container is not visible (error cleared)
   */
  async verifyErrorCleared(): Promise<void> {
    const frame = this.editorPage.getMacroEditorFrame();
    const errorContainer = frame.locator('.error-container');
    await expect(errorContainer).not.toBeVisible({ timeout: 5000 });
    console.log('✓ Error cleared');
  }

  // ── AI Repair Feature ──

  /**
   * Verify AI Repair button is visible and enabled
   */
  async verifyAiRepairButtonVisible(): Promise<void> {
    const frame = this.editorPage.getMacroEditorFrame();
    const aiRepairButton = frame.getByRole('button', { name: /ai repair/i });
    await expect(aiRepairButton).toBeVisible({ timeout: 5000 });
    await expect(aiRepairButton).toBeEnabled();
    console.log('✓ AI Repair button is visible and enabled');
  }

  /**
   * Open the AI Repair dialog and wait for diff view to load
   */
  async openAiRepairDialog(repairTimeout=15000): Promise<void> {
    const frame = this.editorPage.getMacroEditorFrame();
    
    const aiRepairButton = frame.getByRole('button', { name: /ai repair/i });
    await aiRepairButton.click();
    console.log('✓ AI Repair button clicked');
    
    // Wait for AI Repair dialog content to appear
    const aiRepairDialog = frame.getByTestId('ai-repair-dialog-content');
    await expect(aiRepairDialog).toBeVisible({ timeout: 10000 });
    console.log('✓ AI Repair dialog visible');

    // Verify diff view sections appear (wait for API to return)
    const originalSection = frame.getByText('Original');
    const repairedSection = frame.getByText(/Repaired \(Editable\)/);
    await expect(originalSection).toBeVisible({ timeout: repairTimeout });
    await expect(repairedSection).toBeVisible({ timeout: repairTimeout });

    console.log('✓ AI Repair dialog opened with diff view');
  }

  /**
   * Apply the AI repair by clicking the Apply Code button
   */
  async applyAiRepair(): Promise<void> {
    const frame = this.editorPage.getMacroEditorFrame();
    const applyButton = frame.getByRole('button', { name: /apply code/i });
    await expect(applyButton).toBeEnabled({ timeout: 5000 });
    await applyButton.click();
    await this.page.waitForTimeout(2000);
    console.log('✓ AI repair applied');
  }
}
