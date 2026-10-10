import { test as base } from '@playwright/test';
import { installMixpanelIsolation } from '../mixpanel-isolation.js';

export const test = base.extend<{ mixpanelIsolation: void }>({
  mixpanelIsolation: [async ({ context }, use) => {
    await installMixpanelIsolation(context);
    await use();
  }, { auto: true }],
});

export * from '@playwright/test';
