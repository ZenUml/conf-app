import { test, expect, Page, Locator } from '@playwright/test';
import { testConfig } from '../config/test-config.js';
import { PageCreator } from '../utils/page-creator.js';

// Page Object Model for macro interactions
class MacroPage {
  constructor(private page: Page) {}

  // Modern Playwright locators instead of XPath
  getSequenceMacroFrame(): Locator {
    const suffix = testConfig.isLite ? '-lite' : '';
    return this.page.frameLocator(`iframe[id*="zenuml-sequence-macro${suffix}"]`);
  }

  getGraphMacroFrame(): Locator {
    const suffix = testConfig.isLite ? '-lite' : '';
    return this.page.frameLocator(`iframe[id*="zenuml-graph-macro${suffix}"]`);
  }

  getOpenApiMacroFrame(): Locator {
    const suffix = testConfig.isLite ? '-lite' : '';
    return this.page.frameLocator(`iframe[id*="zenuml-openapi-macro${suffix}"]`);
  }

  getEmbedMacroFrame(): Locator {
    const suffix = testConfig.isLite ? '-lite' : '';
    return this.page.frameLocator(`iframe[id*="zenuml-embed-macro${suffix}"]`);
  }

  getEditorDialogFrame(): Locator {
    return this.page.frameLocator('iframe[src*="sequence-editor-dialog"]');
  }

  async dismissSpotlightModal(): Promise<void> {
    const modal = this.page.locator('[data-testid="spotlight--dialog-container"]');
    
    if (await modal.isVisible({ timeout: 5000 })) {
      await modal.locator('button').filter({ hasText: 'Dismiss' }).click();
      await modal.waitFor({ state: 'detached', timeout: 5000 });
    }
  }

  async assertMacroContent(frame: Locator, expectedText: string): Promise<void> {
    // Wait for frame to load and content to be visible
    await expect(frame.locator('body')).toBeVisible({ timeout: 15000 });
    await expect(frame.getByText(expectedText, { exact: false })).toBeVisible({ timeout: 15000 });
  }

  async editMacro(macroFrame: Locator): Promise<void> {
    // Wait for frame to fully load
    await expect(macroFrame.locator('body')).toBeVisible({ timeout: 15000 });
    
    // Try to find edit button by title/aria-label first, fallback to position-based selection
    let editButton = macroFrame.getByRole('button', { name: /edit/i });
    if (await editButton.count() === 0) {
      // Fallback to first button in actions area
      editButton = macroFrame.locator('.viewer .header .actions button').first();
    }
    
    await expect(editButton).toBeVisible({ timeout: 10000 });
    await editButton.click();
  }

  async saveInEditor(): Promise<void> {
    const editorFrame = this.getEditorDialogFrame();
    // Use more specific button selection - look for the save/publish button
    const saveButton = editorFrame.getByRole('button', { name: /publish|save/i }).first();
    await expect(saveButton).toBeVisible({ timeout: 10000 });
    await saveButton.click();
  }
}

// Improved test setup with proper typing
interface MacroOptions {
  sequence?: boolean | { bodyOnly?: boolean };
  graph?: boolean;
  openapi?: boolean;
  embed?: boolean;
  mermaid?: boolean;
}

async function withTestPage(
  page: Page, 
  callback: (macroPage: MacroPage) => Promise<void>, 
  options: MacroOptions
): Promise<void> {
  let pageId: string | undefined;
  
  try {
    const pageCreator = new PageCreator(page);
    pageId = await pageCreator.createTestPage(options);
    
    await page.goto(testConfig.pageUrl(pageId));
    await expect(page.locator('#title-text')).toBeVisible();
    
    const macroPage = new MacroPage(page);
    await macroPage.dismissSpotlightModal();
    
    await callback(macroPage);
  } finally {
    if (pageId) {
      const pageCreator = new PageCreator(page);
      await pageCreator.deletePage(pageId);
    }
  }
}

test.describe('Macro Functionality Tests', () => {
  test('should display all macro types correctly', async ({ page }) => {
    await withTestPage(page, async (macroPage) => {
      // Test sequence macro with specific content assertion
      await macroPage.assertMacroContent(
        macroPage.getSequenceMacroFrame(),
        'Order Service (Demonstration only)'
      );

      // Test graph macro
      await macroPage.assertMacroContent(
        macroPage.getGraphMacroFrame(),
        "Lamp doesn't work"
      );

      // Test OpenAPI macro
      await expect(macroPage.getOpenApiMacroFrame().locator('body')).toBeVisible({ timeout: 15000 });
      await expect(
        macroPage.getOpenApiMacroFrame().getByText('/users', { exact: false })
      ).toBeVisible({ timeout: 15000 });

      // Test embed macro
      await macroPage.assertMacroContent(
        macroPage.getEmbedMacroFrame(),
        'Order Service (Demonstration only)'
      );
    }, { 
      sequence: true, 
      graph: true, 
      openapi: true, 
      embed: true 
    });
  });

  test('should display mermaid diagrams', async ({ page }) => {
    await withTestPage(page, async (macroPage) => {
      await macroPage.assertMacroContent(
        macroPage.getSequenceMacroFrame(),
        'A Gantt Diagram'
      );
    }, { 
      mermaid: true 
    });
  });

  test('should handle body-only sequence macros', async ({ page }) => {
    await withTestPage(page, async (macroPage) => {
      await macroPage.assertMacroContent(
        macroPage.getSequenceMacroFrame(),
        'Order Service (Demonstration only)'
      );
    }, { 
      sequence: { bodyOnly: true } 
    });
  });

  test('should edit sequence macro successfully', async ({ page }) => {
    await withTestPage(page, async (macroPage) => {
      const sequenceFrame = macroPage.getSequenceMacroFrame();
      
      // Verify macro is loaded
      await macroPage.assertMacroContent(sequenceFrame, 'Order Service (Demonstration only)');
      
      // Edit the macro
      await macroPage.editMacro(sequenceFrame);
      await macroPage.saveInEditor();
      
      // Verify macro reloaded after edit
      await macroPage.assertMacroContent(sequenceFrame, 'Order Service (Demonstration only)');
    }, { 
      sequence: true 
    });
  });

  test('should edit embed macro successfully', async ({ page }) => {
    await withTestPage(page, async (macroPage) => {
      const embedFrame = macroPage.getEmbedMacroFrame();
      
      // Verify embed macro is loaded
      await macroPage.assertMacroContent(embedFrame, 'Order Service (Demonstration only)');
      
      // Edit the embed macro
      await macroPage.editMacro(embedFrame);
      await macroPage.saveInEditor();
      
      // Verify macro reloaded after edit
      await macroPage.assertMacroContent(embedFrame, 'Order Service (Demonstration only)');
    }, { 
      embed: true 
    });
  });
});