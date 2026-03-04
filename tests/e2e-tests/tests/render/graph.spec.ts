import { createMacroTest } from '../../fixtures/macro-test.js';

const test = createMacroTest('graph');
test.describe.configure({ mode: 'serial' });

test.describe('Graph Diagram Tests', () => {
  test('should display graph diagram correctly', async ({ macroPage }) => {
    const graphFrame = macroPage.getGraphMacroFrame();
    await macroPage.assertMacroContent(
      graphFrame,
      "Lamp doesn't work"
    );
  });
});
