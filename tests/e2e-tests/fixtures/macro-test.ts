import { test as base, expect } from '@playwright/test';
import { MacroPage } from '../pages/MacroPage.js';
import { testConfig } from '../config/test-config.js';
import type { RenderMacroType } from '../config/apps.js';
import { getPageId } from '../utils/page-registry.js';
import { registerAnnouncementModalHandler } from '../helpers/announcementModal.js';

/** The render suite runs against API-created fixture pages, so it can only
 *  cover types that HAVE one — `getPageId()` is keyed on the same union. Aliased
 *  to MacroType until 'asyncapi' joined that type, at which point this widened
 *  past what getPageId() accepts. */
export type DiagramType = RenderMacroType;

export function createMacroTest(diagramType: DiagramType) {
  const test = base.extend<{ macroPage: MacroPage }>({
    macroPage: async ({ page }, use) => {
      // Auto-skip if this macro type isn't in renderMacros (render tests use API-created
      // pages, which can't target a specific Forge app when macro keys collide with Connect)
      if (!testConfig.renderMacros.includes(diagramType)) {
        test.skip();
      }

      // Arm before navigating — an Atlassian announcement modal (e.g. the
      // Rovo "reintroduce myself" promo) can intercept the very first click
      // after page load.
      await registerAnnouncementModalHandler(page);

      const pageId = getPageId(diagramType);
      await page.goto(testConfig.pageUrl(pageId));
      await expect(page.locator('#title-text')).toBeVisible();
      const macroPage = new MacroPage(page);
      await macroPage.dismissSpotlightModal();
      await use(macroPage);
    },
  });

  return test;
}
