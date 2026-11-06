import { createMacroTest } from '../../fixtures/macro-test.js';

const test = createMacroTest('embed');

test.describe('Embed Diagram Tests', { tag: ['@test:embed-render', '@variant:lite', '@variant:full', '@variant:diagramly', '@viewer', '@embed'] }, () => {
  test('should display embed diagram correctly', async ({ macroPage }) => {
    const embedFrame = macroPage.getEmbedMacroFrame();
    await macroPage.assertMacroContent(
      embedFrame,
      'Order Service (Demonstration only)'
    );
  });
});
