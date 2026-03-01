import { Page, FrameLocator, expect } from '@playwright/test';
import { testConfig, TIMEOUTS } from '../config/test-config.js';

export class MacroPage {
  constructor(private page: Page) {}

  private getModuleKeySuffix(): string {
    return testConfig.isLite ? '-lite' : '';
  }

  // NOTE: For Forge mode, all frame getters return the same selector because Forge
  // extension containers don't include macro-type identifiers. This works for diagram
  // tests (one macro per page) but NOT for pages with multiple macros. The smoke test
  // uses count-based verification (toHaveCount(4)) instead of individual frame getters.
  getSequenceMacroFrame(): FrameLocator {
    return this.page.frameLocator(testConfig.isForge ? `[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]` : `iframe[id*="zenuml-sequence-macro${this.getModuleKeySuffix()}"]`);
  }

  getGraphMacroFrame(): FrameLocator {
    return this.page.frameLocator(testConfig.isForge ? `[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]` : `iframe[id*="zenuml-graph-macro${this.getModuleKeySuffix()}"]`);
  }

  getOpenApiMacroFrame(): FrameLocator {
    return this.page.frameLocator(testConfig.isForge ? `[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]` : `iframe[id*="zenuml-openapi-macro${this.getModuleKeySuffix()}"]`);
  }

  getEmbedMacroFrame(): FrameLocator {
    return this.page.frameLocator(testConfig.isForge ? `[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]` : `iframe[id*="zenuml-embed-macro${this.getModuleKeySuffix()}"]`);
  }

  getEditorDialogFrame(): FrameLocator {
    return this.page.frameLocator(testConfig.isForge ? '[data-testid="custom-ui-modal-dialog"] [data-testid="hosted-resources-iframe"]' : '[role="dialog"] iframe');
  }

  async dismissSpotlightModal(): Promise<void> {
    const modal = this.page.locator('[data-testid="spotlight--dialog-container"]');

    if (await modal.isVisible({ timeout: TIMEOUTS.MODAL_DISMISS }).catch(() => false)) {
      await modal.locator('button').filter({ hasText: 'Dismiss' }).click();
      await modal.waitFor({ state: 'detached', timeout: TIMEOUTS.MODAL_DISMISS });
    }
  }

  async assertMacroContent(frame: FrameLocator, expectedText: string): Promise<void> {
    // Wait for frame to load and content to be visible
    await expect(frame.locator('body')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await expect(frame.getByText(expectedText, { exact: false })).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
  }

  async editMacro(macroFrame: FrameLocator): Promise<void> {
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
