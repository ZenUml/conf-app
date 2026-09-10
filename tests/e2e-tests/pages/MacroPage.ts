import { Page, FrameLocator, expect } from '@playwright/test';
import { testConfig, TIMEOUTS } from '../config/test-config.js';
import { dismissPaywallGate } from '../helpers/paywallGate.js';

export class MacroPage {
  constructor(private page: Page) {}

  private getModuleKeySuffix(): string {
    return testConfig.isLite ? '-lite' : '';
  }

  // NOTE: For Forge mode, all frame getters return the same selector because Forge
  // extension containers don't include macro-type identifiers. This works for diagram
  // tests (one macro per page) but NOT for pages with multiple macros. The smoke test
  // uses count-based verification (toHaveCount(4)) instead of individual frame getters.
  getSequenceMacroFrame(): FrameLocator {
    return this.page.frameLocator(testConfig.isForge ? `[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]` : `iframe[id*="zenuml-sequence-macro${this.getModuleKeySuffix()}"]`);
  }

  getGraphMacroFrame(): FrameLocator {
    return this.page.frameLocator(testConfig.isForge ? `[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]` : `iframe[id*="zenuml-graph-macro${this.getModuleKeySuffix()}"]`);
  }

  getOpenApiMacroFrame(): FrameLocator {
    return this.page.frameLocator(testConfig.isForge ? `[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]` : `iframe[id*="zenuml-openapi-macro${this.getModuleKeySuffix()}"]`);
  }

  getEmbedMacroFrame(): FrameLocator {
    return this.page.frameLocator(testConfig.isForge ? `[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]` : `iframe[id*="zenuml-embed-macro${this.getModuleKeySuffix()}"]`);
  }

  getEditorDialogFrame(): FrameLocator {
    return this.page.frameLocator(testConfig.isForge ? '[data-testid="custom-ui-fullscreen-modal-dialog"] [data-testid="hosted-resources-iframe"]' : '[role="dialog"] iframe');
  }

  async dismissSpotlightModal(): Promise<void> {
    const modal = this.page.locator('[data-testid="spotlight--dialog-container"]');

    if (await modal.isVisible({ timeout: TIMEOUTS.MODAL_DISMISS }).catch(() => false)) {
      await modal.locator('button').filter({ hasText: 'Dismiss' }).click();
      await modal.waitFor({ state: 'detached', timeout: TIMEOUTS.MODAL_DISMISS });
    }
  }

  async assertMacroContent(frame: FrameLocator, expectedText: string): Promise<void> {
    // Wait for frame to load and content to be visible.
    // Use .first() to avoid strict-mode violations when the same text appears
    // multiple times (e.g. PlantUML SVG renders "Alice" in title, head, and tail nodes).
    await expect(frame.locator('body')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await expect(frame.getByText(expectedText, { exact: false }).first()).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
  }

  // For DrawIO graphs the rendered output is pure SVG with no predictable text
  // labels, so we assert the SVG canvas element is present instead.
  async assertMacroHasSvg(frame: FrameLocator): Promise<void> {
    await expect(frame.locator('body')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await expect(frame.locator('svg').first()).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
  }

  /**
   * Assert the macro rendered a real, undistorted diagram — not merely that an
   * `<svg>` element exists somewhere in the frame.
   *
   * Why "the largest SVG": the frame also contains the viewer toolbar, whose
   * icons are SVGs. `frame.locator('svg').first()` resolves to one of those —
   * measured at 16x16 on lite-stg — which is why `assertMacroHasSvg` is far
   * weaker than it reads: a visible toolbar icon satisfies it even when the
   * diagram never rendered. Selecting by area instead identifies the diagram
   * without naming a container, which matters because the container markup is
   * not stable across builds: the PlantUML wrapper is `.plantuml-render` on
   * current main but a bare `.flex.justify-center` on what staging is serving
   * today. Area is a property of the thing itself, so this works on both.
   *
   * Two checks:
   *  1. Non-degenerate box. If nothing rendered, the largest SVG IS a toolbar
   *     icon, and a 16px height fails here — which is the whole point.
   *  2. Rendered aspect ratio tracks the viewBox's intrinsic ratio. This is the
   *     defect this product shipped twice: plantuml.com sends
   *     `preserveAspectRatio="none"`, the SVG is a flex item, so the container
   *     crushes one axis while the other keeps its intrinsic size. A customer's
   *     6228x2564 diagram rendered at 758x2564 — an 8.2x squash that reads as a
   *     blank page — while `macro_viewed` still reported success. The fix was
   *     verified in production by exactly this ratio comparison (4560x86
   *     rendering at ratio 53.05 against an intrinsic 53.02). Skew is symmetric,
   *     so a squash on either axis fails identically, and the check is skipped
   *     when the SVG carries no usable viewBox since no intrinsic ratio exists.
   */
  async assertMacroRendersDiagram(
    frame: FrameLocator,
    { minWidth = 50, minHeight = 20, maxSkew = 1.15 }: {
      minWidth?: number;
      minHeight?: number;
      maxSkew?: number;
    } = {},
  ): Promise<void> {
    await expect(frame.locator('body')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await expect(frame.locator('svg').first()).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });

    const readLargestSvg = () =>
      frame.locator('svg').evaluateAll((els) => {
        const measured = (els as SVGSVGElement[]).map((el) => {
          const rect = el.getBoundingClientRect();
          const box = el.viewBox?.baseVal;
          return {
            width: rect.width,
            height: rect.height,
            viewBoxWidth: box?.width ?? 0,
            viewBoxHeight: box?.height ?? 0,
            preserveAspectRatio: el.getAttribute('preserveAspectRatio'),
          };
        });
        measured.sort((a, b) => b.width * b.height - a.width * a.height);
        return measured[0] ?? null;
      });

    // An SVG can be attached and "visible" a frame before layout settles on its
    // final box, so poll rather than reading once and calling a transient
    // 0-height a failure.
    await expect
      .poll(async () => (await readLargestSvg())?.height ?? 0, {
        timeout: TIMEOUTS.FRAME_LOAD,
        message:
          'the largest SVG in the macro frame never reached a diagram-sized height — ' +
          'if it stays at ~16px, the only SVGs present are toolbar icons and no diagram rendered',
      })
      .toBeGreaterThan(minHeight);

    const geometry = await readLargestSvg();
    if (!geometry) throw new Error('no SVG found in the macro frame');
    const describe = JSON.stringify(geometry);

    expect(geometry.width, `rendered diagram width is degenerate: ${describe}`).toBeGreaterThan(minWidth);

    if (geometry.viewBoxWidth > 0 && geometry.viewBoxHeight > 0) {
      const intrinsic = geometry.viewBoxWidth / geometry.viewBoxHeight;
      const rendered = geometry.width / geometry.height;
      const skew = Math.max(intrinsic / rendered, rendered / intrinsic);
      expect(
        skew,
        `diagram is distorted ${skew.toFixed(2)}x: rendered ` +
          `${geometry.width.toFixed(0)}x${geometry.height.toFixed(0)} (ratio ${rendered.toFixed(2)}) ` +
          `against viewBox ${geometry.viewBoxWidth}x${geometry.viewBoxHeight} ` +
          `(ratio ${intrinsic.toFixed(2)}), preserveAspectRatio=${geometry.preserveAspectRatio}`,
      ).toBeLessThan(maxSkew);
    }
  }

  async openFullscreen(macroFrame: FrameLocator): Promise<void> {
    await expect(macroFrame.locator('body')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    const fullscreenButton = macroFrame.getByRole('button', { name: 'Fullscreen' });
    await expect(fullscreenButton).toBeVisible({ timeout: TIMEOUTS.BUTTON_VISIBLE });
    await fullscreenButton.click();
  }

  async editMacro(macroFrame: FrameLocator): Promise<void> {
    // Wait for frame to fully load
    await expect(macroFrame.locator('body')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });

    // Use aria-label to find the Edit button
    const editButton = macroFrame.getByRole('button', { name: 'Edit' });

    await expect(editButton).toBeVisible({ timeout: TIMEOUTS.BUTTON_VISIBLE });
    await editButton.click();
  }

  async saveInEditor(): Promise<void> {
    const editorFrame = this.getEditorDialogFrame();
    // Use more specific button selection - look for the save/publish button
    const saveButton = editorFrame.getByRole('button', { name: /publish|save/i }).first();
    await expect(saveButton).toBeVisible({ timeout: TIMEOUTS.BUTTON_VISIBLE });
    await saveButton.click();
  }

  /**
   * Edits a Graph (DrawIO) macro from the viewer (published page).
   *
   * Flow:
   * 1. Click the Edit button inside the macro frame
   * 2. Wait for the DrawIO editor modal to open
   * 3. Click Publish in the nested DrawIO iframe to save without changes
   */
  async editGraphMacroFromViewer(macroFrame: FrameLocator): Promise<void> {
    await this.editMacro(macroFrame);

    // Wait for the DrawIO editor to load inside the modal
    await this.page.waitForTimeout(5000);

    if (testConfig.isForge || testConfig.isLite) {
      const modal = this.page.getByTestId('custom-ui-fullscreen-modal-dialog');
      const outerFrame = modal.locator('[data-testid="hosted-resources-iframe"]').contentFrame();

      // If the space hit the macro limit, the paywall gate mounts in the outer
      // Forge frame above DrawIO. Clear it before touching the canvas — its
      // backdrop otherwise blocks the sidebar shape click and Publish. The
      // helper waits for the gate to actually appear and confirms it closed
      // (an early force-click can land before Vue wires the handler).
      await dismissPaywallGate(this.page, outerFrame);

      const innerFrame = outerFrame.locator('iframe').contentFrame();

      // Add a shape to the canvas to make a real change
      const sidebarShape = innerFrame.locator('.geSidebarContainer a').nth(2);
      try {
        await sidebarShape.click({ timeout: 30000 });
        await this.page.waitForTimeout(1000);
      } catch {
        console.warn('  ⚠ DrawIO sidebar shape not clickable - proceeding without adding shape');
      }

      await innerFrame.locator('button:has-text("Publish")').click({ timeout: TIMEOUTS.BUTTON_VISIBLE });
    } else {
      const outerFrame = this.page.locator('[role="dialog"] iframe').contentFrame();
      const innerFrame = outerFrame.locator('iframe').contentFrame();

      // Add a shape to the canvas to make a real change
      const sidebarShape = innerFrame.locator('.geSidebarContainer a').nth(2);
      try {
        await sidebarShape.click({ timeout: 30000 });
        await this.page.waitForTimeout(1000);
      } catch {
        console.warn('  ⚠ DrawIO sidebar shape not clickable - proceeding without adding shape');
      }

      await innerFrame.locator('button:has-text("Publish")').click({ timeout: TIMEOUTS.BUTTON_VISIBLE });
    }

    // Verify the editor modal closed — confirms Publish was accepted
    const modal = testConfig.isForge || testConfig.isLite
      ? this.page.getByTestId('custom-ui-fullscreen-modal-dialog')
      : this.page.locator('[role="dialog"] iframe');
    await expect(modal).toBeHidden({ timeout: TIMEOUTS.FRAME_LOAD });
  }
}
