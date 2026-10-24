import { Page, expect } from '@playwright/test';
import { TIMEOUTS } from '../config/test-config.js';
import { ConfluenceEditorPage } from '../pages/EditorPage.js';
import { dismissStarterGalleryIfPresent } from './starterGallery.js';

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
    // A brand-new sequence/mermaid/plantuml macro auto-opens the starter
    // gallery on mount (Header.vue, "auto_first_open") — callers immediately
    // click into CodeMirror (enterCodeInEditor), which the gallery's backdrop
    // would otherwise intercept.
    await dismissStarterGalleryIfPresent(this.page, this.editorPage.getMacroEditorFrame());
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

}
