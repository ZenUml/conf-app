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
    const otp = generateOtp();
    await this.page.fill('#two-step-verification-otp-code-input', otp);
    await this.page.click('#two-step-verification-submit');
    console.log('OTP submitted');
  }
}