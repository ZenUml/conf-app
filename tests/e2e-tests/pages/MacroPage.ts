import { Page, Locator, expect } from '@playwright/test';
import { testConfig, TIMEOUTS } from '../config/test-config.js';

export class MacroPage {
  constructor(private page: Page) {}

  private getModuleKeySuffix(): string {
    return testConfig.isLite ? '-lite' : '';
  }

  getSequenceMacroFrame(): Locator {
    return this.page.frameLocator(testConfig.isForge ? `[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]` : `iframe[id*="zenuml-sequence-macro${this.getModuleKeySuffix()}"]`);
  }

  getGraphMacroFrame(): Locator {
    return this.page.frameLocator(testConfig.isForge ? `[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]` : `iframe[id*="zenuml-graph-macro${this.getModuleKeySuffix()}"]`);
  }

  getOpenApiMacroFrame(): Locator {
    return this.page.frameLocator(testConfig.isForge ? `[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]` : `iframe[id*="zenuml-openapi-macro${this.getModuleKeySuffix()}"]`);
  }

  getEmbedMacroFrame(): Locator {
    return this.page.frameLocator(testConfig.isForge ? `[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]` : `iframe[id*="zenuml-embed-macro${this.getModuleKeySuffix()}"]`);
  }

  getEditorDialogFrame(): Locator {
    return this.page.frameLocator(testConfig.isForge ? '[data-testid="custom-ui-modal-dialog"] [data-testid="hosted-resources-iframe"]' : 'iframe[id*="editor-dialog"]');
  }

  async dismissSpotlightModal(): Promise<void> {
    const modal = this.page.locator('[data-testid="spotlight--dialog-container"]');

    if (await modal.isVisible({ timeout: TIMEOUTS.MODAL_DISMISS }).catch(() => false)) {
      await modal.locator('button').filter({ hasText: 'Dismiss' }).click();
      await modal.waitFor({ state: 'detached', timeout: TIMEOUTS.MODAL_DISMISS });
    }
  }

  async assertMacroContent(frame: Locator, expectedText: string): Promise<void> {
    // Wait for frame to load and content to be visible
    await expect(frame.locator('body')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await expect(frame.getByText(expectedText, { exact: false })).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
  }

  async editMacro(macroFrame: Locator): Promise<void> {
    // Wait for frame to fully load
    await expect(macroFrame.locator('body')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });

    // Use aria-label to find the Edit button
    const editButton = macroFrame.getByRole('button', { name: 'Edit' });

    await expect(editButton).toBeVisible({ timeout: TIMEOUTS.BUTTON_VISIBLE });
    await editButton.click();
  }

  async saveInEditor(): Promise<void> {
    const editorFrame = this.getEditorDialogFrame();
    // Use more specific button selection - look for the save/publish button
    const saveButton = editorFrame.getByRole('button', { name: /publish|save/i }).first();
    await expect(saveButton).toBeVisible({ timeout: TIMEOUTS.BUTTON_VISIBLE });
    await saveButton.click();
  }
}
