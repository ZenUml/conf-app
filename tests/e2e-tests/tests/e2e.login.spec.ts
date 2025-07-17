import { test, expect, Page } from '@playwright/test';
import { testConfig } from '../config/test-config.js';

test.describe('Authentication', () => {
  test('should be logged in and access space overview page', async ({ page }: { page: Page }) => {
    // Navigate to space overview - should be automatically authenticated
    const targetUrl = `${testConfig.baseUrl}/overview`;
    await page.goto(targetUrl);
    
    // Verify we're logged in by checking for page title
    await expect(page.locator('#title-text')).toBeVisible();
    console.log('✅ Successfully authenticated and accessed space overview');
  });
});