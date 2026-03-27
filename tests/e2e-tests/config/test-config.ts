import { getAppProfile, APP_PROFILES, type AppProfile, type MacroType } from './apps.js';

export { TIMEOUTS } from './timeouts.js';
export type { MacroType } from './apps.js';

interface TestConfig {
  domain: string;
  spaceKey: string;
  existingPageId: string | undefined;
  parentPageId: string;
  parentPageName: string;
  isLite: boolean;
  isForge: boolean;
  macros: MacroType[];
  addonKey: string;
  sequenceMacroKey: string;
  customContentKey: string;
  appLabel: string;
  renderMacros: MacroType[];
  credentials: {
    username: string;
    password: string;
  };
  baseUrl: string;
  pageUrl(id: string): string;
  validate(): void;
}

function resolveProfile(): AppProfile {
  const app = process.env.APP;
  if (app) {
    return getAppProfile(app);
  }

  // Legacy env var fallback — construct a profile from individual env vars
  const domain = process.env.ZENUML_DOMAIN || 'zenuml-stg.atlassian.net';
  const spaceKey = process.env.ZENUML_SPACE || 'ZS';
  const isLite = process.env.IS_LITE === 'true';
  const isForge = process.env.IS_FORGE === 'true';

  // Look up site defaults (parentPageId, parentPageName) from known profiles
  const siteProfile = Object.values(APP_PROFILES).find(p => p.domain === domain);

  return {
    id: 'legacy',
    domain,
    spaceKey,
    parentPageId: siteProfile?.parentPageId || '',
    parentPageName: siteProfile?.parentPageName || 'Before release test pages',
    isLite,
    isForge,
    macros: ['sequence', 'graph', 'openapi', 'embed', 'mermaid'],
    addonKey: siteProfile?.addonKey ?? (isLite ? 'com.zenuml.confluence-addon-lite' : 'com.zenuml.confluence-addon'),
    sequenceMacroKey: siteProfile?.sequenceMacroKey ?? (isLite ? 'zenuml-sequence-macro-lite' : 'zenuml-sequence-macro'),
    customContentKey: siteProfile?.customContentKey ?? 'zenuml-content-sequence',
    appLabel: siteProfile?.appLabel ?? 'ZenUML for Confluence',
    renderMacros: siteProfile?.renderMacros ?? ['sequence', 'graph', 'openapi', 'embed', 'mermaid'],
  };
}

const profile = resolveProfile();

export const testConfig: TestConfig = {
  domain: profile.domain,
  spaceKey: profile.spaceKey,
  existingPageId: process.env.PAGE_ID,
  parentPageId: process.env.PARENT_PAGE_ID || profile.parentPageId,
  parentPageName: profile.parentPageName,
  isLite: profile.isLite,
  isForge: profile.isForge,
  macros: profile.macros,
  addonKey: profile.addonKey,
  sequenceMacroKey: profile.sequenceMacroKey,
  customContentKey: profile.customContentKey,
  appLabel: profile.appLabel,
  renderMacros: profile.renderMacros,

  credentials: {
    username: process.env.ZENUML_STAGE_USERNAME || '',
    password: process.env.ZENUML_STAGE_PASSWORD || '',
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
  },
};
