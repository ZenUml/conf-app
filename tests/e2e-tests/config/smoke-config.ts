import { testConfig } from './test-config.js';

export interface SiteConfig {
  domain: string;
  spaceKey: string;
  parentPageId: string;
  parentPageName: string;
}

/**
 * Returns site config for the current test environment.
 * Parent page info now comes from the resolved app profile in test-config.
 */
export function getSmokeConfig(): SiteConfig {
  if (!testConfig.parentPageId) {
    throw new Error(
      `No parent page ID configured for domain: ${testConfig.domain}. ` +
      `Set APP env var or PARENT_PAGE_ID.`
    );
  }
  return {
    domain: testConfig.domain,
    spaceKey: testConfig.spaceKey,
    parentPageId: testConfig.parentPageId,
    parentPageName: testConfig.parentPageName,
  };
}
