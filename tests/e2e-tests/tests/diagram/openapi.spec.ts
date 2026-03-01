import { createMacroTest } from '../../fixtures/macro-test.js';

const test = createMacroTest('openapi');
test.describe.configure({ mode: 'serial' });

test.describe('OpenAPI Diagram Tests', () => {
  test('should display OpenAPI diagram correctly', async ({ macroPage }) => {
    const openapiFrame = macroPage.getOpenApiMacroFrame();
    await macroPage.assertMacroContent(openapiFrame, '/users');
  });
});
