import { test as setup } from '@playwright/test';
import { PageCreator } from '../../utils/page-creator.js';
import { testConfig } from '../../config/test-config.js';
import path from 'path';
import fs from 'fs';

/**
 * Page creation setup for E2E tests
 * This runs as a setup project to create test pages before running tests
 */

interface TestPages {
  sequence?: string;
  graph?: string;
  openapi?: string;
  embed?: string;
  mermaid?: string;
}

const TEST_PAGES_FILE = path.join(__dirname, '..', '..', 'test-pages.json');
let testPages: TestPages = {};

setup('create diagram test pages', async ({ page }) => {
  console.log('🚀 Creating diagram test pages...');

  testConfig.validate();

  const pageCreator = new PageCreator(page);

  try {
    // Navigate to Confluence to ensure authenticated session
    await page.goto(testConfig.baseUrl);

    // Create pages for each supported diagram type
    if (testConfig.renderMacros.includes('sequence')) {
      console.log('Creating sequence diagram page...');
      testPages.sequence = await pageCreator.createTestPage({ sequence: true });
      console.log(`✅ Created sequence test page: ${testPages.sequence}`);
    }

    if (testConfig.renderMacros.includes('graph')) {
      console.log('Creating graph diagram page...');
      testPages.graph = await pageCreator.createTestPage({ graph: true });
      console.log(`✅ Created graph test page: ${testPages.graph}`);
    }

    if (testConfig.renderMacros.includes('openapi')) {
      console.log('Creating OpenAPI diagram page...');
      testPages.openapi = await pageCreator.createTestPage({ openapi: true });
      console.log(`✅ Created OpenAPI test page: ${testPages.openapi}`);
    }

    if (testConfig.renderMacros.includes('embed')) {
      console.log('Creating embed diagram page...');
      testPages.embed = await pageCreator.createTestPage({ embed: true });
      console.log(`✅ Created embed test page: ${testPages.embed}`);
    }

    if (testConfig.renderMacros.includes('mermaid')) {
      console.log('Creating mermaid diagram page...');
      testPages.mermaid = await pageCreator.createTestPage({ mermaid: true });
      console.log(`✅ Created mermaid test page: ${testPages.mermaid}`);
    }

    // Save page IDs to file
    fs.writeFileSync(TEST_PAGES_FILE, JSON.stringify(testPages, null, 2));
    console.log(`💾 Saved all page IDs to: ${TEST_PAGES_FILE}`);
  } catch (error) {
    console.error('❌ Failed to create test pages:', error);
    throw error;
  }
});

// Note: Cleanup of test pages is handled manually or via separate script
// Pages persist after test run for easier debugging
// To clean up, delete test-pages.json and manually delete pages from Confluence
