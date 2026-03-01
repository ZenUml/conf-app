import { test as base, expect } from '@playwright/test';
import { MacroPage } from '../pages/MacroPage.js';
import { testConfig } from '../config/test-config.js';
import type { MacroType } from '../config/test-config.js';
import { getPageId } from '../utils/page-registry.js';

export type DiagramType = MacroType;

export function createMacroTest(diagramType: DiagramType) {
  const test = base.extend<{ macroPage: MacroPage }>({
    macroPage: async ({ page }, use) => {
      // Auto-skip if this macro type isn't supported by the current app profile
      if (!testConfig.macros.includes(diagramType)) {
        test.skip();
      }

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
