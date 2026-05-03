/**
 * Graph viewer — AWS icon stencils render correctly (regression).
 *
 * Reproduces the bug where AWS shapes (`shape=mxgraph.aws3.lambda`,
 * `shape=mxgraph.aws3.s3`, …) fall back to a solid colored rectangle in the
 * viewer because the stencil definitions aren't loaded. In that broken state,
 * mxGraph renders each AWS shape as `<rect fill="#f58536">` (Lambda) or
 * `<rect fill="#7aa116">` (S3) — the literal `fillColor` from the cell style.
 * When stencils are loaded the shapes render via `<path>` elements and no
 * such rect ever appears.
 *
 * Mock fixture: `src/model/Ap/MockedResponse/custom-content-by-id-v1-diagram-graph.json`
 * contains an AWS Lambda + AWS S3 + a plain ellipse. The plain ellipse confirms
 * basic rendering still works regardless of stencil loading.
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
    // have the AWS fillColor — those rects only appear in the fallback path.
    const lambdaFallback = '#f58536';
    const s3Fallback = '#7aa116';
    expect(
      stats!.rectFills,
      `Found a fallback rect filled with the AWS Lambda color (${lambdaFallback}). ` +
        'This means the stencil definitions failed to load and the shape rendered ' +
        'as a solid rectangle instead of the proper Lambda icon.'
    ).not.toContain(lambdaFallback);
    expect(
      stats!.rectFills,
      `Found a fallback rect filled with the AWS S3 color (${s3Fallback}). ` +
        'This means the stencil definitions failed to load and the shape rendered ' +
        'as a solid rectangle instead of the proper S3 bucket icon.'
    ).not.toContain(s3Fallback);
  });
});
