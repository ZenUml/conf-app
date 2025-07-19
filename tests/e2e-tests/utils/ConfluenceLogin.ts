import { Page } from '@playwright/test';
import { generateOtp } from '../otp.js';

export class ConfluenceLogin {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async login(username: string, password: string): Promise<void> {
    await this.enterCredentials(username, password);
    await this.handlePostLoginFlow();
    await this.page.waitForSelector('#title-text');
  }

  private async enterCredentials(username: string, password: string): Promise<void> {
    console.log('entering credentials');
    await this.page.fill('input[name=username]', username);
    await this.page.click("#login-submit");

    await this.page.fill('input[name=password]', password);
    await this.page.click("#login-submit");

    console.log('Credentials submitted');
  }

  private async handlePostLoginFlow(): Promise<void> {
    console.log('MFA required - entering OTP');
    
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const otp = generateOtp();
        console.log(`OTP attempt ${attempt}/${maxRetries}: ${otp}`);
        
        await this.page.fill('#two-step-verification-otp-code-input', otp);
        
        // Listen for network responses to detect 403 errors
        const responsePromise = this.page.waitForResponse(
          response => response.url().includes('two-step-verification') && response.status() !== 200,
          { timeout: 10000 }
        ).catch(() => null); // Don't throw on timeout
        
        const successPromise = this.page.waitForSelector('#title-text', { timeout: 10000 });
        
        await this.page.click('#two-step-verification-submit');
        
        // Wait for either success or network error
        const [networkResponse] = await Promise.allSettled([responsePromise, successPromise]);
        
        // Check if we got a 403 (invalid OTP)
        if (networkResponse.status === 'fulfilled' && networkResponse.value && networkResponse.value.status() === 403) {
          console.log(`OTP attempt ${attempt} failed with 403 - invalid OTP`);
          if (attempt < maxRetries) {
            console.log('Regenerating OTP and retrying...');
            await this.page.fill('#two-step-verification-otp-code-input', '');
            await this.page.waitForTimeout(1000); // Wait for next TOTP cycle
            continue;
          }
        }
        
        // Check if we succeeded (title-text is visible)
        const isSuccess = await this.page.locator('#title-text').isVisible();
        if (isSuccess) {
          console.log('OTP submitted successfully');
          return;
        }
        
        // If we have more attempts and no clear 403, try again
        if (attempt < maxRetries) {
          console.log(`OTP attempt ${attempt} failed, retrying...`);
          await this.page.fill('#two-step-verification-otp-code-input', '');
          await this.page.waitForTimeout(1000);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`OTP attempt ${attempt} error:`, errorMessage);
        if (attempt === maxRetries) {
          throw new Error(`OTP failed after ${maxRetries} attempts: ${errorMessage}`);
        }
        await this.page.waitForTimeout(1000);
      }
    }
    
    throw new Error(`OTP failed after ${maxRetries} attempts`);
  }
}