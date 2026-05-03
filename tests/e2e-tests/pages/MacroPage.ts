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

  async openFullscreen(macroFrame: FrameLocator): Promise<void> {
    await expect(macroFrame.locator('body')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    const fullscreenButton = macroFrame.getByRole('button', { name: 'Fullscreen' });
    await expect(fullscreenButton).toBeVisible({ timeout: TIMEOUTS.BUTTON_VISIBLE });
    await fullscreenButton.click();
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

  /**
   * Edits a Graph (DrawIO) macro from the viewer (published page).
   *
   * Flow:
   * 1. Click the Edit button inside the macro frame
   * 2. Wait for the DrawIO editor modal to open
   * 3. Click Publish in the nested DrawIO iframe to save without changes
   */
  async editGraphMacroFromViewer(macroFrame: FrameLocator): Promise<void> {
    await this.editMacro(macroFrame);

    // Wait for the DrawIO editor to load inside the modal
    await this.page.waitForTimeout(5000);

    if (testConfig.isForge || testConfig.isLite) {
      const modal = this.page.getByTestId('custom-ui-modal-dialog');
      const outerFrame = modal.locator('[data-testid="hosted-resources-iframe"]').contentFrame();

      // If the space hit the macro limit, PageEditorPaywallGate mounts in the
      // outer Forge frame above DrawIO. Click Continue editing to proceed —
      // forgeIndex.ts swaps the gate for Workspace.vue, which renders DrawIO.
      const continueBtn = outerFrame.locator('[data-testid="continue-editing-btn"]');
      try {
        await continueBtn.waitFor({ state: 'visible', timeout: 3000 });
        console.log('  → Paywall gate detected; clicking Continue editing');
        await continueBtn.click();
        await this.page.waitForTimeout(2000);
      } catch {
        // No gate — space is below the macro limit
      }

      const innerFrame = outerFrame.locator('iframe').contentFrame();

      // Add a shape to the canvas to make a real change
      const sidebarShape = innerFrame.locator('.geSidebarContainer a').nth(2);
      try {
        await sidebarShape.click({ timeout: 30000 });
        await this.page.waitForTimeout(1000);
      } catch {
        console.warn('  ⚠ DrawIO sidebar shape not clickable - proceeding without adding shape');
      }

      await innerFrame.locator('button:has-text("Publish")').click({ timeout: TIMEOUTS.BUTTON_VISIBLE });
    } else {
      const outerFrame = this.page.locator('[role="dialog"] iframe').contentFrame();
      const innerFrame = outerFrame.locator('iframe').contentFrame();

      // Add a shape to the canvas to make a real change
      const sidebarShape = innerFrame.locator('.geSidebarContainer a').nth(2);
      try {
        await sidebarShape.click({ timeout: 30000 });
        await this.page.waitForTimeout(1000);
      } catch {
        console.warn('  ⚠ DrawIO sidebar shape not clickable - proceeding without adding shape');
      }

      await innerFrame.locator('button:has-text("Publish")').click({ timeout: TIMEOUTS.BUTTON_VISIBLE });
    }

    // Verify the editor modal closed — confirms Publish was accepted
    const modal = testConfig.isForge || testConfig.isLite
      ? this.page.getByTestId('custom-ui-modal-dialog')
      : this.page.locator('[role="dialog"] iframe');
    await expect(modal).toBeHidden({ timeout: TIMEOUTS.FRAME_LOAD });
  }
}
