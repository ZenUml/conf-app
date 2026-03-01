import { createMacroTest } from '../../fixtures/macro-test.js';

const test = createMacroTest('sequence');
test.describe.configure({ mode: 'serial' });

test.describe('Sequence Diagram Tests', () => {
  test('should display sequence diagram correctly', async ({ macroPage }) => {
    const sequenceFrame = macroPage.getSequenceMacroFrame();
    await macroPage.assertMacroContent(
      sequenceFrame,
      'Order Service (Demonstration only)'
    );
  });

  test('should edit sequence diagram successfully', async ({ macroPage }) => {
    const sequenceFrame = macroPage.getSequenceMacroFrame();
    await macroPage.assertMacroContent(
      sequenceFrame,
      'Order Service (Demonstration only)'
    );
    await macroPage.editMacro(sequenceFrame);
    await macroPage.saveInEditor();
    await macroPage.assertMacroContent(
      sequenceFrame,
      'Order Service (Demonstration only)'
    );
  });
});
