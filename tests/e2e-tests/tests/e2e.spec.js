const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { generateOtp } = require('../otp.js');

// Define the path for the new directory
const dirPath = path.join(__dirname, '../screenshots');
// Create the new directory if it doesn't exist
if (!fs.existsSync(dirPath)) {
  fs.mkdirSync(dirPath, { recursive: true });
}

const testDomain = process.env.ZENUML_DOMAIN || 'zenuml-stg.atlassian.net';
const spaceKey = process.env.ZENUML_SPACE || 'ZS';
const baseUrl = `https://${testDomain}/wiki/spaces/${spaceKey}`;
const pageUrl = (id) => `${baseUrl}/pages/${id}`;
const isLite = process.env.IS_LITE === 'true';
const existingPageId = process.env.PAGE_ID;

const username = process.env.ZENUML_STAGE_USERNAME;
const password = process.env.ZENUML_STAGE_PASSWORD;

if (!username) {
  throw new Error('Missing username');
}
if (!password) {
  throw new Error('Missing password');
}

test.describe('ZenUML Confluence E2E Tests', () => {
  let page;
  let context;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext({
      // Disable web security for testing
      bypassCSP: true,
    });
    page = await context.newPage();
    
    // Set timeouts
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('should login and run all test cases', async () => {
    await page.goto(existingPageId ? pageUrl(existingPageId) : `${baseUrl}/overview`);

    // Handle login
    await handleLogin(page);

    // Run test cases
    await testViewMacros(page);
    await testEditSequenceMacro(page);
    await testEmbedMacros(page);
  });

  async function handleLogin(page) {
    // Some instances don't automatically redirect to login
    await Promise.race([
      page.waitForSelector('input[name=username]'),
      page.waitForSelector('xpath=//a[contains(@href, "/wiki/login.action")]')
        .then(e => e.click())
        .then(() => page.waitForSelector('input[name=username]'))
    ]);

    await page.click('input[name=username]');
    await page.keyboard.type(username);
    await page.click("#login-submit");
    await page.waitForSelector('input[name=password]', { state: 'visible' });
    await page.click('input[name=password]');
    await page.keyboard.type(password);

    await page.waitForSelector('xpath=//span[text() = "Log in"]');
    await page.click("#login-submit");
    await page.screenshot({ path: `${dirPath}/after-login-submit.png`, fullPage: true });
    await page.waitForLoadState('networkidle');
    console.log('Page navigated away.');

    const dismissMFAIfPresent = async () => {
      const mfaButton = await page.$('#mfa-promote-dismiss');
      if (mfaButton) {
        await mfaButton.click();
        console.log('Clicked "Continue without 2FA" button');
      }
    };

    const fillOtp = async (otpInput) => {
      const otp = await generateOtp();
      await otpInput.type(otp);
      await page.click('#two-step-verification-submit');
    };

    try {
      await Promise.race([
        page.waitForSelector('#two-step-verification-otp-code-input')
          .then(fillOtp)
          .then(() => page.waitForSelector('#title-text')),
        page.waitForSelector('#title-text'),
        page.waitForSelector('#mfa-promote-dismiss')
          .then(dismissMFAIfPresent)
          .then(() => page.waitForSelector('#title-text'))
      ]);
    } catch (e) {
      await page.screenshot({ path: `${dirPath}/login-error.png`, fullPage: true });
      throw e;
    }

    console.log(await page.title());
  }

  async function testViewMacros(page) {
    console.log('\nCase - view sequence/graph/openapi/embed macros');
    await withNewPage(async (newPage) => {
      await assertFrame(newPage, {
        frameSelector: `xpath=//iframe[contains(@id, "zenuml-sequence-macro${getModuleKeySuffix()}")]`,
        contentXpath: 'xpath=//*[contains(text(), "Order Service (Demonstration only)")]'
      });

      await assertFrame(newPage, {
        frameSelector: `xpath=//iframe[contains(@id, "zenuml-graph-macro${getModuleKeySuffix()}")]`,
        contentXpath: 'xpath=//*[contains(text(), "Lamp doesn\'t work")]'
      });

      await assertFrame(newPage, {
        frameSelector: `xpath=//iframe[contains(@id, "zenuml-openapi-macro${getModuleKeySuffix()}")]`,
        contentXpath: 'xpath=//span[text()="/users"]'
      });

      await assertFrame(newPage, {
        frameSelector: `xpath=//iframe[contains(@id, "zenuml-embed-macro${getModuleKeySuffix()}")]`,
        contentXpath: 'xpath=//*[contains(text(), "participant")]'
      });
    });
  }

  async function testEditSequenceMacro(page) {
    console.log('\nCase - edit sequence macro on viewer');
    await withNewPage(async (newPage) => {
      const sequence = async () => {
        const frameSelector = `xpath=//iframe[contains(@id, "zenuml-sequence-macro${getModuleKeySuffix()}")]`;
        const iframe = await waitForSelector(newPage, frameSelector);
        console.log(`Found frame "${frameSelector}"`);

        console.log('About to call contentFrame()');
        const frame = await iframe.contentFrame();
        console.log('contentFrame() completed successfully');

        console.log('About to call waitForNavigation()');
        await frame.waitForLoadState('networkidle');
        console.log('waitForNavigation() completed successfully');

        const editButton = await waitForSelector(frame, '.viewer .header .actions button');
        console.log('Found ".viewer .header .actions button" in frame');
        await editButton.click();
        console.log('Clicked edit macro button');

        // Updated selector to be more flexible
        const macroEditorFrame = 'xpath=//iframe[contains(@src, "sequence-editor-dialog")]';
        
        try {
          const editorIframe = await waitForSelector(newPage, macroEditorFrame);
          console.log('Found macro editor iframe');

          if (!editorIframe.contentFrame) {
            console.log('iframe.contentFrame is not a function, saving page html', editorIframe);
            await savePageHtml(newPage, 'edit-macro-iframe');
            throw new Error('Unexpected iframe contentFrame error');
          }

          const editorFrame = await editorIframe.contentFrame();
          console.log('Got content frame');

          const saveMacroButton = await waitForSelector(editorFrame, 'div.save-and-exit button');
          console.log('Found save button');

          await saveMacroButton.click();
          console.log('Clicked save macro button');

          await waitForSelector(newPage, frameSelector);
          console.log('Edit macro test completed successfully');
        } catch (error) {
          console.log('Error finding editor dialog iframe:', error.message);
          
          // Debug: log all iframe URLs
          const allIframes = await newPage.evaluate(() => {
            return Array.from(document.querySelectorAll('iframe')).map(iframe => iframe.src);
          });
          console.log('All iframe URLs:', allIframes);
          
          throw error;
        }
      };

      await sequence();
    });
  }

  async function testEmbedMacros(page) {
    console.log('\nCase - embed macros');
    await withNewPage(async (newPage) => {
      const frameSelector = `xpath=//iframe[contains(@id, "zenuml-embed-macro${getModuleKeySuffix()}")]`;
      const iframe = await waitForSelector(newPage, frameSelector);
      console.log(`Found frame "${frameSelector}"`);

      const frame = await iframe.contentFrame();
      await frame.waitForLoadState('networkidle');

      const editButton = await waitForSelector(frame, '.viewer .header .actions button');
      console.log('Found ".viewer .header .actions button" in frame');
      await editButton.click();
      console.log('Clicked edit macro button');

      const macroEditorFrame = 'xpath=//iframe[contains(@src, "sequence-editor-dialog")]';
      const editorIframe = await waitForSelector(newPage, macroEditorFrame);
      console.log('Found macro editor iframe');

      const editorFrame = await editorIframe.contentFrame();
      console.log('Got content frame');

      const saveMacroButton = await waitForSelector(editorFrame, 'div.save-and-exit button');
      console.log('Found save button');

      await saveMacroButton.click();
      console.log('Clicked save macro button');

      await waitForSelector(newPage, frameSelector);
      console.log('Embed macro test completed successfully');
    });
  }

  async function withNewPage(callback) {
    let pageId;
    try {
      const response = await page.evaluate(async () => {
        const response = await fetch('/rest/api/content', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'page',
            title: `E2E test page at ${new Date()} - ${crypto.randomUUID()}`,
            space: {
              key: spaceKey
            },
            body: {
              storage: {
                value: getTestPageContent(),
                representation: 'storage'
              }
            }
          })
        });
        return response.json();
      });

      pageId = response.id;
      console.log(`Created page with id: ${pageId}, title: ${response.title}`);

      await page.goto(pageUrl(pageId));
      console.log(`Navigated to ${pageUrl(pageId)}`);

      await callback(page);
    } finally {
      if (pageId) {
        await page.evaluate(async (id) => {
          await fetch(`/rest/api/content/${id}`, {
            method: 'DELETE'
          });
        }, pageId);
        console.log(`Deleted page with id: ${pageId}`);
      }
    }
  }

  async function assertFrame(page, { frameSelector, contentSelector, contentXpath, expectedContentText }) {
    const iframe = await waitForSelector(page, frameSelector);
    console.log(`Found frame "${frameSelector}"`);

    const frame = await iframe.contentFrame();
    await frame.waitForLoadState('networkidle');

    let result = frame;

    if (contentSelector) {
      result = await waitForSelector(frame, contentSelector);
      console.log(`Found content ${contentSelector}`);

      if (expectedContentText) {
        result = await frame.$eval(contentSelector, e => e.innerText);
        console.log('Content text', result);
        expect(result).toBe(expectedContentText);
      }
    }

    if (contentXpath) {
      result = await waitForSelector(frame, contentXpath);
      console.log(`Found ${contentXpath} in frame ${frameSelector}`);
    }
    return result;
  }

  async function waitForSelector(page, selector, options = {}) {
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

        if (!options.hidden) {
          const file = await savePageHtml(page);
          console.log(`Selector "${selector}" not found in page, see ${file}`);
        }
        throw e;
      }
    }
  }

  async function savePageHtml(page, suffix = Date.now()) {
    try {
      const html = await page.evaluate(() => document.documentElement.innerHTML);
      const file = `${dirPath}/debug-${suffix}.html`;
      fs.writeFileSync(file, html);
      return file;
    } catch (e) {
      console.log(`Failed to collect page info`, e);
    }
  }

  function getModuleKeySuffix() {
    return isLite ? '-lite' : '';
  }

  function getTestPageContent() {
    return `
      <ac:structured-macro ac:name="zenuml-sequence-macro" ac:schema-version="1" ac:macro-id="123">
        <ac:plain-text-body><![CDATA[Order Service (Demonstration only)
@Actor Client
@Boundary OrderController
@Entity OrderService
@Entity PaymentService
@Entity User

Client->OrderController.PlaceOrder(payload)
OrderController -> OrderService.CreateOrder(payload)
OrderService -> PaymentService.ProcessPayment(payload)
PaymentService -> User.ChargeUser(payload)
User->PaymentService.Success()
PaymentService->OrderService.Success()
OrderService->OrderController.Success()
OrderController->Client.Success()]]></ac:plain-text-body>
      </ac:structured-macro>
      
      <ac:structured-macro ac:name="zenuml-graph-macro" ac:schema-version="1" ac:macro-id="456">
        <ac:plain-text-body><![CDATA[flowchart TD
    A[Lamp doesn't work] --> B{Lamp plugged in?}
    B -->|Yes| C{Bulb burned out?}
    C -->|Yes| D[Replace bulb]
    C -->|No| E[Repair lamp]
    B -->|No| F[Plug in lamp]
    D --> G[Lamp works]
    E --> G
    F --> G]]></ac:plain-text-body>
      </ac:structured-macro>
      
      <ac:structured-macro ac:name="zenuml-openapi-macro" ac:schema-version="1" ac:macro-id="789">
        <ac:plain-text-body><![CDATA[openapi: 3.0.0
info:
  title: Sample API
  version: 1.0.0
paths:
  /users:
    get:
      summary: Get users
      responses:
        '200':
          description: Success]]></ac:plain-text-body>
      </ac:structured-macro>
      
      <ac:structured-macro ac:name="zenuml-embed-macro" ac:schema-version="1" ac:macro-id="101112">
        <ac:plain-text-body><![CDATA[participant A
participant B
A->B: Hello]]></ac:plain-text-body>
      </ac:structured-macro>
    `;
  }
});