import { test, expect, type Page } from "@playwright/test";
import { testConfig, TIMEOUTS } from "../../config/test-config.js";
import { expectVisibleOrFailOnLogin } from "../../helpers/authGuard.js";
import {
  appFrame,
  pageBannerFrame,
  readAppMarker,
  setAppMocks,
} from "../../helpers/pageBanner.js";
import {
  createPageAndSetup,
  publishAndVerifyMacros,
} from "./insert-helpers.js";
import type { EditorPageTarget } from "../../pages/EditorPage.js";

const MACRO_IFRAME =
  '[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]';

async function findTemplateAdminSpace(page: Page): Promise<EditorPageTarget> {
  const response = await page.request.get(
    `https://${testConfig.domain}/wiki/rest/api/space?limit=200&expand=operations,homepage`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(`Could not discover a template-admin test space: HTTP ${response.status()}`);
  }
  const body = await response.json();
  const space = body.results?.find(
    (candidate: any) =>
      candidate.homepage?.id &&
      candidate.operations?.some(
        (operation: any) => operation.operation === "manage_templates",
      ),
  );
  if (!space) {
    throw new Error("The E2E user has no space with manage-template permission");
  }
  return {
    domain: testConfig.domain,
    spaceKey: space.key,
    parentPageId: String(space.homepage.id),
    parentPageName: space.homepage.title,
  };
}

test.describe(`Space template offer - ${testConfig.productType}`, () => {
  test.skip(!testConfig.isForge, "pageBanner is Forge-only");
  test.skip(!testConfig.isLite, "template offer ships on Lite only");
  test.skip(
    !testConfig.macros.includes("sequence"),
    "sequence-family macro required",
  );

  test("an in-band space admin can create the Diagram page template", async ({
    page,
  }) => {
    const variantLabel = " Lite";
    const templateAdminSpace = await findTemplateAdminSpace(page);
    const editorPage = await createPageAndSetup(
      page,
      variantLabel,
      templateAdminSpace,
    );
    await editorPage.dismissLearnTheBasicsPanel();
    const macroName = editorPage.getMacroName(
      "Diagram (Mermaid, PlantUML & ZenUML)",
    );
    await editorPage.clickInsertElements();
    await editorPage.searchAndSelectMacro("diagram", macroName);
    await editorPage.interactWithDiagramMacro(
      `Template Offer${variantLabel}`,
    );
    await publishAndVerifyMacros(
      page,
      editorPage,
      1,
      "template-offer-setup",
    );

    await expectVisibleOrFailOnLogin(
      page,
      page.locator(MACRO_IFRAME).first(),
      TIMEOUTS.FRAME_LOAD,
    );

    const domain = new URL(page.url()).hostname.split(".")[0];
    const encodedDomain = encodeURIComponent(domain);
    const encodedSpace = encodeURIComponent(templateAdminSpace.spaceKey);
    const now = new Date().toISOString();
    const targetingKey = `paywallWarning:${encodedDomain}:${encodedSpace}`;
    const adminProbeKey = `paywallAdminProbe:${encodedDomain}:${encodedSpace}`;
    const offerKey = `zenumlTemplateOffer:${encodedDomain}:${encodedSpace}`;

    // Exact production marker shapes from warningBanner.ts,
    // spaceAdminProbe.ts, and templateOfferMarker.ts. `{}` resets any offer
    // marker inherited by a retried browser without suppressing the route.
    await setAppMocks(page, {
      // Keep the live macro iframe's targeting writer pinned in-band after the
      // reload; otherwise it can replace the seeded marker with the space's
      // real count before the page-banner iframe reads it.
      mockMacroCount: "60",
      mockSpacePaid: "false",
      mockCSSEnabled: "true",
      [targetingKey]: JSON.stringify({
        severity: "none",
        macroCount: 60,
        spacePaid: false,
        customerSuccessServiceEnabled: true,
        updatedAt: now,
      }),
      [adminProbeKey]: JSON.stringify({
        lastProbedAt: now,
        isAdmin: true,
        adminCount: 1,
      }),
      [offerKey]: JSON.stringify({}),
    });

    await page.reload();
    const banner = (await pageBannerFrame(page)).getByTestId(
      "template-offer-banner",
    );
    await expect(banner).toBeVisible({ timeout: 60_000 });
    await expect(banner).toContainText("This space has 60 diagrams");

    await banner.getByTestId("template-offer-create").click();
    await expect(banner).toContainText("Template created", {
      timeout: 30_000,
    });

    const marker = await readAppMarker(page, "zenumlTemplateOffer:");
    expect(marker, "success must persist the returned template id").toContain("templateId");
    const templateId = String(JSON.parse(marker || "{}").templateId || "");
    expect(templateId).not.toBe("");

    // The app-origin frame remains readable after success, proving the marker
    // belongs to this variant rather than a co-installed Forge app.
    const frame = await appFrame(page);
    expect(frame, "Lite Forge frame should remain attached").toBeTruthy();

    // This is an ephemeral E2E artifact. Delete only the exact id returned by
    // this click so a rerun neither collides on the fixed product name nor
    // removes a pre-existing administrator template.
    const cleanup = await page.request.delete(
      `https://${testConfig.domain}/wiki/rest/api/template/${encodeURIComponent(templateId)}`,
      { headers: { Accept: "application/json" } },
    );
    expect(cleanup.status()).toBe(204);
  });
});
