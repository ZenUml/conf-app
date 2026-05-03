import { Page } from '@playwright/test';
import { generateOtp } from './otp.js';
import { testConfig } from '../config/test-config.js';

const MAX_OTP_RETRIES = 3;
const OTP_NAVIGATION_TIMEOUT_MS = 10000;
// TOTP codes rotate every 30s — wait long enough for next window but not so long the browser times out
const OTP_RETRY_DELAY_MS = 15_000;

export class ConfluenceLogin {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async login(username: string, password: string): Promise<void> {
    await this.enterCredentials(username, password);
    await this.handlePostLoginFlow();
  }

  private async enterCredentials(username: string, password: string): Promise<void> {
    await this.page.fill('input[name=username]', username);
    await this.page.click("#login-submit");

    await this.page.fill('input[name=password]', password);
    await this.page.click("#login-submit");
  }

  private async handlePostLoginFlow(): Promise<void> {
    console.log('MFA required - entering OTP');

    for (let attempt = 1; attempt <= MAX_OTP_RETRIES; attempt++) {
      try {
        const otp = generateOtp();
        console.log(`OTP attempt ${attempt}/${MAX_OTP_RETRIES}`);

        await this.page.fill('#two-step-verification-otp-code-input', otp);
        await this.page.getByRole('button', { name: 'Log in' }).click();

        // Wait for navigation after OTP submit
        await this.page.waitForURL(testConfig.baseUrl, { timeout: OTP_NAVIGATION_TIMEOUT_MS }).catch(() => {});

        const title = await this.page.title();
        const isSuccess = title.includes('Confluence');
        if (isSuccess) {
          console.log('OTP submitted successfully');
          return;
        }

        // If we have more attempts and no clear 403, try again
        if (attempt < MAX_OTP_RETRIES) {
          console.log(`OTP attempt ${attempt} failed, retrying...`);
          await this.page.fill('#two-step-verification-otp-code-input', '');
          await this.page.waitForTimeout(OTP_RETRY_DELAY_MS);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`OTP attempt ${attempt} error:`, errorMessage);
        if (attempt === MAX_OTP_RETRIES) {
          throw new Error(
            `OTP failed after ${MAX_OTP_RETRIES} attempts: ${errorMessage}\n` +
            `Check ZENUML_MFA_SECRET environment variable and system clock synchronization.`
          );
        }
        await this.page.waitForTimeout(OTP_RETRY_DELAY_MS);
      }
    }

    throw new Error(
      `OTP failed after ${MAX_OTP_RETRIES} attempts.\n` +
      `Check ZENUML_MFA_SECRET environment variable and system clock synchronization.`
    );
  }
}