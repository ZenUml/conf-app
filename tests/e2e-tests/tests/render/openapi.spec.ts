import { createMacroTest } from '../../fixtures/macro-test.js';
import { expect } from '@playwright/test';

const test = createMacroTest('openapi');
test.describe.configure({ mode: 'serial' });

test.describe('OpenAPI Diagram Tests', () => {
  test('should display OpenAPI diagram correctly', async ({ macroPage }) => {
    const openapiFrame = macroPage.getOpenApiMacroFrame();
    await macroPage.assertMacroContent(openapiFrame, '/users');
  });

  test('should open fullscreen with correct layout', async ({ macroPage }) => {
    const openapiFrame = macroPage.getOpenApiMacroFrame();
    await macroPage.assertMacroContent(openapiFrame, '/users');
    await macroPage.openFullscreen(openapiFrame);

    const fullscreenFrame = macroPage.getEditorDialogFrame();
    await macroPage.assertMacroContent(fullscreenFrame, '/users');

    // Verify the swagger-ui container has a full-width layout (not the broken narrow ~50px layout)
    const swaggerWidth = await fullscreenFrame.locator('#swagger-ui').evaluate(
      (el) => el.getBoundingClientRect().width
    );
    expect(swaggerWidth).toBeGreaterThan(400);
  });
});
