import { createMacroTest } from '../../fixtures/macro-test.js';

const test = createMacroTest('mermaid');
test.describe.configure({ mode: 'serial' });

test.describe('Mermaid Diagram Tests', { tag: ['@test:mermaid-render', '@variant:lite', '@variant:full', '@variant:diagramly', '@viewer', '@mermaid'] }, () => {
  test('should display mermaid diagram correctly', async ({ macroPage }) => {
    const mermaidFrame = macroPage.getSequenceMacroFrame();
    await macroPage.assertMacroContent(
      mermaidFrame,
      'A Gantt Diagram'
    );
  });
});
