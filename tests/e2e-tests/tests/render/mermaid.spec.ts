import { createMacroTest } from '../../fixtures/macro-test.js';

const test = createMacroTest('mermaid');
test.describe.configure({ mode: 'serial' });

test.describe('Mermaid Diagram Tests', () => {
  test('should display mermaid diagram correctly', async ({ macroPage }) => {
    const mermaidFrame = macroPage.getSequenceMacroFrame();
    await macroPage.assertMacroContent(
      mermaidFrame,
      'A Gantt Diagram'
    );
  });
});
