/**
 * AsyncAPI in the Lite byline, end to end: pick the tile, save a spec, paste the
 * link it hands back, and see the spec render on another page.
 *
 * Three things here are only assertable against a real Confluence, and each one
 * broke a sibling type before:
 *
 *  1. **Routing.** A byline modal carries `moduleKey: 'zenuml-byline-diagrams'`,
 *     so every moduleKey discriminator in forgeIndex misses and
 *     `modal.diagramType` is the ONLY signal left. An unrecognised value falls
 *     through to the sequence/swagger branch rather than erroring, so picking
 *     AsyncAPI and getting an OpenAPI document is a silent, saveable outcome.
 *     Unit tests pin which string the tile passes; only this pins what Forge
 *     does with it.
 *  2. **The paste link is real.** `buildDiagramDeeplink` returning a URL proves
 *     nothing about whether any macro claims it — matcher routing lives in the
 *     deployed manifest, not in the bundle. typed-deeplink-autoconvert.spec.ts
 *     covers the shape for a synthetic id; this covers the id the byline
 *     actually minted.
 *  3. **The pasted macro resolves its content.** A macro created by autoConvert
 *     has NO `config`: its id exists only in the matched URL. Both AsyncAPI
 *     entries read `config`/`modal` directly until this change routed them
 *     through `resolveEffectiveCustomContentId` — the same omission that made a
 *     pasted graph render a permanently empty canvas (see
 *     typed-deeplink-render.spec.ts). A visible iframe does NOT catch it: the
 *     load-failed panel is inside that iframe too, which is why the assertion
 *     below is on the spec's own `info.title`.
 */
import { test, expect } from '@playwright/test';
import { testConfig, TIMEOUTS } from '../../config/test-config.js';
import { AUTH_STATE_PATH } from '../../config/auth-state.js';
import { createPageAndSetup, publishAndVerifyMacros } from './insert-helpers.js';
import { expectVisibleOrFailOnLogin } from '../../helpers/authGuard.js';
import { setAppMocks } from '../../helpers/pageBanner.js';
import { openBylineModal, createAsyncApiDiagramFromByline } from '../../helpers/byline.js';
import { pasteUntil, isMacro, isEmbedMacro } from '../../helpers/embedDeeplink.js';

const MACRO_IFRAME =
  '[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]';

// Same reasoning as byline-create.spec.ts: staging spaces drift past 100 macros
// as other suites create them, and a paywall firing mid-create would fail this
// for a reason it is not about. mockSpacePaid stays false so a licensed space
// cannot mask a gate that should not fire anyway.
const UNDER_LIMIT_MOCKS = {
  mockMacroCount: '3',
  mockCSSEnabled: 'true',
  mockSpacePaid: 'false',
};

/** 4-segment typed form. The 3-segment `/d/<cloudId>/<id>` pastes as a
 *  read-only embed, so the segment count IS the assertion. */
const TYPED_ASYNCAPI_LINK = /^https:\/\/[^/]+\/d\/asyncapi\/[^/]+\/\d+$/;

/** Substring-matched, so it also covers Lite's `zenuml-asyncapi-macro-lite`.
 *  Does not match the sibling `zenuml-asyncapi-embed-macro` — the `-embed-`
 *  segment breaks the substring — which is what keeps the check below honest. */
const ASYNCAPI_MACRO_KEY = 'zenuml-asyncapi-macro';

/** `info.title` of forge-asyncapi-editor's DEFAULT_ASYNCAPI_SPEC. Studio mirrors
 *  it onto the custom-content title and the viewer renders it, so it is the one
 *  string that proves the whole chain resolved rather than an iframe existing. */
const DEFAULT_SPEC_TITLE = 'Example AsyncAPI';

test.describe.serial(`Byline AsyncAPI create + place - ${testConfig.productType}`, () => {
  test.skip(!testConfig.isForge, 'byline is Forge-only');
  test.skip(!testConfig.isLite, 'the Diagrams byline entry ships on Lite only');
  test.skip(
    testConfig.fullCoinstalled,
    'Full co-installed: the Lite Diagrams byline is hidden by design (zenuml-full-active), so it cannot be opened here',
  );
  test.skip(
    !testConfig.macros.includes('asyncapi'),
    'AsyncAPI macro not in this app profile (Lite ships it per ADR-0005 Option A)',
  );

  let pageId: string;
  /** Minted by the create test, consumed by the paste test. */
  let pasteLink: string | undefined;

  test.beforeAll(async ({ browser }) => {
    // One published macro, for the same two reasons as byline-create: it gives
    // the byline something to list, and it guarantees an app-origin frame exists
    // to seed the mocks into.
    const variantLabel = testConfig.isLite ? ' Lite' : '';
    const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
    const setupPage = await context.newPage();
    try {
      const editorPage = await createPageAndSetup(setupPage, variantLabel);
      await editorPage.dismissLearnTheBasicsPanel();
      const macroName = editorPage.getMacroName('Diagram (Mermaid, PlantUML & ZenUML)');
      await editorPage.clickInsertElements();
      await editorPage.searchAndSelectMacro('diagram', macroName);
      await editorPage.interactWithDiagramMacro(`Byline AsyncAPI${variantLabel}`);
      pageId = await publishAndVerifyMacros(setupPage, editorPage, 1, 'byline-asyncapi-setup');
    } finally {
      await context.close();
    }
    expect(pageId, 'beforeAll must publish a macro page').toBeTruthy();
  });

  test('offers an AsyncAPI tile and hands back a typed asyncapi deeplink', async ({ page }) => {
    // Page load, byline modal, Studio boot, save, and a re-read of the page.
    test.slow();

    await page.goto(testConfig.pageUrl(pageId));
    await expectVisibleOrFailOnLogin(page, page.locator(MACRO_IFRAME).first(), TIMEOUTS.FRAME_LOAD);
    await setAppMocks(page, UNDER_LIMIT_MOCKS);
    await page.reload();
    await expectVisibleOrFailOnLogin(page, page.locator(MACRO_IFRAME).first(), TIMEOUTS.FRAME_LOAD);

    const byline = await openBylineModal(page);
    await expect(byline.locator('[data-testid="byline-diagrams"]')).toBeVisible({ timeout: 15000 });

    // The tile itself. Asserted separately from the create below because a
    // missing tile and a tile whose editor fails are different bugs, and the
    // create step's failure message would not distinguish them.
    //
    // `.first()`: the type list renders in up to two places at once — the
    // full-picker layout and the "Add a diagram" chip strip that sits alongside
    // the list — and this page has a diagram, so both the list and the strip are
    // up. Without it Playwright's strict mode fails on the duplicate rather than
    // on anything about AsyncAPI.
    //
    // The tile's LABEL is asserted, not its sample image: only the picker layout
    // carries `typerow__example`, and the chip strip this page shows has none.
    // The per-type sample src is pinned in BylineDiagrams.spec.ts, which renders
    // the empty state and can see all five.
    const tile = byline.locator('[data-testid="byline-type-asyncapi"]').first();
    await expect(tile, 'the byline picker offered no AsyncAPI tile').toBeVisible({
      timeout: 15000,
    });
    await expect(tile, 'the AsyncAPI tile is not labelled from typeLabel()').toContainText(
      'AsyncAPI',
    );

    await createAsyncApiDiagramFromByline(page, byline);

    await expect(
      byline.locator('[data-testid="byline-created"]'),
      'saving in the byline AsyncAPI editor produced no paste link',
    ).toBeVisible({ timeout: 90000 });

    const link = (await byline.locator('[data-testid="byline-created-link"]').innerText()).trim();
    // Two separate failure modes, hence two assertions: a type missing from
    // DEEPLINK_TYPES yields no link at all, while the 3-segment fallback that
    // preceded the typed form produced `.../d/<id>/undefined` — always truthy,
    // so it looked like success and pasted as a read-only embed.
    expect(link, `unexpected paste link: ${link}`).toMatch(TYPED_ASYNCAPI_LINK);
    expect(link).not.toContain('undefined');

    pasteLink = link;
    console.log(`  ✓ byline minted: ${link}`);
  });

  test('pasting that link places an AsyncAPI macro that renders the saved spec', async ({
    page,
  }) => {
    test.slow();
    test.skip(!pasteLink, 'the create test minted no link to paste');

    const editorPage = await createPageAndSetup(page, testConfig.isLite ? ' Lite' : '');
    const conv = await pasteUntil(page, pasteLink!, (x) => isMacro(x, ASYNCAPI_MACRO_KEY));

    expect(
      isMacro(conv, ASYNCAPI_MACRO_KEY),
      `paste did not convert to the AsyncAPI macro: ${JSON.stringify(conv)}`,
    ).toBe(true);
    // The whole design rests on segment count — a matcher's `*` covers exactly
    // one segment — so the 4-segment typed link must never be swallowed by the
    // embed macro's 3-segment `/d/*/*`. If it is, the spec is placed read-only
    // and can never be edited again.
    expect(
      isEmbedMacro(conv),
      `typed link was claimed by the EMBED macro — the spec would be read-only: ${JSON.stringify(conv)}`,
    ).toBe(false);

    // The assertion the change to resolveEffectiveCustomContentId exists for.
    // The pasted macro has no config at all, so rendering the spec's own
    // info.title proves the viewer recovered the id from the URL and fetched the
    // document behind it.
    await publishAndVerifyMacros(page, editorPage, 1, 'byline-asyncapi-pasted', async (macroPage) => {
      await macroPage.assertMacroContent(page.frameLocator(MACRO_IFRAME), DEFAULT_SPEC_TITLE);
    });
  });
});
