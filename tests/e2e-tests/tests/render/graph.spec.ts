import { createMacroTest } from '../../fixtures/macro-test.js';

const test = createMacroTest('graph');
test.describe.configure({ mode: 'serial' });

test.describe('Graph Diagram Tests', { tag: ['@test:graph-render', '@variant:lite', '@variant:full', '@variant:diagramly', '@viewer', '@graph', '@feature:rendering', '@interface:inline-viewer', '@scenario:rendering:inline-viewer'] }, () => {
  test('should display graph diagram correctly', async ({ macroPage }) => {
    const graphFrame = macroPage.getGraphMacroFrame();
    await macroPage.assertMacroContent(
      graphFrame,
      "Lamp doesn't work"
    );
  });
});
