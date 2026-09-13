/**
 * The shared pan/zoom viewport on a real Sequence macro.
 *
 * Storybook and the unit specs pin the geometry maths. What only a real
 * Confluence page shows is the viewport surviving the Forge iframe: the
 * renderers attach inside a cross-origin frame sized by its own content, which
 * can still be unlaid-out when a render lands. Every bug in this area came from
 * there — a 0x0 SVG making svg-pan-zoom invert a singular matrix (conf-app#666),
 * and a viewBox-less SVG collapsing to the browser's 150px default (#650).
 */
import { createMacroTest } from '../../fixtures/macro-test.js';
import {
  expectNotMagnified,
  expectZoomControls,
  expectZoomInGrows,
} from '../../helpers/viewportGeometry.js';

const test = createMacroTest('sequence');
test.describe.configure({ mode: 'serial' });

test.describe('Sequence pan/zoom viewport', { tag: ['@viewer', '@viewport', '@sequence'] }, () => {
  test('offers zoom controls on the rendered macro', async ({ macroPage }) => {
    await expectZoomControls(macroPage.getSequenceMacroFrame(), 'Sequence');
  });

  test('renders at natural size or smaller, never magnified', async ({ macroPage }) => {
    await expectNotMagnified(macroPage.getSequenceMacroFrame());
  });

  test('zooms in from the toolbar', async ({ macroPage }) => {
    await expectZoomInGrows(macroPage.getSequenceMacroFrame(), 'Sequence');
  });
});
