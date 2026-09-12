/**
 * Paste-to-place routing, pinned from the manifest instead of a Confluence editor.
 *
 * The byline hands the user a typed deeplink (`/new/<type>` to create,
 * `/d/<type>/<cloudId>/<contentId>` to place an existing diagram) and pasting it
 * must produce the ORDINARY, EDITABLE macro of that type. Confluence decides
 * which macro claims a pasted URL purely from `autoConvert.matchers` in
 * manifest.yml — matching is editor-local and never resolves the URL — so the
 * whole routing table is a property of the manifest text, and that is what
 * this spec asserts:
 *
 *   1. every type's two URL shapes are claimed by exactly one macro, and it is
 *      the macro that edits that type (mermaid and plantuml are rendered BY the
 *      sequence macro — the pairing that once regressed, when `/new/mermaid`
 *      routed to the wrong macro);
 *   2. the embed macro keeps only the 3-segment `/d/<cloudId>/<contentId>`
 *      form: a matcher's star covers exactly one path segment, so the
 *      4-segment typed form can never be swallowed into a read-only embed;
 *   3. the link the code MINTS (`buildDiagramDeeplink`) is on the host and in
 *      the shape the matcher is written against — mint a host the matchers
 *      don't list and the paste silently stays a link.
 *
 * tests/e2e-tests/tests/insert/typed-deeplink-autoconvert.spec.ts used to
 * prove all of this by pasting every type into a live lite-stg editor: five
 * page creations, two shards' worth of the Lite E2E. Its assertions were the
 * same manifest-matcher facts, so it now keeps ONE live case as the canary for
 * Confluence's matcher semantics and this file carries the table. Only Lite
 * ships these matchers (scripts/forge-wizard.mjs strips them elsewhere), which
 * is why the source manifest — Lite's shape — is the right thing to read.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { DEEPLINK_TYPES, buildDiagramDeeplink } from '../../src/utils/embedDeeplink';

interface MacroModule {
  key: string;
  autoConvert?: { matchers?: Array<{ pattern: string }> };
}

const manifest = load(readFileSync(resolve(__dirname, '../../manifest.yml'), 'utf8')) as {
  modules: { macro: MacroModule[] };
};
const macros = manifest.modules.macro;

/** Unsuffixed key; the manifest templates `${LITE_KEY_SUFFIX}` onto it. */
const EXPECTED_OWNER: Record<string, string> = {
  sequence: 'zenuml-sequence-macro',
  mermaid: 'zenuml-sequence-macro',
  plantuml: 'zenuml-sequence-macro',
  graph: 'zenuml-graph-macro',
  openapi: 'zenuml-openapi-macro',
  asyncapi: 'zenuml-asyncapi-macro',
};

const HOST = 'https://confluence.zenuml.com';

/**
 * A macro key as the manifest templates it, reduced to its Full-variant bare
 * form: `${SEQUENCE_MACRO_KEY}` is what the diagram macro is called (the
 * per-variant deploy scripts in package.json substitute zenuml-sequence-macro
 * or gpt-diagram-macro), and `${LITE_KEY_SUFFIX}` is Lite's `-lite`.
 */
function bareKey(key: string): string {
  return key.replace('${SEQUENCE_MACRO_KEY}', 'zenuml-sequence-macro').replace('${LITE_KEY_SUFFIX}', '');
}

/** Every macro that lists `pattern`, by bare key. */
function claimants(pattern: string): string[] {
  return macros
    .filter((m) => (m.autoConvert?.matchers ?? []).some((x) => x.pattern === pattern))
    .map((m) => bareKey(m.key));
}

/** A matcher pattern as the regex Confluence applies: `*` is one segment. */
function matcherRegex(pattern: string): RegExp {
  return new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+') + '$');
}

describe('typed deeplink routing (manifest autoConvert matchers)', () => {
  it('the spec covers every type the code can mint, and only those', () => {
    expect(Object.keys(EXPECTED_OWNER).sort()).toEqual([...DEEPLINK_TYPES].sort());
  });

  for (const [type, owner] of Object.entries(EXPECTED_OWNER)) {
    it(`/new/${type} and /d/${type}/<cloudId>/<contentId> are both claimed by ${owner} and by nothing else`, () => {
      expect(claimants(`${HOST}/new/${type}`)).toEqual([owner]);
      expect(claimants(`${HOST}/d/${type}/*/*`)).toEqual([owner]);
    });

    it(`the minted /d/${type} link matches its own matcher and no other macro's`, () => {
      const link = buildDiagramDeeplink(type, 'c78e721e-957f-402c-9b70-1df2227c2739', '170721444');
      expect(link).toBeDefined();
      const matching = macros
        .filter((m) => (m.autoConvert?.matchers ?? []).some((x) => matcherRegex(x.pattern).test(link!)))
        .map((m) => bareKey(m.key));
      expect(matching).toEqual([owner]);
    });
  }

  it('the embed macro claims only 3-segment /d/ forms — never a typed 4-segment link', () => {
    const embed = macros.find((m) => m.key.startsWith('zenuml-embed-macro'));
    expect(embed, 'embed macro present').toBeDefined();
    const patterns = (embed!.autoConvert?.matchers ?? []).map((x) => x.pattern);
    expect(patterns.length).toBeGreaterThan(0);
    for (const p of patterns) {
      expect(p, 'embed matcher shape').toMatch(/^https:\/\/[^/]+\/d\/\*\/\*$/);
    }
    // And the 4-segment typed link really does fall outside them.
    const typed = buildDiagramDeeplink('graph', 'c78e721e-957f-402c-9b70-1df2227c2739', '170721444')!;
    for (const p of patterns) expect(matcherRegex(p).test(typed)).toBe(false);
  });

  it('a /new/<type> link is not claimed by the embed macro either', () => {
    for (const type of DEEPLINK_TYPES) {
      expect(claimants(`${HOST}/new/${type}`)).not.toContain('zenuml-embed-macro');
    }
  });
});
