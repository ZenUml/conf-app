/**
 * Graph viewer — AWS icon stencils render correctly (regression).
 *
 * Two failure modes this test guards against:
 *
 * 1. XML-stencil shapes (e.g. `mxgraph.aws3.lambda`, `mxgraph.aws3.s3`) — broken
 *    when `mxStencilRegistry.libraries` is empty. The fallback is a `<rect>`
 *    filled with the cell's `fillColor` (`#f58536` Lambda, `#7aa116` S3).
 *
 * 2. JS-only shapes (e.g. `mxgraph.aws4.resourceIcon`) — broken when the shape
 *    JS file (`mxAWS4.js`) hasn't been pre-loaded as a `<script>` tag. The
 *    registry's fallback path tries to XHR + `eval()` the .js file, which the
 *    Forge CSP blocks (`'unsafe-eval'` not allowed). Fallback is again a
 *    `<rect>` with the fillColor (`#945df2` here).
 *
 * Mock fixture: `src/model/Ap/MockedResponse/custom-content-by-id-v1-diagram-graph.json`
 * contains an ellipse + AWS Lambda (aws3.xml) + AWS S3 (aws3.xml) + AWS
 * ResourceIcon (mxAWS4.js). The ellipse confirms basic rendering still works
 * regardless of stencil loading.
 *
 * Run:
 *   pnpm start:local &
 *   npx playwright test tests/viewer-preview-graph-aws-icons.spec.ts --project=preview
 */

import { test, expect } from '@playwright/test';

const URL = 'http://127.0.0.1:8080/index.html?sandbox=graph-view&outputType=display';

test.describe('Graph viewer — AWS icon stencils', () => {
  test.use({ viewport: { width: 1100, height: 720 } });

  test('AWS shapes render via stencil paths, not as fallback rectangles', async ({ page }) => {
    await page.goto(URL);

    // Wait until the diagram SVG is rendered. The graph canvas is the largest
    // SVG on the page (icon SVGs are 16/24px).
    await page.waitForFunction(() => {
      const svgs = Array.from(document.querySelectorAll('svg'));
      return svgs.some(s => s.clientWidth > 100 && s.clientHeight > 100);
    }, { timeout: 20_000 });

    // Locate the graph canvas SVG (largest one).
    const stats = await page.evaluate(() => {
      const svgs = Array.from(document.querySelectorAll('svg'));
      const canvas = svgs.reduce<{ svg: SVGSVGElement | null; area: number }>(
        (acc, s) => {
          const area = s.clientWidth * s.clientHeight;
          return area > acc.area ? { svg: s as SVGSVGElement, area } : acc;
        },
        { svg: null, area: 0 }
      ).svg;
      if (!canvas) return null;
      const rectFills = Array.from(canvas.querySelectorAll('rect'))
        .map(r => (r.getAttribute('fill') || '').toLowerCase());
      return {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        rectFills,
        // The mock contains an ellipse "D"; if no shapes exist at all, the
        // diagram failed to render and the AWS assertion would pass vacuously.
        ellipses: canvas.querySelectorAll('ellipse').length,
      };
    });

    expect(stats, 'graph canvas SVG should be present').not.toBeNull();
    expect(stats!.ellipses, 'baseline ellipse "D" must render').toBeGreaterThan(0);

    // Core assertion: when stencils are loaded, no <rect> on the canvas should
    // have a shape's fillColor — those rects only appear in the fallback path.
    const fallbacks: Record<string, string> = {
      '#f58536': 'AWS Lambda (aws3.xml stencil)',
      '#7aa116': 'AWS S3 (aws3.xml stencil)',
      '#945df2': 'AWS ResourceIcon (mxAWS4.js shape) — pre-loaded shape JS file likely missing',
    };
    for (const [color, description] of Object.entries(fallbacks)) {
      expect(
        stats!.rectFills,
        `Found a fallback rect filled with ${color} (${description}). The shape rendered as a solid rectangle instead of the proper icon.`,
      ).not.toContain(color);
    }
  });
});
