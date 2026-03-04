export type MacroType = 'sequence' | 'graph' | 'openapi' | 'embed' | 'mermaid';

export interface AppProfile {
  /** Unique identifier: <app>@<env> */
  id: string;
  /** Confluence site domain */
  domain: string;
  /** Confluence space key */
  spaceKey: string;
  /** Parent page ID for smoke test page creation */
  parentPageId: string;
  /** Parent page name for URL construction */
  parentPageName: string;
  /** Whether this is the Lite variant */
  isLite: boolean;
  /** Whether this is a Forge app (vs Connect) */
  isForge: boolean;
  /** Supported macro types for this app */
  macros: MacroType[];
  /** Addon key for custom content type construction */
  addonKey: string;
  /** Sequence macro extension key (e.g. 'gpt-diagram-macro' or 'zenuml-sequence-macro-lite') */
  sequenceMacroKey: string;
  /** Custom content key (e.g. 'gpt-custom-content-key' or 'zenuml-content-sequence') */
  customContentKey: string;
}

const ALL_MACROS: MacroType[] = ['sequence', 'graph', 'openapi', 'embed', 'mermaid'];
const NO_EMBED: MacroType[] = ['sequence', 'graph', 'openapi', 'mermaid'];

export const APP_PROFILES: Record<string, AppProfile> = {
  'zenuml-lite@stg': {
    id: 'zenuml-lite@stg',
    domain: 'zenuml-stg.atlassian.net',
    spaceKey: 'ZS',
    parentPageId: '177176629',
    parentPageName: 'Before release test pages',
    isLite: true,
    isForge: true,
    macros: ALL_MACROS,
    addonKey: 'com.zenuml.confluence-addon-lite',
    sequenceMacroKey: 'zenuml-sequence-macro-lite',
    customContentKey: 'zenuml-content-sequence',
  },
  'zenuml-full@stg': {
    id: 'zenuml-full@stg',
    domain: 'zenuml-stg.atlassian.net',
    spaceKey: 'ZS',
    parentPageId: '177176629',
    parentPageName: 'Before release test pages',
    isLite: false,
    isForge: false,
    macros: ALL_MACROS,
    addonKey: 'com.zenuml.confluence-addon',
    sequenceMacroKey: 'zenuml-sequence-macro',
    customContentKey: 'zenuml-content-sequence',
  },
  'diagramly@stg': {
    id: 'diagramly@stg',
    domain: 'dia-stg.atlassian.net',
    spaceKey: 'SD',
    parentPageId: '1736705',
    parentPageName: 'Test pages',
    isLite: false,
    isForge: true,
    macros: NO_EMBED,
    addonKey: 'gptdock-confluence',
    sequenceMacroKey: 'gpt-diagram-macro',
    customContentKey: 'gpt-custom-content-key',
  },
  'zenuml-lite@prod': {
    id: 'zenuml-lite@prod',
    domain: 'zenuml.atlassian.net',
    spaceKey: 'ZEN',
    parentPageId: '247136259',
    parentPageName: 'Test pages',
    isLite: true,
    isForge: true,
    macros: ALL_MACROS,
    addonKey: 'com.zenuml.confluence-addon-lite',
    sequenceMacroKey: 'zenuml-sequence-macro-lite',
    customContentKey: 'zenuml-content-sequence',
  },
  'zenuml-full@prod': {
    id: 'zenuml-full@prod',
    domain: 'zenuml.atlassian.net',
    spaceKey: 'ZEN',
    parentPageId: '247136259',
    parentPageName: 'Test pages',
    isLite: false,
    isForge: false,
    macros: ALL_MACROS,
    addonKey: 'com.zenuml.confluence-addon',
    sequenceMacroKey: 'zenuml-sequence-macro',
    customContentKey: 'zenuml-content-sequence',
  },
  'diagramly@prod': {
    id: 'diagramly@prod',
    domain: 'diagramly.atlassian.net',
    spaceKey: 'TEAM',
    parentPageId: '205422593',
    parentPageName: 'Test pages',
    isLite: false,
    isForge: true,
    macros: NO_EMBED,
    addonKey: 'gptdock-confluence',
    sequenceMacroKey: 'gpt-diagram-macro',
    customContentKey: 'gpt-custom-content-key',
  },
};

export function getAppProfile(appId: string): AppProfile {
  const profile = APP_PROFILES[appId];
  if (!profile) {
    const valid = Object.keys(APP_PROFILES).join(', ');
    throw new Error(`Unknown APP profile: "${appId}". Valid profiles: ${valid}`);
  }
  return profile;
}
