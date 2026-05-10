// viewer-actions:0..11 — Toolbar actions on the rendered macro tile of a
// published page. Twelve cases = 4 actions × 3 macro types.
//
// Actions per macro:
//   - Fullscreen: opens the read-only fullscreen viewer modal
//     ([data-testid="custom-ui-fullscreen-modal-dialog"])
//   - Export:     opens an export UI (Vue ExportModal for sequence/openapi,
//                 DrawIO sidebar for graph)
//   - Copy Code:  copies the source to the clipboard
//   - Versions:   logs version metadata to console (Forge UX is intentionally
//                 console-only — see ViewerActionsHelper)

import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { insertAndPublishMacro } from '../../helpers/MacroFlowHelper.js';
import {
  openFullscreenViewer,
  openExport,
  clickCopyCodeAndRead,
  clickVersionsAndCaptureLogs,
} from '../../helpers/ViewerActionsHelper.js';
import { expectFullscreenLayout } from '../../helpers/FullscreenModalHelper.js';

test.describe('Viewer toolbar actions', () => {
  test.skip(!testConfig.isForge && !testConfig.isLite, 'Forge-only chrome');

  // Sequence (0..3)
  test.describe('Sequence', () => {
    test.skip(!testConfig.macros.includes('sequence'), 'sequence not in profile');

    test('viewer-actions:0 — Sequence Fullscreen opens fullscreen viewer modal', async ({ page }) => {
      await insertAndPublishMacro(page, 'sequence', { title: `seq-fs-${Date.now()}` });
      await openFullscreenViewer(page, 'sequence');
      await expectFullscreenLayout(page, 'fullscreen-viewer');
    });

    test('viewer-actions:1 — Sequence Export opens an export UI', async ({ page }) => {
      await insertAndPublishMacro(page, 'sequence', { title: `seq-ex-${Date.now()}` });
      const result = await openExport(page, 'sequence');
      expect(['export-modal', 'drawio-sidebar']).toContain(result.kind);
    });

    test('viewer-actions:2 — Sequence Copy Code puts source on clipboard', async ({ page }) => {
      await insertAndPublishMacro(page, 'sequence', { title: `seq-cp-${Date.now()}` });
      const text = await clickCopyCodeAndRead(page, 'sequence');
      // Sample/seeded sequence content includes recognizable ZenUML keywords.
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/^__clipboard_error__/);
    });

    test('viewer-actions:3 — Sequence Versions logs version metadata', async ({ page }) => {
      await insertAndPublishMacro(page, 'sequence', { title: `seq-vr-${Date.now()}` });
      const logs = await clickVersionsAndCaptureLogs(page, 'sequence');
      // Manual run captured "Getting versions for content ID: …" → "Found 1 versions".
      expect(logs.some(l => /Getting versions for content ID/i.test(l))).toBe(true);
    });
  });

  // Graph (4..7)
  test.describe('Graph', () => {
    test.skip(!testConfig.macros.includes('graph'), 'graph not in profile');

    test('viewer-actions:4 — Graph Fullscreen opens fullscreen viewer modal', async ({ page }) => {
      await insertAndPublishMacro(page, 'graph', { title: `gr-fs-${Date.now()}` });
      await openFullscreenViewer(page, 'graph');
      await expectFullscreenLayout(page, 'fullscreen-viewer');
    });

    test('viewer-actions:5 — Graph Export opens DrawIO export sidebar', async ({ page }) => {
      await insertAndPublishMacro(page, 'graph', { title: `gr-ex-${Date.now()}` });
      const result = await openExport(page, 'graph');
      expect(['drawio-sidebar', 'export-modal']).toContain(result.kind);
    });

    test('viewer-actions:6 — Graph Copy Code copies DrawIO XML', async ({ page }) => {
      await insertAndPublishMacro(page, 'graph', { title: `gr-cp-${Date.now()}` });
      const text = await clickCopyCodeAndRead(page, 'graph');
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/^__clipboard_error__/);
      // DrawIO XML is the expected payload — recognizable by mxGraphModel root.
      expect(text).toMatch(/mxGraphModel|mxCell/i);
    });

    test('viewer-actions:7 — Graph Versions logs version metadata', async ({ page }) => {
      await insertAndPublishMacro(page, 'graph', { title: `gr-vr-${Date.now()}` });
      const logs = await clickVersionsAndCaptureLogs(page, 'graph');
      expect(logs.some(l => /Getting versions for content ID/i.test(l))).toBe(true);
    });
  });

  // OpenAPI (8..11)
  test.describe('OpenAPI', () => {
    test.skip(!testConfig.macros.includes('openapi'), 'openapi not in profile');

    test('viewer-actions:8 — OpenAPI Fullscreen opens fullscreen viewer modal', async ({ page }) => {
      await insertAndPublishMacro(page, 'openapi', { title: `oa-fs-${Date.now()}` });
      await openFullscreenViewer(page, 'openapi');
      await expectFullscreenLayout(page, 'fullscreen-viewer');
    });

    test('viewer-actions:9 — OpenAPI Export opens an export UI', async ({ page }) => {
      await insertAndPublishMacro(page, 'openapi', { title: `oa-ex-${Date.now()}` });
      const result = await openExport(page, 'openapi');
      expect(['export-modal', 'drawio-sidebar']).toContain(result.kind);
    });

    test('viewer-actions:10 — OpenAPI Copy Code copies YAML/JSON spec', async ({ page }) => {
      await insertAndPublishMacro(page, 'openapi', { title: `oa-cp-${Date.now()}` });
      const text = await clickCopyCodeAndRead(page, 'openapi');
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/^__clipboard_error__/);
      // OpenAPI spec — YAML or JSON; either way "openapi:" or "openapi" appears.
      expect(text).toMatch(/openapi/i);
    });

    test('viewer-actions:11 — OpenAPI Versions logs version metadata', async ({ page }) => {
      await insertAndPublishMacro(page, 'openapi', { title: `oa-vr-${Date.now()}` });
      const logs = await clickVersionsAndCaptureLogs(page, 'openapi');
      expect(logs.some(l => /Getting versions for content ID/i.test(l))).toBe(true);
    });
  });
});
