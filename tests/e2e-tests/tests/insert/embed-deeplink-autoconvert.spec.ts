import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { createPageAndSetup } from './insert-helpers.js';
import {
  pasteDeeplinkUntilConverted,
  readConversion,
  isEmbedMacro,
  embedDeeplinkUrl,
} from '../../helpers/embedDeeplink.js';

// PR #360 — pasting an embed deeplink (https://confluence.zenuml.com/d/<cloudId>/<contentId>)
// into the Confluence editor must autoConvert into the embed macro. This is the
// ONLY automated coverage of that paste→convert step; it cannot be exercised by
// the smoke-test (which inserts macros via the macro browser, not by pasting).
//
// Scope: the assertion under test is the AUTOCONVERT (paste → embed macro node
// carrying the pasted URL). The cloudId/contentId below need not resolve to a
// live diagram — the matcher fires on URL pattern, and rendering the embedded
// diagram is the embed macro's own concern (covered elsewhere). Using a fixed
// sample keeps the test hermetic (no dependency on a specific staging diagram).
const SAMPLE = embedDeeplinkUrl('c78e721e-957f-402c-9b70-1df2227c2739', '170721444');

// Only profiles whose macro set includes the embed macro (lite, full). Diagramly
// excludes 'embed' from its E2E axis (macro-key collision on the shared site) and
// asyncapi ships a different embed macro without this matcher, so both skip.
const skip = !testConfig.macros.includes('embed');

test.describe(`Embed deeplink autoConvert - ${testConfig.productType}`, () => {
  test.skip(skip, `Macro "embed" not in app profile [${testConfig.macros.join(', ')}]`);

  test('pasting a /d/ deeplink converts to the embed macro (not a smart-link)', async ({
    page,
  }) => {
    const variantLabel = testConfig.isLite ? ' Lite' : '';
    await createPageAndSetup(page, variantLabel);

    const conv = await pasteDeeplinkUntilConverted(page, SAMPLE);

    // THE assertion: the deeplink became the embed macro extension node. Its
    // presence is proof the autoConvert fired (a non-converting paste yields
    // only an anchor / card and isEmbedMacro is false — see the control test).
    expect(
      isEmbedMacro(conv),
      `expected a zenuml-embed-macro extension node, got ${JSON.stringify(conv)}`,
    ).toBe(true);
    // ...and it must be a macro, not a smart-link card.
    expect(conv.cardCount, 'converted to a smart-link card instead of the macro').toBe(0);
    // NOTE: we deliberately do NOT assert zero anchors here. Retrying the paste
    // until the async autoConvert matchers are live can leave a linkified-URL
    // anchor from a pre-readiness attempt (Confluence resolves the smart-link
    // asynchronously, sometimes after the editor is cleared). That residue is a
    // harness artifact; the embed-macro node above is the definitive signal.
  });

  // Negative control. Documents WHY the helper dispatches a paste event and not
  // keyboard.type(): typing only linkifies. If someone "simplifies" pasteDeeplink
  // into a type() call, this test flips (an embed macro would appear) and fails —
  // a tripwire against silently breaking the real coverage above.
  test('naive type+space produces a plain hyperlink, NOT the embed macro (control)', async ({
    page,
  }) => {
    const variantLabel = testConfig.isLite ? ' Lite' : '';
    await createPageAndSetup(page, variantLabel);

    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type(SAMPLE, { delay: 5 });
    await page.keyboard.press('Space');
    const conv = await readConversion(page);

    expect(isEmbedMacro(conv), 'typing must NOT trigger the macro autoConvert').toBe(false);
    expect(conv.anchorHrefs.length, 'typing a URL should linkify into an anchor').toBeGreaterThan(0);
  });
});
