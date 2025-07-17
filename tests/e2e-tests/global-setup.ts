import { chromium, FullConfig } from '@playwright/test';
import { ConfluenceLogin } from './utils/ConfluenceLogin.js';
import { testConfig } from './config/test-config.js';

async function globalSetup(config: FullConfig) {
  console.log('🚀 Starting global setup...');
  
  // Validate configuration
  testConfig.validate();
  
  const browser = await chromium.launch();
  const context = await browser.newContext({ bypassCSP: true });
  const page = await context.newPage();
  
  try {
    console.log('🔐 Performing one-time login...');
    
    // Navigate to Confluence
    const targetUrl = `${testConfig.baseUrl}/overview`;
    await page.goto(targetUrl);
    
    // Login once with OTP
    const confluenceLogin = new ConfluenceLogin(page);
    await confluenceLogin.login(testConfig.credentials.username, testConfig.credentials.password);
    
    console.log('✅ Login successful, saving authentication state...');
    
    // Save authentication state
    await context.storageState({ path: 'auth-state.json' });
    
    console.log('✅ Global setup complete!');
  } catch (error) {
    console.error('❌ Global setup failed:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

export default globalSetup;