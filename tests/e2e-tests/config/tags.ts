import { CATEGORIES, VARIANTS } from './categories.mjs';
import { FEATURES, INTERFACES, SCENARIOS } from './product-impact.mjs';
/**
 * The closed tag taxonomy every E2E spec carries (ADR-0007 §5).
 *
 * Descriptive axes: a spec declares at least one SURFACE tag, at least one TYPE or
 * CONCERN tag, and one or more BEHAVIOR tags on each of its top-level
 * `test.describe(...)` / `test(...)`
 * calls, as Playwright `{ tag: [...] }` details. `tests/unit/e2eTags.spec.ts`
 * polices both the closedness (no tag outside these lists) and the coverage
 * (no top-level block without them), the way `storyTitles.spec.ts` polices the
 * Storybook tree — a new tag is added HERE in the same commit, never invented
 * in a spec.
 *
 * SURFACE follows the UI-bearing values of `Surface` in
 * src/utils/analytics/catalog.ts (and CONTEXT.md), so one word names the same
 * thing in Mixpanel, in the Storybook sidebar and here. TYPE is `DiagramType`
 * plus `asyncapi`. CONCERN is the cross-cutting feature the spec pins.
 * BEHAVIOR names the existing journey categories used by main-branch selection.
 * Product scenario tags identify explicit feature/interface pairs for PR selection.
 *
 * PR decisions select explicit scenario pairs along with baseline coverage.
 * Missing scenario tags leave product coverage undiscoverable to that selector.
 */
export const SURFACE_TAGS = [
  '@viewer',
  '@editor',
  '@fullscreen',
  '@modal',
  '@byline',
  '@page-banner',
  '@dashboard',
  '@route',
] as const;

export const TYPE_TAGS = [
  '@sequence',
  '@mermaid',
  '@plantuml',
  '@graph',
  '@openapi',
  '@asyncapi',
  '@embed',
] as const;

export const CONCERN_TAGS = [
  // The release-smoke tier: one insert-and-render per macro type, one edit,
  // one embed paste. Always selected. Grows only when a release must not go
  // out without the test.
  '@smoke',
  '@paywall',
  '@deeplink',
  '@analytics',
  '@export',
  '@feedback',
  '@csat',
  // AI-facing features: Copy for AI, Agent Link, AI Repair.
  '@ai',
  // The Lite -> Full conversion pipeline.
  '@conversion',
  // The shared pan/zoom viewport: the zoom toolbar, drag-to-pan, wheel zoom and
  // the 1:1 ceiling. Cross-cutting because one control drives three engines --
  // svg-pan-zoom for Mermaid/PlantUML, mxGraph for Graph, a CSS transform for
  // Sequence -- so a change to any of them needs the same specs.
  '@viewport',
] as const;

// Existing category selectors remain in use for main-branch Jev planning.
// PR selection uses explicit scenario tags, not independent dimension tags.
export const BEHAVIOR_TAGS: string[] = CATEGORIES.map((c) => `@test:${c.id}`);
export const EXECUTION_SELECTOR_TAGS: readonly string[] = BEHAVIOR_TAGS;
export const VARIANT_TAGS: string[] = VARIANTS.map((v) => `@variant:${v}`);

export const FEATURE_TAGS: string[] = FEATURES.map((id: string) => `@feature:${id}`);
export const INTERFACE_TAGS: string[] = INTERFACES.map((id: string) => `@interface:${id}`);
export const SCENARIO_TAGS: string[] = SCENARIOS.map(({ feature, interface: surface }: { feature: string; interface: string }) => `@scenario:${feature}:${surface}`);

// Check kind and execution host describe evidence, not product scope.
export const CHECK_TAGS = ['@check:component', '@check:adapter', '@check:host-contract', '@check:orchestration', '@check:negative-regression', '@status:retired', '@execution:preview', '@execution:opt-in'];

export const ALL_TAGS: readonly string[] = [...SURFACE_TAGS, ...TYPE_TAGS, ...CONCERN_TAGS, ...BEHAVIOR_TAGS, ...VARIANT_TAGS, ...FEATURE_TAGS, ...INTERFACE_TAGS, ...SCENARIO_TAGS, ...CHECK_TAGS];
