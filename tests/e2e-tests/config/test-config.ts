interface TestConfig {
  domain: string;
  spaceKey: string;
  existingPageId: string | undefined;
  isLite: boolean;
  isForge: boolean;
  credentials: {
    username: string;
    password: string;
  };
  baseUrl: string;
  pageUrl(id: string): string;
  validate(): void;
}

export const TIMEOUTS = {
  FRAME_LOAD: 60000,
  BUTTON_VISIBLE: 60000,
  MODAL_DISMISS: 60000,
} as const;

export const testConfig: TestConfig = {
  domain: process.env.ZENUML_DOMAIN || 'zenuml-stg.atlassian.net',
  spaceKey: process.env.ZENUML_SPACE || 'ZS',
  existingPageId: process.env.PAGE_ID,
  isLite: process.env.IS_LITE === 'true',
  isForge: process.env.IS_FORGE === 'true',
  
  credentials: {
    username: process.env.ZENUML_STAGE_USERNAME || '',
    password: process.env.ZENUML_STAGE_PASSWORD || ''
  },
  
  get baseUrl(): string {
    return `https://${this.domain}/wiki/spaces/${this.spaceKey}`;
  },
  
  pageUrl(id: string): string {
    return `${this.baseUrl}/pages/${id}`;
  },
  
  validate(): void {
    if (!this.credentials.username) {
      throw new Error('Missing username (ZENUML_STAGE_USERNAME)');
    }
    if (!this.credentials.password) {
      throw new Error('Missing password (ZENUML_STAGE_PASSWORD)');
    }
  }
};