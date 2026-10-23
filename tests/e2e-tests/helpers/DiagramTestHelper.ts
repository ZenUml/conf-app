import { Page, expect } from '@playwright/test';
import { TIMEOUTS } from '../config/test-config.js';
import { ConfluenceEditorPage } from '../pages/EditorPage.js';
import { dismissStarterGalleryIfPresent } from './starterGallery.js';

// Fixed sleeps kept because no observable state exists for them (#944).
/** The app validates code after a debounce, and valid and invalid code settle differently, so no single state marks "done". */
const VALIDATION_SETTLE_MS = 2000;
/** CodeMirror/ACE expose no "editor focused and ready for keys" signal after a click or Ctrl+A + Backspace. */
const EDITOR_CLEAR_SETTLE_MS = 500;
/** Same as above, shorter pause used by the PlantUML flow after click. */
const EDITOR_CLICK_SETTLE_MS = 200;
/** Same as above, pause after select-all + delete in the PlantUML flow. */
const EDITOR_DELETE_SETTLE_MS = 300;
/** Pacing between single key presses (Control+Home, ArrowDown) inside the editor iframe; no keystroke-applied signal. */
const EDITOR_KEY_PACING_MS = 100;

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
    // Wait for the macro editor's CodeMirror to mount (replaces a fixed 8 s sleep).
    // Every diagram macro type (sequence/mermaid/plantuml) renders CodeMirror, and
    // callers click into it straight after this method returns.
    await this.editorPage.getMacroEditorFrame()
      .locator('.cm-content[contenteditable="true"]').first()
      .waitFor({ state: 'visible', timeout: TIMEOUTS.FRAME_LOAD });
    // A brand-new sequence/mermaid/plantuml macro auto-opens the starter
    // gallery on mount (Header.vue, "auto_first_open") — callers immediately
    // click into CodeMirror (enterCodeInEditor), which the gallery's backdrop
    // would otherwise intercept.
    // appearTimeout is raised from the 4 s default because the 8 s sleep that used to
    // precede this call also gave the gallery time to mount after the editor did.
    await dismissStarterGalleryIfPresent(this.page, this.editorPage.getMacroEditorFrame(), { appearTimeout: 8000 });
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
    // Wait for the macro editor iframe to mount (replaces a fixed 8 s sleep). Only
    // the frame body is awaited — the same signal interactWithOpenApiMacro uses —
    // because enterCodeInAceEditor waits for the ACE editor itself.
    await expect(this.editorPage.getMacroEditorFrame().locator('body'))
      .toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
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
      await this.page.waitForTimeout(EDITOR_CLEAR_SETTLE_MS);
    }
    
    await editor.pressSequentially(code);
    await this.page.waitForTimeout(VALIDATION_SETTLE_MS);
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
    await this.page.waitForTimeout(EDITOR_CLICK_SETTLE_MS);
    
    // Select all and delete
    // The readonly filter will preserve @startuml and @enduml automatically
    await this.page.keyboard.press('Control+A');
    await this.page.keyboard.press('Backspace');
    await this.page.waitForTimeout(EDITOR_DELETE_SETTLE_MS);
    
    // After deletion, editor should have:
    // @startuml
    // @enduml
    // But cursor position might not be correct
    
    // Move to the beginning and then to the second line
    await this.page.keyboard.press('Control+Home');
    await this.page.waitForTimeout(EDITOR_KEY_PACING_MS);
    
    // Move down to the second line (after @startuml)
    await this.page.keyboard.press('ArrowDown');
    await this.page.waitForTimeout(EDITOR_KEY_PACING_MS);
    
    // Now cursor is at the beginning of the second line (between @startuml and @enduml)
    // Type the content
    if (content) {
      await editor.pressSequentially(content);
    }
    
    await this.page.waitForTimeout(VALIDATION_SETTLE_MS);
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
    await this.page.waitForTimeout(EDITOR_CLEAR_SETTLE_MS);
    
    const textarea = frame.locator('textarea');
    if (clearFirst) {
      await textarea.press('ControlOrMeta+a');
    }
    await textarea.fill(code);
    await this.page.waitForTimeout(VALIDATION_SETTLE_MS);
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
