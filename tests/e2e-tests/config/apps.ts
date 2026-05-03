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
  /** App label shown in macro description — used to disambiguate macros from different apps on the same site */
  appLabel: string;
  /** Macros to test in render project (API-created pages). May differ from `macros` when
   *  macro keys collide with another app on the same site — API-created pages can't target
   *  a specific Forge app, so Confluence falls back to the Connect app. */
  renderMacros: MacroType[];
  /**
   * Per-macro display name overrides. Keys are canonical base names; values are what
   * the macro is actually called in the Confluence macro browser for this profile.
   * Used when the macro was renamed (e.g., "Diagram (Mermaid, PlantUML & ZenUML)" →
   * "Diagram as Code" on the production ZenUML full Forge app).
   */
  macroNameOverrides?: Record<string, string>;
}

const ALL_MACROS: MacroType[] = ['sequence', 'graph', 'openapi', 'embed', 'mermaid'];
const NO_EMBED: MacroType[] = ['sequence', 'graph', 'openapi', 'mermaid'];

export const APP_PROFILES: Record<string, AppProfile> = {
  'zenuml-lite@stg': {
    id: 'zenuml-lite@stg',
    domain: 'lite-stg.atlassian.net',
    spaceKey: 'SD',
    parentPageId: '524297',
    parentPageName: 'Before release test pages',
    isLite: true,
    isForge: true,
    macros: ALL_MACROS,
    renderMacros: ALL_MACROS,
    addonKey: 'com.zenuml.confluence-addon-lite',
    sequenceMacroKey: 'zenuml-sequence-macro-lite',
    customContentKey: 'zenuml-content-sequence',
    appLabel: 'ZenUML for Confluence',
  },
  'zenuml-full@stg': {
    id: 'zenuml-full@stg',
    domain: 'full-stg.atlassian.net',
    spaceKey: 'SD',
    parentPageId: '229492',
    parentPageName: 'Software Development',
    isLite: false,
    isForge: true,
    macros: ALL_MACROS,
    renderMacros: ALL_MACROS,
    addonKey: 'com.zenuml.confluence-addon',
    sequenceMacroKey: 'zenuml-sequence-macro',
    customContentKey: 'zenuml-content-sequence',
    appLabel: 'ZenUML for Confluence',
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
    // graph/openapi/embed macro keys collide with Full Connect on this shared site.
    // API-created pages render with Connect, so Forge iframe assertions fail.
    // Insert tests still cover these macros end-to-end via UI insertion.
    renderMacros: ['sequence', 'mermaid'],
    addonKey: 'gptdock-confluence',
    sequenceMacroKey: 'gpt-diagram-macro',
    customContentKey: 'gpt-custom-content-key',
    appLabel: 'Diagramly for Confluence',
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
    renderMacros: ALL_MACROS,
    addonKey: 'com.zenuml.confluence-addon-lite',
    sequenceMacroKey: 'zenuml-sequence-macro-lite',
    customContentKey: 'zenuml-content-sequence',
    appLabel: 'ZenUML for Confluence',
  },
  'zenuml-full@prod': {
    id: 'zenuml-full@prod',
    domain: 'zenuml.atlassian.net',
    spaceKey: 'ZEN',
    parentPageId: '247136259',
    parentPageName: 'Test pages',
    isLite: false,
    isForge: true,
    macros: ALL_MACROS,
    renderMacros: ALL_MACROS,
    addonKey: 'com.zenuml.confluence-addon',
    sequenceMacroKey: 'zenuml-sequence-macro',
    customContentKey: 'zenuml-content-sequence',
    // On zenuml.atlassian.net, the Full app coexists with Lite and Diagramly.
    // appLabel disambiguates ZenUML for Confluence from Diagramly for Confluence.
    appLabel: 'ZenUML for Confluence',
  },
  'diagramly@prod': {
    id: 'diagramly@prod',
    // diagramly.atlassian.net only has the staging Forge app installed.
    // The production Diagramly Forge app is installed on zenuml.atlassian.net alongside Lite and Full.
    domain: 'zenuml.atlassian.net',
    spaceKey: 'ZEN',
    parentPageId: '247136259',
    parentPageName: 'Test pages',
    isLite: false,
    isForge: true,
    macros: NO_EMBED,
    renderMacros: NO_EMBED,
    addonKey: 'gptdock-confluence',
    sequenceMacroKey: 'gpt-diagram-macro',
    customContentKey: 'gpt-custom-content-key',
    appLabel: 'Diagramly for Confluence',
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
