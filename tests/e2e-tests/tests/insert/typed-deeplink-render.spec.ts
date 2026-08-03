import { test, expect, type APIRequestContext } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { createPageAndSetup, publishAndVerifyMacros } from './insert-helpers.js';
import { pasteUntil, isMacro, typedDeeplinkUrl } from '../../helpers/embedDeeplink.js';

/**
 * The regression this exists for: a graph placed by pasting its typed deeplink
 * rendered an EMPTY canvas, and stayed empty after editing.
 *
 * A macro created by autoConvert has no `config` — its custom content id lives
 * only in the matched URL. forge-graph-viewer / forge-graph-editor read
 * `extension.config.customContentId` directly, so the pasted macro had no id at
 * all: the viewer loaded nothing, and the editor treated it as a brand-new
 * diagram and saved to a fresh custom content, orphaning the original. Fixed by
 * routing every entry point through resolveEffectiveCustomContentId.
 *
 * typed-deeplink-autoconvert.spec.ts pins the ROUTING (which macro claims the
 * URL). That passes even when the macro renders nothing, because a matcher
 * assertion never resolves the content. This spec is the other half: the pasted
 * macro must actually RENDER the diagram it points at.
 *
 * Two pages by design — page A owns a real diagram, page B receives only the
 * link — so the assertion on B cannot be satisfied by A's macro.
 */

const macroType = 'graph' as const;
const skip = !testConfig.macros.includes(macroType);

/** Verified 2026-08-02: returns {"cloudId":"..."} for a Confluence Cloud site. */
async function fetchCloudId(request: APIRequestContext): Promise<string> {
  const r = await request.get(`https://${testConfig.domain}/_edge/tenant_info`);
  expect(r.ok(), `tenant_info failed: ${r.status()}`).toBe(true);
  const { cloudId } = await r.json();
  expect(cloudId, 'tenant_info returned no cloudId').toBeTruthy();
  return cloudId;
}

/**
 * The custom content a page's macros own. Same endpoint and `type` key the app
 * itself uses (ApWrapper2.getPageCustomContent) — every diagram type is stored
 * under the one custom-content key, graph included.
 */
async function fetchPageCustomContentId(
  request: APIRequestContext,
  pageId: string,
): Promise<string> {
  const url =
    `https://${testConfig.domain}/wiki/api/v2/pages/${pageId}` +
    `/custom-content?type=${encodeURIComponent(testConfig.customContentKey)}&limit=25`;
  const r = await request.get(url, { headers: { Accept: 'application/json' } });
  expect(r.ok(), `custom-content listing failed: ${r.status()} ${url}`).toBe(true);
  const body = await r.json();
  const id = body?.results?.[0]?.id;
  expect(
    id,
    `page ${pageId} reported no ${testConfig.customContentKey} children — ` +
      `the source diagram was not persisted, so the paste has nothing to resolve`,
  ).toBeTruthy();
  return String(id);
}

test.describe(`Typed deeplink renders its target - ${testConfig.productType}`, () => {
  test.skip(skip, `Macro "${macroType}" not in app profile [${testConfig.macros.join(', ')}]`);

  test('a pasted graph deeplink renders the diagram, not an empty canvas', async ({
    page,
    request,
  }) => {
    // Two page creations and two publishes — comfortably the heaviest test in
    // the insert suite, and the only one that builds its own fixture instead of
    // using a fixed id. Triple the project timeout rather than have a slow
    // staging run read as a product failure.
    test.slow();
    const variantLabel = testConfig.isLite ? ' Lite' : '';
    const cloudId = await fetchCloudId(request);

    // Page A — insert a graph the normal way so a real custom content exists.
    const sourcePageId = await test.step('create the source diagram', async () => {
      const editorPage = await createPageAndSetup(page, variantLabel);
      await editorPage.dismissLearnTheBasicsPanel();
      await editorPage.clickInsertElements();
      await editorPage.searchAndSelectMacro('graph', editorPage.getMacroName('Graph (DrawIO)'));
      await editorPage.interactWithGraphMacro(`Deeplink Source${variantLabel}`);
      return publishAndVerifyMacros(page, editorPage, 1, 'deeplink-source', async (macroPage) => {
        await macroPage.assertMacroHasSvg(macroPage.getGraphMacroFrame());
      });
    });
    expect(sourcePageId, 'source page was not published').toBeTruthy();

    const contentId = await fetchPageCustomContentId(request, sourcePageId);
    console.log(`  ✓ source diagram custom content: ${contentId}`);

    // Page B — the link is the ONLY thing carrying the diagram's identity.
    await test.step('place it by pasting the typed deeplink', async () => {
      const editorPage = await createPageAndSetup(page, variantLabel);
      const url = typedDeeplinkUrl('graph', cloudId, contentId);
      const conv = await pasteUntil(page, url, (x) => isMacro(x, 'zenuml-graph-macro'));
      expect(
        isMacro(conv, 'zenuml-graph-macro'),
        `paste did not convert to the graph macro: ${JSON.stringify(conv)}`,
      ).toBe(true);

      // The assertion that would have caught the bug. Iframe visibility alone
      // is not enough — an empty canvas and the load-failed panel both render
      // inside a perfectly visible Forge iframe. assertMacroHasSvg requires the
      // DrawIO viewer to have drawn the retrieved diagram.
      await publishAndVerifyMacros(page, editorPage, 1, 'deeplink-pasted', async (macroPage) => {
        await macroPage.assertMacroHasSvg(macroPage.getGraphMacroFrame());
      });
    });
  });
});
