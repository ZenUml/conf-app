import { test, expect } from "@playwright/test";
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

const MACRO_IFRAME =
  '[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]';

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
    const editorPage = await createPageAndSetup(page, variantLabel);
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
    const encodedSpace = encodeURIComponent(testConfig.spaceKey);
    const now = new Date().toISOString();
    const targetingKey = `paywallWarning:${encodedDomain}:${encodedSpace}`;
    const adminProbeKey = `paywallAdminProbe:${encodedDomain}:${encodedSpace}`;
    const offerKey = `zenumlTemplateOffer:${encodedDomain}:${encodedSpace}`;

    // Exact production marker shapes from warningBanner.ts,
    // spaceAdminProbe.ts, and templateOfferMarker.ts. `{}` resets any offer
    // marker inherited by a retried browser without suppressing the route.
    await setAppMocks(page, {
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
    expect(marker, "success must persist the returned template id").toContain(
      "templateId",
    );

    // The app-origin frame remains readable after success, proving the marker
    // belongs to this variant rather than a co-installed Forge app.
    const frame = await appFrame(page);
    expect(frame, "Lite Forge frame should remain attached").toBeTruthy();
  });
});
