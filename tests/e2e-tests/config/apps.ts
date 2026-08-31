/**
 * Macro types that can be created through the REST API, and therefore have a
 * fixture page in the render suite. `utils/page-registry.ts` (which page id) and
 * `utils/page-creator.ts` (which emoji) are both keyed on exactly this set.
 */
export type RenderMacroType = 'sequence' | 'graph' | 'openapi' | 'embed' | 'mermaid';

/**
 * Every macro an app profile can claim to ship.
 *
 * Derived from RenderMacroType rather than re-listed, so the two can never drift
 * — which is exactly how adding 'asyncapi' broke things: page-registry.ts kept
 * its OWN hardcoded copy of the five, `macro-test.ts` aliased this type to it,
 * and widening one made the assignment fail. AsyncAPI is UI-only (no API-created
 * fixture: Studio owns the document), so it belongs here and NOT in
 * RenderMacroType.
 */
export type MacroType = RenderMacroType | 'asyncapi';

/** Same axis as `PRODUCT_TYPE` in Vite / `scripts/forge-wizard.mjs` (`lite` | `full` | `diagramly` | `asyncapi`). */
export type ProductType = 'lite' | 'full' | 'diagramly' | 'asyncapi';

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
  /** Build / Forge product variant — mirrors `PRODUCT_TYPE`. */
  productType: ProductType;
  /** Whether this is a Forge app (vs Connect) */
  isForge: boolean;
  /**
   * The Full app is co-installed on this site's tenant.
   *
   * True only for the @prod profiles, which all share zenuml.atlassian.net —
   * our dogfood tenant carries Lite, Full, and Diagramly at once. It matters to
   * the Lite `zenuml-byline-diagrams` byline: that entry's display condition
   * (manifest.yml) hides itself wherever Full marks its presence
   * (`zenuml-full-active`, written by Full's `full-presence-daily` sweep —
   * src/full-presence.ts), so the byline is BY DESIGN dark on this site and its
   * create/paywall specs cannot open it. Specs that drive the byline skip when
   * this is set. Absent (stg/dev Lite profiles) means a Lite-only tenant where
   * the byline renders normally.
   */
  fullCoinstalled?: boolean;
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
// Lite ships the AsyncAPI macro (ADR-0005 Option A); full/diagramly/zenuml
// strip it, so it is NOT in ALL_MACROS. Deliberately absent from `renderMacros`
// too: the render suite builds its pages through the API, and no API-created
// AsyncAPI fixture exists — the macro's coverage is UI-driven (tests/asyncapi/,
// tests/insert/byline-asyncapi.spec.ts).
//
// Safe to widen this axis because nothing ITERATES it: every consumer is an
// `.includes(...)` skip guard, so adding a member enables only the specs that
// name it.
//
// Applied to every Lite profile, prod included. Prod was held on ALL_MACROS
// until the macro actually shipped — a prod run would otherwise have looked for
// a macro that install did not have and failed for the wrong reason — and
// v2026.08.301404-lite (2026-08-30) lifted that: the release's own
// `manifest-lite-prod` artifact carries `zenuml-asyncapi-macro${LITE_KEY_SUFFIX}`.
//
// What moving prod over does and does not turn on, because the two asyncapi
// specs gate differently:
//   - tests/insert/typed-deeplink-autoconvert.spec.ts DOES start running its
//     asyncapi case. That case has no guard but this axis, and release.yml runs
//     `suite: insert` against zenuml-lite@prod as the post-release smoke. It is
//     not redundant with staging: matcher routing lives in the DEPLOYED
//     manifest, so only a prod run proves the 4-segment typed link is not
//     swallowed by the embed macro's 3-segment /d/*/* there.
//   - tests/insert/byline-asyncapi.spec.ts does NOT. It skips earlier on
//     `fullCoinstalled`, and zenuml.atlassian.net — our only prod Lite site —
//     carries Full, whose `zenuml-full-active` property hides the Lite byline
//     by design. No macro axis can reach it; that needs a Lite-only tenant.
const LITE_MACROS: MacroType[] = [...ALL_MACROS, 'asyncapi'];

export const APP_PROFILES: Record<string, AppProfile> = {
  'zenuml-lite@stg': {
    id: 'zenuml-lite@stg',
    domain: 'lite-stg.atlassian.net',
    spaceKey: 'SD',
    parentPageId: '524297',
    parentPageName: 'Before release test pages',
    isLite: true,
    productType: 'lite',
    isForge: true,
    macros: LITE_MACROS,
    renderMacros: ALL_MACROS,
    addonKey: 'com.zenuml.confluence-addon-lite',
    sequenceMacroKey: 'zenuml-sequence-macro-lite',
    customContentKey: 'zenuml-content-sequence',
    appLabel: 'ZenUML for Confluence',
  },
  'zenuml-lite@dev': {
    id: 'zenuml-lite@dev',
    domain: 'lite-dev.atlassian.net',
    spaceKey: 'SD',
    // Space homepage (id 196866) — stable parent for test pages.
    parentPageId: '196866',
    parentPageName: 'Software Development',
    isLite: true,
    productType: 'lite',
    isForge: true,
    macros: LITE_MACROS,
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
    productType: 'full',
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
    productType: 'diagramly',
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
  // Single-purpose AsyncAPI variant. Doesn't ship the ZenUML/Mermaid/Graph/
  // OpenAPI macro family, so the `macros` axis is empty — tests that loop
  // ALL_MACROS skip automatically via testConfig.macros.includes(...). The
  // current asyncapi e2e is a single space-page-loads smoke (see
  // tests/asyncapi/), and it discovers the space at runtime, so the
  // `spaceKey` here is only a fallback for future expansion.
  'asyncapi@stg': {
    id: 'asyncapi@stg',
    domain: 'asyncapi-stg.atlassian.net',
    spaceKey: 'ZEN',
    parentPageId: '',
    parentPageName: '',
    isLite: false,
    productType: 'asyncapi',
    isForge: true,
    macros: [],
    renderMacros: [],
    addonKey: 'my-api',
    sequenceMacroKey: 'zenuml-asyncapi-macro',
    customContentKey: 'async-api-doc',
    appLabel: 'AsyncAPI for Confluence',
  },
  'zenuml-lite@prod': {
    id: 'zenuml-lite@prod',
    domain: 'zenuml.atlassian.net',
    spaceKey: 'ZEN',
    parentPageId: '247136259',
    parentPageName: 'Test pages',
    isLite: true,
    productType: 'lite',
    isForge: true,
    // Full + Diagramly are installed alongside Lite here; the Lite Diagrams
    // byline is suppressed by design (see fullCoinstalled on AppProfile).
    fullCoinstalled: true,
    macros: LITE_MACROS,
    // NOT LITE_MACROS: the render suite builds its pages through the API and
    // there is no API-created AsyncAPI fixture (Studio owns the document),
    // which is why RenderMacroType excludes 'asyncapi' in the first place.
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
    productType: 'full',
    isForge: true,
    fullCoinstalled: true,
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
    productType: 'diagramly',
    isForge: true,
    fullCoinstalled: true,
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
