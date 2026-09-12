import { test, expect } from '@playwright/test';
import { testConfig, type MacroType } from '../../config/test-config.js';
import { createPageAndSetup } from './insert-helpers.js';
import {
  pasteUntil,
  isMacro,
  isEmbedMacro,
  typedDeeplinkUrl,
  newDiagramUrl,
  type EditorConversion,
} from '../../helpers/embedDeeplink.js';

/**
 * Paste-to-place: the byline's create path hands the user a URL, and pasting it
 * must produce the ORDINARY, EDITABLE macro of the picked type.
 *
 * Every assertion here is a manifest-matcher assertion, the same class as
 * embed-deeplink-autoconvert.spec.ts: the target content never has to resolve,
 * because autoConvert matching is editor-local. What is being pinned is the
 * routing — which macro claims which URL shape — and that is exactly what has
 * broken before. On lite-stg a picked "Flowchart" produced a sequence diagram,
 * and a `/new/mermaid` paste opened a sequence editor, because the URL shape and
 * the macro that handled it had drifted apart.
 *
 * ONE live case, not one per type (ADR-0006, "equivalent lower-cost tests").
 * The routing table is a property of manifest.yml's `autoConvert.matchers`, and
 * tests/unit/typedDeeplinkRouting.spec.ts pins it for every type the code can
 * mint — owner macro, exclusivity, minted host and shape, and the 3- vs
 * 4-segment split from the embed macro — in milliseconds. What a unit test
 * cannot prove is Confluence's side of the contract: that a matcher's star is
 * one segment and that a matching paste really becomes an extension node in
 * the current editor. One type is enough to keep that canary alive; five
 * copies of it cost five page creations across two Lite E2E shards
 * (typed-deeplink-autoconvert ×5 was the whole of shards 7–8 under the 10-way
 * split of 2026-09-11) and caught nothing the first did not.
 *
 * The type+space CONTROL leg ("typing must NOT convert") is deliberately absent
 * — see the note in embed-deeplink-autoconvert.spec.ts; Confluence's
 * linkify-on-type behavior varies by per-account editor cohort and cannot be a
 * hard CI gate.
 */

// Any well-formed ids work: matching is on URL SHAPE, with no lookup. Using an
// obviously-fake content id keeps that explicit — if this ever starts depending
// on the content existing, the test is asserting the wrong thing.
const CLOUD = 'c78e721e-957f-402c-9b70-1df2227c2739';
const CONTENT = '170721444';

/** Unsuffixed macro keys; isMacro() substring-matches so Lite's `-lite` fits. */
const GRAPH_KEY = 'zenuml-graph-macro';
const OPENAPI_KEY = 'zenuml-openapi-macro';
const ASYNCAPI_KEY = 'zenuml-asyncapi-macro';

interface TypeCase {
  /** URL path segment, and the label the byline tile carries. */
  segment: string;
  macroKey: string;
  /** The app-profile macro this variant must ship for the case to apply. */
  requires: MacroType;
}

// The live canary. `graph` rather than `sequence` because it is the type whose
// 4-segment link sits closest to the embed macro's 3-segment `/d/*/*` claim in
// day-to-day use (graphs are what the byline places most), so it is the case
// where Confluence swallowing the typed form into a read-only embed would hurt
// first. The other types — mermaid/plantuml on the sequence macro, openapi,
// asyncapi — differ from this one only in which key the manifest lists, and
// tests/unit/typedDeeplinkRouting.spec.ts pins each of those. To re-run a type
// against live Confluence ad hoc, add it back to CASES locally; keep CI at one.
const CASES: TypeCase[] = [
  { segment: 'graph', macroKey: GRAPH_KEY, requires: 'graph' },
];
// Kept so an ad hoc local run can list them without re-deriving the keys.
void OPENAPI_KEY;
void ASYNCAPI_KEY;

function describeConversion(conv: EditorConversion): string {
  return JSON.stringify({
    extensionKeys: conv.extensionKeys,
    cardCount: conv.cardCount,
    anchorHrefs: conv.anchorHrefs,
  });
}

// Both URL shapes for one type share a page. pasteUntil clears the editor
// before every attempt, so a second paste starts from an empty document — and
// page creation is the expensive part of this suite, not the paste.
// LITE ONLY. scripts/forge-wizard.mjs:236-238 (mirrored in release.yml and
// staging-deploy.yml) deletes these matchers from full/diagramly/asyncapi: only
// Lite ships the byline that mints the links, and identical patterns in two
// installed apps would let the wrong app claim a pasted URL, leaving an
// unreadable app-scoped custom content behind a /d/ link. Diagramly still ships
// the graph and openapi macros, so the per-case macro guard below does NOT skip
// there — the paste stays a plain link, Confluence's link toolbar covers the
// editor, and the next click times out at 60s. That reaped Diagramly's shard at
// the 8-minute job cap three runs in a row on 2026-08-16 (run 31937067487).
test.describe(`Typed diagram deeplink autoConvert - ${testConfig.productType}`, { tag: ['@editor', '@graph', '@deeplink'] }, () => {
  for (const c of CASES) {
    const applies = testConfig.isLite && testConfig.macros.includes(c.requires);

    test(`/d/${c.segment}/ and /new/${c.segment} both convert to the ${c.segment} macro`, async ({
      page,
    }) => {
      test.skip(
        !applies,
        testConfig.isLite
          ? `Macro "${c.requires}" not in app profile [${testConfig.macros.join(', ')}]`
          : `Typed deeplink matchers are stripped for ${testConfig.productType} (Lite-only byline)`,
      );
      const editorPage = await createPageAndSetup(page, testConfig.isLite ? ' Lite' : '');
      expect(editorPage, 'editor did not open').toBeTruthy();

      // Place an EXISTING diagram — the link the byline hands back after a save.
      const placeUrl = typedDeeplinkUrl(c.segment, CLOUD, CONTENT);
      const placed = await pasteUntil(page, placeUrl, (x) => isMacro(x, c.macroKey));

      expect(
        isMacro(placed, c.macroKey),
        `expected a ${c.macroKey} extension node from ${placeUrl}, got ${describeConversion(placed)}`,
      ).toBe(true);

      // The whole design rests on segment count: a matcher's * covers exactly
      // one segment, so the 4-segment typed form must never be swallowed by the
      // embed macro's 3-segment /d/*/*. If it is, the diagram is placed as a
      // read-only embed that can never be edited again — the bug this URL shape
      // exists to avoid.
      expect(
        isEmbedMacro(placed),
        `typed link was claimed by the EMBED macro — placed diagram would be read-only: ${describeConversion(placed)}`,
      ).toBe(false);

      expect(placed.cardCount, 'converted to a smart-link card instead of the macro').toBe(0);

      // Create a NEW diagram of this type — the link for the empty-page path.
      const createUrl = newDiagramUrl(c.segment);
      const created = await pasteUntil(page, createUrl, (x) => isMacro(x, c.macroKey));

      expect(
        isMacro(created, c.macroKey),
        `expected a ${c.macroKey} extension node from ${createUrl}, got ${describeConversion(created)}`,
      ).toBe(true);
      expect(created.cardCount, 'converted to a smart-link card instead of the macro').toBe(0);
    });
  }
});
