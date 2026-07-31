import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { createPageAndSetup } from './insert-helpers.js';
import {
  pasteDeeplinkUntilConverted,
  isEmbedMacro,
  embedDeeplinkUrl,
} from '../../helpers/embedDeeplink.js';

// The content does not need to resolve for this matcher assertion; the test is
// specifically paste -> Forge embed extension node. Viewer loading has separate
// coverage.
const SAMPLE = embedDeeplinkUrl(
  testConfig.deeplinkHost,
  'c78e721e-957f-402c-9b70-1df2227c2739',
  '170721444',
);

const skip = !testConfig.macros.includes('embed');

test.describe(`Embed deeplink autoConvert - ${testConfig.productType}`, () => {
  test.skip(skip, `Macro "embed" not in app profile [${testConfig.macros.join(', ')}]`);

  test('pasting a /d/ deeplink converts to the embed macro (not a smart-link)', async ({
    page,
  }) => {
    const variantLabel = testConfig.isLite ? ' Lite' : '';
    await createPageAndSetup(page, variantLabel);

    const conv = await pasteDeeplinkUntilConverted(page, SAMPLE);

    expect(
      isEmbedMacro(conv),
      `expected a zenuml-embed-macro extension node, got ${JSON.stringify(conv)}`,
    ).toBe(true);
    expect(conv.cardCount, 'converted to a smart-link card instead of the macro').toBe(0);
  });

  // The type+space CONTROL leg ("typing must NOT autoconvert; it should
  // linkify") lives in the /pvt-autoconvert skill, NOT here. It asserts
  // Confluence's own linkify-on-type behavior, which varies by the editor
  // cohort the account is served: on 2026-07-31 it failed 3/3 for the CI
  // robot account on zenuml prod while passing for a human account on the
  // same site and for the same robot account on lite-stg (issue #430).
  // A per-account editor rollout is not something a hard CI gate can pin.
});
