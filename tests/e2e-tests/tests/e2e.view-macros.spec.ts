import { test, expect, Page } from '@playwright/test';
import { testConfig } from '../config/test-config.js';
import { PageCreator } from '../utils/page-creator.js';

async function dismissSpotlightModal(page: Page): Promise<void> {
    try {
      // Wait for the spotlight modal to appear and dismiss it
      const dismissButton = await page.waitForSelector('[data-testid="spotlight--dialog-container"] button:has-text("Dismiss")', { timeout: 5000 });
      await dismissButton.click();
      console.log('Dismissed spotlight modal');
      
      // Wait for modal to disappear
      await page.waitForSelector('[data-testid="spotlight--dialog-container"]', { state: 'detached', timeout: 5000 });
    } catch (error) {
      // Modal might not appear, continue with test
      console.log('No spotlight modal found or already dismissed');
    }
  }

async function withNewPage(page: Page, callback: (newPage: Page) => Promise<void>, options: any): Promise<void> {
    let pageId: string | undefined;
    try {
      const pageCreator = new PageCreator(page);
      pageId = await pageCreator.createTestPage(options);
      
      console.log(`Created page with id: ${pageId}`);

      await page.goto(testConfig.pageUrl(pageId));
      console.log(`Navigated to ${testConfig.pageUrl(pageId)}`);
      await page.waitForSelector('#title-text');
      
      // Dismiss any spotlight modal that might appear
      await dismissSpotlightModal(page);

      await callback(page);
    } finally {
      if (pageId) {
        const pageCreator = new PageCreator(page);
        await pageCreator.deletePage(pageId);
        console.log(`Deleted page with id: ${pageId}`);
      }
    }
  }

async function assertFrame(page: Page, { frameSelector, contentXpath }: { frameSelector: string; contentXpath: string }): Promise<void> {
    const iframe = await waitForSelector(page, frameSelector);
    console.log(`Found frame "${frameSelector}"`);

    const frame = await iframe.contentFrame();
    if (!frame) {
      throw new Error(`Could not get content frame for ${frameSelector}`);
    }

    await frame.waitForLoadState('networkidle');

    const result = await waitForSelector(frame, contentXpath);
    console.log(`Found ${contentXpath} in frame ${frameSelector}`);

    expect(result).toBeTruthy();
  }

async function waitForSelector(page: Page, selector: string, options: any = {}): Promise<any> {
    const isXpath = selector.startsWith('xpath=');
    const actualSelector = isXpath ? selector : selector;

    try {
      return await page.waitForSelector(actualSelector, options);
    } catch (e) {
      console.log(`Error on waiting for ${selector}, now evaluating in page...`);

      const element = await page.evaluate(({ isXpath, selector }) => {
        if (isXpath) {
          const xpathSelector = selector.replace('xpath=', '');
          const result = document.evaluate(xpathSelector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          return result.singleNodeValue;
        } else {
          return document.querySelector(selector);
        }
      }, { isXpath, selector: isXpath ? selector : selector });

      if (element) {
        console.log(`Found element ${selector} in page, now waiting for it by Playwright interface...`);
        return await page.waitForSelector(actualSelector, options);
      } else {
        console.log(`Element still not found`);
        throw e;
      }
    }
  }

function getModuleKeySuffix(): string {
  return testConfig.isLite ? '-lite' : '';
}

test.describe('View Macros', () => {
  test('should display sequence/graph/openapi/embed macros correctly', async ({ page }: { page: Page }) => {
    console.log('\nCase - view sequence/graph/openapi/embed macros');
    await withNewPage(page, async () => {

      // Test sequence macro
      await assertFrame(page, {
        frameSelector: `xpath=//iframe[contains(@id, "zenuml-sequence-macro${getModuleKeySuffix()}")]`,
        contentXpath: 'xpath=//*[contains(text(), "Order Service (Demonstration only)")]'
      });

      // Test graph macro
      await assertFrame(page, {
        frameSelector: `xpath=//iframe[contains(@id, "zenuml-graph-macro${getModuleKeySuffix()}")]`,
        contentXpath: 'xpath=//*[contains(text(), "Lamp doesn\'t work")]'
      });

      // Test OpenAPI macro
      await assertFrame(page, {
        frameSelector: `xpath=//iframe[contains(@id, "zenuml-openapi-macro${getModuleKeySuffix()}")]`,
        contentXpath: 'xpath=//span[text()="/users"]'
      });

      // Test embed macro
      await assertFrame(page, {
        frameSelector: `xpath=//iframe[contains(@id, "zenuml-embed-macro${getModuleKeySuffix()}")]`,
        contentXpath: 'xpath=//*[contains(text(), "Order Service (Demonstration only)")]'
      });

    }, { sequence: true, graph: true, openapi: true, embed: true });
  });

  test('should display mermaid macro correctly', async ({ page }: { page: Page }) => {
    console.log('\nCase - view mermaid macro');
    await withNewPage(page, async () => {

      await assertFrame(page, {
        frameSelector: `xpath=//iframe[contains(@id, "zenuml-sequence-macro${getModuleKeySuffix()}")]`,
        contentXpath: 'xpath=//*[text()="A Gantt Diagram"]'
      });

    }, { mermaid: true });
  });

  test('should display sequence macro with body only', async ({ page }: { page: Page }) => {
    console.log('\nCase - view macro body only sequence');
    await withNewPage(page, async () => {

      await assertFrame(page, {
        frameSelector: `xpath=//iframe[contains(@id, "zenuml-sequence-macro${getModuleKeySuffix()}")]`,
        contentXpath: 'xpath=//*[contains(text(), "Order Service (Demonstration only)")]'
      });

    }, { sequence: { bodyOnly: true } });
  });

  test('should edit sequence macro on viewer', async ({ page }: { page: Page }) => {
    console.log('\nCase - edit sequence macro on viewer');
    await withNewPage(page, async () => {

      const clickEditMacroButton = async () => {
        const editMacro = '.viewer .header .actions button';
        const iframe = await waitForSelector(page, `xpath=//iframe[contains(@id, "zenuml-sequence-macro${getModuleKeySuffix()}")]`);
        const frame = await iframe.contentFrame();
        
        if (!frame) {
          throw new Error('Could not get content frame for edit button');
        }
        
        const button = await frame.waitForSelector(editMacro);
        await button.click();
        console.log('Clicked edit macro button');
      };

      await clickEditMacroButton();

      const macroEditorFrame = 'xpath=//iframe[contains(@src, "sequence-editor-dialog.html")]';
      const iframe = await waitForSelector(page, macroEditorFrame);
      console.log('Found macro editor iframe');

      const frame = await iframe.contentFrame();
      if (!frame) {
        throw new Error('Unexpected iframe contentFrame error');
      }
      console.log('Got content frame');

      const saveMacroButton = await frame.waitForSelector('div.save-and-exit button');
      console.log('Found save button');

      // Check if button is visible using bounding box
      const boundingBox = await saveMacroButton.boundingBox();
      console.log('Save button bounding box:', boundingBox);

      // Click the button
      await saveMacroButton.click({ delay: 100 });
      console.log('Clicked save macro button');

      // Wait for macro viewer to reload
      await assertFrame(page, {
        frameSelector: `xpath=//iframe[contains(@id, "zenuml-sequence-macro${getModuleKeySuffix()}")]`,
        contentXpath: 'xpath=//*[contains(text(), "Order Service (Demonstration only)")]'
      });

    }, { sequence: true });
  });

  test('should edit embed macro on viewer', async ({ page }: { page: Page }) => {
    console.log('\nCase - edit embed macro on viewer');
    await withNewPage(page, async () => {

      const frameSelector = `xpath=//iframe[contains(@id, "zenuml-embed-macro${getModuleKeySuffix()}")]`;
      const iframe = await waitForSelector(page, frameSelector);
      console.log(`Found frame "${frameSelector}"`);

      const frame = await iframe.contentFrame();
      if (!frame) {
        throw new Error('Could not get content frame for embed macro');
      }
      
      await frame.waitForLoadState('networkidle');

      const editButton = await frame.waitForSelector('.viewer .header .actions button');
      console.log('Found edit button in embed macro frame');
      await editButton.click();
      console.log('Clicked edit macro button');

      // Wait for the sequence editor dialog to open
      const macroEditorFrame = 'xpath=//iframe[contains(@src, "sequence-editor-dialog")]';
      
      try {
        const editorIframe = await waitForSelector(page, macroEditorFrame);
        console.log('Found macro editor iframe');

        const editorFrame = await editorIframe.contentFrame();
        if (!editorFrame) {
          throw new Error('Could not get editor content frame');
        }
        console.log('Got editor content frame');

        const saveMacroButton = await editorFrame.waitForSelector('div.save-and-exit button');
        console.log('Found save button');

        await saveMacroButton.click();
        console.log('Clicked save macro button');

        // Wait for the original embed macro frame to reload
        await waitForSelector(page, frameSelector);
        console.log('Embed macro edit test completed successfully');
        
      } catch (error) {
        console.log('Error finding editor dialog iframe:', error);
        
        // Debug: log all iframe URLs
        const allIframes = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('iframe')).map(iframe => iframe.src);
        });
        console.log('All iframe URLs:', allIframes);
        
        throw error;
      }

    }, { embed: true });
  });
});