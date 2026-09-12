/**
 * The closed tag taxonomy every E2E spec carries (ADR-0007 §5).
 *
 * Three axes. A spec declares at least one SURFACE tag and at least one TYPE
 * or CONCERN tag on each of its top-level `test.describe(...)` / `test(...)`
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
 *
 * Why the tags exist: the impact-based test selection on PRs maps changed
 * source paths to these tags and runs only the specs that carry them (always
 * plus `@smoke`, and everything when a shared file changed). A tag that is
 * missing on a spec means that spec is never selected for the change it
 * covers — which is why the policing test is not optional.
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
] as const;

export const ALL_TAGS: readonly string[] = [...SURFACE_TAGS, ...TYPE_TAGS, ...CONCERN_TAGS];
