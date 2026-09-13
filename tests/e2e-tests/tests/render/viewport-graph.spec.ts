/**
 * The shared pan/zoom viewport on a real Graph macro.
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

const test = createMacroTest('graph');
test.describe.configure({ mode: 'serial' });

test.describe('Graph pan/zoom viewport', { tag: ['@viewer', '@viewport', '@graph'] }, () => {
  test('offers zoom controls on the rendered macro', async ({ macroPage }) => {
    await expectZoomControls(macroPage.getGraphMacroFrame(), 'Graph');
  });

  // Graph reaches the 1:1 ceiling on its own, not through our clamp: with no
  // `zoom` in the GraphViewer config and `allowZoomIn` false, fitGraph sets
  // `graph.maxFitScale = 1` (viewer-static.min.js). Asserting it here is what
  // makes that a guarantee rather than a coincidence of the vendored build.
  test('renders at natural size or smaller, never magnified', async ({ macroPage }) => {
    await expectNotMagnified(macroPage.getGraphMacroFrame());
  });

  test('zooms in from the toolbar', async ({ macroPage }) => {
    await expectZoomInGrows(macroPage.getGraphMacroFrame(), 'Graph');
  });
});
