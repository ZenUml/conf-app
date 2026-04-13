import { Page, expect } from '@playwright/test';
import { testConfig, TIMEOUTS } from '../config/test-config.js';

export class ConfluenceEditorPage {
  constructor(private page: Page) {}

  private insertBrowserCombobox() {
    return this.page.getByRole('dialog', { name: /Browse/ }).getByRole('combobox').first();
  }

  /**
   * Returns the editor body element that receives keyboard input.
   * Uses ARIA role "textbox" with the Confluence editor's accessible name.
   * Falls back to ProseMirror CSS selectors for older Confluence instances.
   */
  private editorBody() {
    return this.page.getByRole('textbox', {
      name: /(?:Main content area|Page editing area), start typing to enter text\./,
    });
  }

  // ── Navigation ──

  async navigateToParentPage(): Promise<void> {
    if (!testConfig.parentPageId) {
      throw new Error(`No parent page ID configured for domain: ${testConfig.domain}. Set APP env var or PARENT_PAGE_ID.`);
    }
    const url = `https://${testConfig.domain}/wiki/spaces/${testConfig.spaceKey}/pages/${testConfig.parentPageId}/${encodeURIComponent(testConfig.parentPageName)}`;
    await this.page.goto(url);
    await expect(this.page.locator('#title-text')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
  }

  // ── Page Creation ──

  /**
   * Creates a child page via the Confluence UI Create button.
   * MUST NOT navigate to /pages/create directly — that opens the legacy v1 editor.
   */
  async createChildPage(): Promise<void> {
    // Click Create button in the top nav bar
    await this.page.locator('[data-testid="app-navigation-create"]').click();
    // Dropdown items are links, not menuitems. Click the "Page" link.
    // URL pattern: /wiki/create-content/page?... (v2 editor, NOT the legacy /pages/create)
    const pageLink = this.page.getByRole('link', { name: 'Page', exact: true });
    if (await pageLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await pageLink.click();
    } else {
      await this.page.goto(
        `https://${testConfig.domain}/wiki/create-content/page?spaceKey=${testConfig.spaceKey}&parentPageId=${testConfig.parentPageId}`,
      );
    }
    // Wait for the v2 editor to load
    await this.page.waitForSelector('[placeholder="Give this page a title"]', { timeout: TIMEOUTS.FRAME_LOAD });
  }

  async typePageTitle(title: string): Promise<void> {
    const titleInput = this.page.locator('[placeholder="Give this page a title"]');
    await titleInput.fill(title);
  }

  static generatePageTitle(variantLabel: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `Smoke Test ${timestamp}${variantLabel}`;
  }

  // ── Macro Name Resolution ──

  getMacroName(baseName: string): string {
    // Apply per-profile name overrides first (e.g., "Diagram as Code" on production)
    const name = testConfig.macroNameOverrides[baseName] ?? baseName;
    if (testConfig.isLite) {
      return name + ' Lite';
    }
    // Note: Forge staging apps show "(Staging)" suffix in the macro browser, but we
    // don't append it here because Playwright's hasText filter does substring matching.
    // Searching for "Graph (DrawIO)" matches both "Graph (DrawIO)" and "Graph (DrawIO) (Staging)".
    // This keeps the search working regardless of whether the app is in staging or production mode.
    return name;
  }

  // ── Insert Elements ──

  /**
   * Dismisses the "Learn the basics" panel if it appears in the editor.
   * The panel has a close (X) button in the top-right corner.
   */
  async dismissLearnTheBasicsPanel(): Promise<void> {
    // Try multiple selectors for the close button
    const panel = this.page.locator('text=Learn the basics');
    if (await panel.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Try clicking the X button that's a sibling of the panel heading
      await this.page.evaluate(() => {
        // Find the "Learn the basics" panel and its close button
        const headings = document.querySelectorAll('h2, h3, h4, span, div');
        for (const el of headings) {
          if (el.textContent?.trim() === 'Learn the basics') {
            const panel = el.closest('[class]');
            if (panel) {
              const closeBtn = panel.querySelector('button');
              if (closeBtn) {
                closeBtn.click();
                return;
              }
            }
          }
        }
      });
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * Opens the Insert elements popup and ensures the search combobox is visible.
   *
   * Strategy: Click the toolbar's Insert elements (+) button, then check if the
   * search combobox appeared. Falls back to clicking "More elements" at the bottom
   * of the editor quick-insert bar.
   */
  async clickInsertElements(): Promise<void> {
    const insertCombobox = this.insertBrowserCombobox();

    // On production Confluence (Connect app), typing "/" is unreliable because focus
    // bounces back to the title input. Click the editor body first to activate the
    // quick-insert bar, then click the "More elements" button — it opens the slash menu
    // without needing precise keyboard focus.
    // Fall back to the "/" approach for sites where "More elements" isn't present.
    const editorEl = this.editorBody();
    await editorEl.waitFor({ state: 'visible', timeout: 10000 });
    await editorEl.click();
    await this.page.waitForTimeout(300);

    const moreElements = this.page.getByRole('button', { name: 'More elements' }).last();
    if (await moreElements.isVisible({ timeout: 5000 }).catch(() => false)) {
      await moreElements.click();
      await this.page.waitForTimeout(500);
      console.log('  [debug] clickInsertElements: clicked More elements button');
    } else {
      // Fallback: type "/" in the editor to trigger slash menu
      await editorEl.pressSequentially('/');
      await this.page.waitForTimeout(1000);
    }

    // Check if Browse dialog opened immediately (some Confluence versions skip "View more")
    const browseAlreadyOpen = await insertCombobox.first().isVisible({ timeout: 500 }).catch(() => false);
    if (!browseAlreadyOpen) {
      // Slash menu appears with limited items — click "View more" to open the full Browse dialog
      const viewMore = this.page.getByRole('button', { name: /View more|View all elements/ }).last();
      if (await viewMore.isVisible({ timeout: 3000 }).catch(() => false)) {
        await viewMore.click();
        console.log('  [debug] clickInsertElements: clicked View more');
      }
    }

    // Final wait for Insert elements combobox
    await insertCombobox.first().waitFor({ state: 'visible', timeout: 10000 });
    console.log('  [debug] clickInsertElements: combobox ready');
  }

  /**
   * Searches for a macro in the Insert elements dropdown and selects it.
   *
   * IMPORTANT: Always use base search terms (e.g., 'zenuml', 'graph', 'openapi').
   * Never append "lite" to the search — it returns no results.
   */
  async searchAndSelectMacro(searchTerm: string, macroName: string): Promise<void> {
    // Target the Insert elements combobox specifically using aria-expanded="true".
    // The Confluence page always has a nav search bar (input[role="combobox"][aria-expanded="false"])
    // in addition to the Insert elements combobox (aria-expanded="true"). Using the generic
    // 'input[role="combobox"]' selector would match the nav bar first, causing search to fail.
    const insertCombobox = this.insertBrowserCombobox();
    const isVisible = await insertCombobox.first().isVisible({ timeout: 3000 }).catch(() => false);
    if (isVisible) {
      await insertCombobox.first().click();
      await insertCombobox.first().fill(searchTerm);
      console.log(`  [debug] Typed "${searchTerm}" into Insert elements combobox`);
    } else {
      console.warn(`  [debug] No expanded Insert elements combobox found for search "${searchTerm}"`);
    }

    const browseDialog = this.page.getByRole('dialog', { name: /Browse/ });
    const allOptions = browseDialog.locator('[role="option"], [role="gridcell"] button');
    await allOptions.first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => null);

    const optionCount = await allOptions.count();
    const optionTexts: string[] = [];
    for (let i = 0; i < Math.min(optionCount, 15); i++) {
      optionTexts.push((await allOptions.nth(i).textContent() || '').trim());
    }
    console.log(`  [debug] Options for "${searchTerm}" (${optionCount} total): ${JSON.stringify(optionTexts)}`);

    if (optionCount === 0) {
      throw new Error(
        `Macro browser returned 0 options when searching "${searchTerm}" on ${testConfig.domain}. ` +
        `Expected to find macro "${macroName}".`
      );
    }

    let option = browseDialog.locator('[role="option"], [role="gridcell"] button')
      .filter({ hasText: macroName });
    if (testConfig.appLabel) {
      option = option.filter({ hasText: testConfig.appLabel });
    }
    const matchCount = await option.count();
    if (matchCount === 0) {
      throw new Error(
        `Macro "${macroName}"${testConfig.appLabel ? ` (${testConfig.appLabel})` : ''} not found when searching "${searchTerm}" on ${testConfig.domain}. ` +
        `Available options: ${JSON.stringify(optionTexts)}`
      );
    }
    await option.first().click();

    const insertButton = browseDialog.getByRole('button', { name: 'Insert' });
    if (await insertButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await insertButton.click();
    }
  }

  // ── Cursor Positioning ──

  /**
   * Positions the cursor below all existing macros so the next macro
   * is inserted at the bottom of the page.
   *
   * After inserting a macro, the cursor gets trapped inside the macro's iframe.
   * This method escapes the iframe and navigates to create a new paragraph below.
   */
  async positionCursorBelowMacros(): Promise<void> {
    // Click the page title to escape any macro iframe
    await this.page.locator('[placeholder="Give this page a title"]').click();
    await this.page.waitForTimeout(300);

    // Use Ctrl+End (or Cmd+End on Mac) to jump to end of document
    await this.page.keyboard.press('End');
    for (let i = 0; i < 15; i++) {
      await this.page.keyboard.press('ArrowDown');
      await this.page.waitForTimeout(100);
    }
    // Create a new paragraph
    await this.page.keyboard.press('Enter');
    await this.page.waitForTimeout(300);
  }

  // ── Diagram Macro (Sequence / PlantUML / Mermaid) ──

  /**
   * Interacts with the Diagram as Code macro editor.
   * Handles both Forge (Lite) and Connect (Full) variants.
   *
   * @param title - Title to set for the diagram
   * @param tab - Optional tab to switch to (e.g., 'PlantUML')
   */
  async interactWithDiagramMacro(title: string, tab?: string): Promise<void> {
    await this.page.waitForTimeout(5000); // Wait for macro iframe to load

    if (testConfig.isForge || testConfig.isLite) {
      await this.interactWithForgeDiagramMacro(title, tab);
    } else {
      await this.interactWithConnectDiagramMacro(title, tab);
    }
  }

  private async interactWithForgeDiagramMacro(title: string, tab?: string): Promise<void> {
    const modal = this.page.getByTestId('custom-ui-modal-dialog');
    const frame = modal.locator('[data-testid="hosted-resources-iframe"]').contentFrame();

    if (tab) {
      await frame.getByRole('tab', { name: tab }).click();
      await this.page.waitForTimeout(1000);
    }

    // Fill title
    const titleInput = frame.locator('input[type="text"]').first();
    await titleInput.fill(title);
    await this.page.waitForTimeout(500); // Wait for Publish button to enable

    // Click Publish
    await frame.locator('button:has-text("Publish")').click();
    await this.page.waitForTimeout(2000); // Wait for dialog to close and macro to insert
  }

  private async interactWithConnectDiagramMacro(title: string, tab?: string): Promise<void> {
    const frame = this.page.locator('[role="dialog"] iframe').contentFrame();

    if (tab) {
      await frame.getByRole('tab', { name: tab }).click();
      await this.page.waitForTimeout(1000);
    }

    const titleInput = frame.locator('input[type="text"]').first();
    await titleInput.fill(title);
    await this.page.waitForTimeout(500);

    await frame.locator('button:has-text("Publish")').click();
    await this.page.waitForTimeout(2000);
  }

  // ── Graph (DrawIO) Macro ──

  /**
   * Interacts with the Graph (DrawIO) macro editor.
   *
   * Three-step process:
   * 1. Fill title and click "Confirm"
   * 2. Add at least one shape to the canvas
   * 3. Click "Publish" (in nested iframe)
   */
  async interactWithGraphMacro(title: string): Promise<void> {
    await this.page.waitForTimeout(5000);

    if (testConfig.isForge || testConfig.isLite) {
      await this.interactWithForgeGraphMacro(title);
    } else {
      await this.interactWithConnectGraphMacro(title);
    }
  }

  private async interactWithForgeGraphMacro(title: string): Promise<void> {
    const modal = this.page.getByTestId('custom-ui-modal-dialog');
    const frame = modal.locator('[data-testid="hosted-resources-iframe"]').contentFrame();

    // Step 1: Fill inline title input
    const titleInput = frame.locator('input[type="text"]').first();
    await titleInput.fill(title);
    await this.page.waitForTimeout(500);

    // Step 2: Add a shape to the DrawIO canvas
    await this.addDrawioShape();

    // Step 3: Click Publish in nested iframe
    await this.clickDrawioPublishForge();
  }

  private async interactWithConnectGraphMacro(title: string): Promise<void> {
    const frame = this.page.locator('[role="dialog"] iframe').contentFrame();

    // Step 1: Fill inline title input
    const titleInput = frame.locator('input[type="text"]').first();
    await titleInput.fill(title);
    await this.page.waitForTimeout(500);

    // Step 2: Add a shape to the DrawIO canvas
    await this.addDrawioShape();

    // Step 3: Click Publish in nested iframe
    await this.clickDrawioPublishConnect();
  }

  /**
   * Adds a shape to the DrawIO canvas.
   * Dispatches to Forge or Connect variant based on config.
   */
  private async addDrawioShape(): Promise<void> {
    if (testConfig.isForge || testConfig.isLite) {
      await this.addDrawioShapeForge();
    } else {
      await this.addDrawioShapeConnect();
    }
  }

  /**
   * Adds a shape via the Forge iframe chain (modal > hosted-resources-iframe > inner iframe).
   *
   * Uses Playwright's locator-based contentFrame() navigation instead of
   * page.frames().find() with URL matching — this is more reliable because
   * it doesn't depend on the DrawIO iframe URL pattern.
   */
  private async addDrawioShapeForge(): Promise<void> {
    const modal = this.page.getByTestId('custom-ui-modal-dialog');
    const outerFrame = modal.locator('[data-testid="hosted-resources-iframe"]').contentFrame();
    const innerFrame = outerFrame.locator('iframe').contentFrame();

    // Playwright auto-waits for the element to be visible before clicking
    const sidebarShape = innerFrame.locator('.geSidebarContainer a').nth(2);
    try {
      await sidebarShape.click({ timeout: 30000 });
      await this.page.waitForTimeout(1000);
    } catch {
      console.warn('DrawIO sidebar shape not clickable after 30s - proceeding with empty canvas');
    }
  }

  /**
   * Adds a shape via locator-based iframe navigation (Connect/Full variant).
   * Connect iframe chain: [role="dialog"] iframe (our app) > inner iframe (DrawIO canvas).
   */
  private async addDrawioShapeConnect(): Promise<void> {
    const outerFrame = this.page.locator('[role="dialog"] iframe').contentFrame();
    const innerFrame = outerFrame.locator('iframe').contentFrame();

    const sidebarShape = innerFrame.locator('.geSidebarContainer a').nth(2);
    try {
      await sidebarShape.click({ timeout: 30000 });
      await this.page.waitForTimeout(1000);
    } catch {
      console.warn('DrawIO sidebar shape not clickable after 30s - proceeding with empty canvas');
    }
  }

  /**
   * Clicks the Publish button inside the DrawIO nested iframe (Forge variant).
   *
   * The button is invisible to the accessibility snapshot because it's inside
   * double-nested iframes: Forge modal > hosted-resources-iframe > DrawIO iframe.
   */
  private async clickDrawioPublishForge(): Promise<void> {
    const modal = this.page.getByTestId('custom-ui-modal-dialog');
    const outerFrame = modal.locator('[data-testid="hosted-resources-iframe"]').contentFrame();
    const innerFrame = outerFrame.locator('iframe').contentFrame();
    await innerFrame.locator('button:has-text("Publish")').click();
    await this.page.waitForTimeout(2000);
  }

  private async clickDrawioPublishConnect(): Promise<void> {
    // Publish button is in the inner DrawIO frame (same nesting as Forge)
    const outerFrame = this.page.locator('[role="dialog"] iframe').contentFrame();
    const innerFrame = outerFrame.locator('iframe').contentFrame();
    await innerFrame.locator('button:has-text("Publish")').click();
    await this.page.waitForTimeout(2000);
  }

  // ── OpenAPI / Swagger Macro ──

  async interactWithOpenApiMacro(title: string): Promise<void> {
    await this.page.waitForTimeout(5000);

    if (testConfig.isForge || testConfig.isLite) {
      const modal = this.page.getByTestId('custom-ui-modal-dialog');
      const frame = modal.locator('[data-testid="hosted-resources-iframe"]').contentFrame();
      const titleInput = frame.locator('input[type="text"]').first();
      await titleInput.clear();
      await titleInput.fill(title);
      await this.page.waitForTimeout(500);
      await frame.locator('button:has-text("Publish")').click();
    } else {
      const frame = this.page.locator('[role="dialog"] iframe').contentFrame();
      const titleInput = frame.locator('input[type="text"]').first();
      await titleInput.clear();
      await titleInput.fill(title);
      await this.page.waitForTimeout(500);
      await frame.locator('button:has-text("Publish")').click();
    }
    await this.page.waitForTimeout(2000);
  }

  // ── Page Publishing ──

  /**
   * Publishes the page from the editor.
   *
   * Two-step process:
   * 1. Click "Publish..." in the editor toolbar (opens dialog)
   * 2. Click "Publish" in the publish dialog
   */
  async publishPage(): Promise<void> {
    // First, escape any macro iframe by clicking the page title
    await this.page.locator('[placeholder="Give this page a title"]').click().catch(() => {});
    await this.page.waitForTimeout(500);

    // Click "Publish..." button in editor toolbar
    const publishButton = this.page.locator('button:has-text("Publish...")');
    await publishButton.first().click();
    await this.page.waitForTimeout(1000);

    // Wait for the "Publish page" dialog heading to appear
    await this.page.getByRole('heading', { name: 'Publish page' }).waitFor({ timeout: 5000 });

    // Click the "Publish" button inside the dialog.
    // Use the last visible "Publish" button, since the toolbar one is behind the dialog.
    const publishButtons = this.page.locator('button').filter({ hasText: /^Publish$/ });
    await publishButtons.last().click();

    // Wait for published page to load
    await expect(this.page.locator('#title-text')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
  }

  // ── Macro Editor Frame Helpers ──

  /**
   * Gets the macro editor dialog frame (works for both Forge and Connect variants)
   * This is the outer frame that contains the macro editor UI
   */
  getMacroEditorFrame() {
    if (testConfig.isForge || testConfig.isLite) {
      return this.page.getByTestId('custom-ui-modal-dialog')
        .locator('[data-testid="hosted-resources-iframe"]')
        .contentFrame();
    }
    return this.page.locator('[role="dialog"] iframe').contentFrame();
  }

  /**
   * Close the GenerationPrompt dialog if it appears after inserting a macro
   */
  async closeGenerationPromptIfVisible(): Promise<void> {
    const frame = this.getMacroEditorFrame();
    const openEditorButton = frame.getByRole('button', { name: /open editor/i });
    if (await openEditorButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await openEditorButton.click();
      await this.page.waitForTimeout(500);
      console.log('✓ GenerationPrompt dialog closed');
    }
  }

  /**
   * Switch to a specific tab in the Diagram macro editor (e.g., 'Mermaid', 'PlantUML')
   */
  async switchToMacroTab(tabName: string): Promise<void> {
    const frame = this.getMacroEditorFrame();
    const tab = frame.getByRole('tab', { name: tabName });
    await tab.click();
    await this.page.waitForTimeout(1000);
    console.log(`✓ Switched to ${tabName} tab`);
  }
}
