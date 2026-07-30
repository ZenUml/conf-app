import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { createPageAndSetup } from './insert-helpers.js';
import {
  pasteDeeplinkUntilConverted,
  readConversion,
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
