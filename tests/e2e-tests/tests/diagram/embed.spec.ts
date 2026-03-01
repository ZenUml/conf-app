import { createMacroTest } from '../../fixtures/macro-test.js';

const test = createMacroTest('embed');
test.describe.configure({ mode: 'serial' });

test.describe('Embed Diagram Tests', () => {
  test('should display embed diagram correctly', async ({ macroPage }) => {
    const embedFrame = macroPage.getEmbedMacroFrame();
    await macroPage.assertMacroContent(
      embedFrame,
      'Order Service (Demonstration only)'
    );
  });

  test('should edit embed diagram successfully', async ({ macroPage }) => {
    const embedFrame = macroPage.getEmbedMacroFrame();
    await macroPage.assertMacroContent(
      embedFrame,
      'Order Service (Demonstration only)'
    );
    await macroPage.editMacro(embedFrame);
    await macroPage.saveInEditor();
    await macroPage.assertMacroContent(
      embedFrame,
      'Order Service (Demonstration only)'
    );
  });
});
