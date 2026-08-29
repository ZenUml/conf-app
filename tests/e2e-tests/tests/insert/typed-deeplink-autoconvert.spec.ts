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

const CASES: TypeCase[] = [
  { segment: 'sequence', macroKey: testConfig.sequenceMacroKey, requires: 'sequence' },
  // Mermaid and PlantUML are rendered BY the sequence macro — one macro, three
  // URL shapes. This is the pairing that regressed: /new/mermaid routed to a
  // sequence editor, which is the right macro but the wrong starting type.
  { segment: 'mermaid', macroKey: testConfig.sequenceMacroKey, requires: 'mermaid' },
  { segment: 'graph', macroKey: GRAPH_KEY, requires: 'graph' },
  { segment: 'openapi', macroKey: OPENAPI_KEY, requires: 'openapi' },
  // Lite only, and only Lite's app profile lists 'asyncapi' — the macro exists
  // in Lite per ADR-0005 Option A, and full/diagramly delete the module while
  // the asyncapi variant keeps the macro but has its typed matchers stripped
  // (it ships no byline to mint them). Substring matching means the key below
  // also covers `zenuml-asyncapi-macro-lite`; it must NOT match the sibling
  // `zenuml-asyncapi-embed-macro`, which Lite strips and which claims only the
  // 3-segment /d/*/* embed form.
  { segment: 'asyncapi', macroKey: ASYNCAPI_KEY, requires: 'asyncapi' },
];

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
test.describe(`Typed diagram deeplink autoConvert - ${testConfig.productType}`, () => {
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
