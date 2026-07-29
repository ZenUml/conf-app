// copy-for-ai:0..1 — "Copy for AI" viewer toolbar button
// (src/components/Viewer/GenericViewer.vue, data-testid="copy-for-ai-btn").
// One-click clipboard payload (diagram DSL + best-effort Confluence page
// context, buildCopyForAiPrompt.ts) sized for pasting into an external AI
// chat, plus the copy_for_ai_clicked Mixpanel event (catalog.ts). Gated the
// same way View Source is — text-DSL types only (Sequence / Mermaid /
// PlantUML); absent on Graph/OpenAPI/AsyncAPI/Embed.
//
// Evidence capture: this spec writes copy-for-ai-button.png and
// copy-for-ai-clipboard.txt to the overnight-run evidence directory (both as
// testInfo attachments AND explicit fs writes), in addition to the normal
// Playwright assertions.

import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { insertAndPublishMacro } from '../../helpers/MacroFlowHelper.js';
import { viewerFrame } from '../../helpers/ViewerActionsHelper.js';
import {
  insertAndPublishMermaidMacro,
  clickCopyForAiAndRead,
  waitForCopyForAiTrackingRequest,
} from '../../helpers/CopyForAiHelper.js';
import { MacroPage } from '../../pages/MacroPage.js';

const EVIDENCE_DIR = '/Users/pengxiao/.overnight-runs/conf-app/2026-07-30-0010/evidence';

test.describe('Copy for AI button', () => {
  test.skip(!testConfig.isForge && !testConfig.isLite, 'Forge-only chrome');
  test.skip(!testConfig.macros.includes('mermaid'), 'mermaid not in profile');

  test('copy-for-ai:0 — visible on a Mermaid macro, copies diagram + page context, and fires copy_for_ai_clicked', async ({ page }, testInfo) => {
    await insertAndPublishMermaidMacro(page, { title: `mmd-cfa-${Date.now()}` });
    const frame = viewerFrame(page, 'sequence'); // same iframe as any Diagram-macro tab — see MacroPage.getSequenceMacroFrame
    const btn = frame.getByTestId('copy-for-ai-btn');
    await expect(btn).toBeVisible({ timeout: 30_000 });

    // The top toolbar (View Source / Copy for AI / Fullscreen) is opacity:0
    // until `.viewer-surface--hover` (mouseenter on .viewer-surface) sets it
    // to opacity:1 — Playwright's toBeVisible()/click() don't care about
    // opacity, so the assertion and later click above work regardless, but a
    // screenshot taken without hovering first would show an empty toolbar.
    // Hover explicitly so the evidence screenshot actually shows the button.
    await frame.locator('.viewer-surface').hover();
    await expect(btn).toHaveCSS('opacity', '1');

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const screenshotBuffer = await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'copy-for-ai-button.png'),
    });
    await testInfo.attach('copy-for-ai-button', { body: screenshotBuffer, contentType: 'image/png' });

    // Grant clipboard permissions for the OUTER page — the Forge Custom UI
    // iframe is a sandboxed cross-origin OOPIF with no clipboard permission
    // of its own (see CopyForAiHelper.ts file header).
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // Register the tracking-request listener BEFORE the click that fires it.
    const [trackedProps, clipboardText] = await Promise.all([
      waitForCopyForAiTrackingRequest(page),
      clickCopyForAiAndRead(page),
    ]);

    // Clipboard payload: fenced Mermaid DSL + the "Context from Confluence"
    // preamble (buildCopyForAiPrompt.ts) — not just a toast/tracking proxy.
    expect(clipboardText).not.toMatch(/^__clipboard_error__/);
    expect(clipboardText).toContain('```mermaid');
    expect(clipboardText).toContain('Context from Confluence');
    // Sample Mermaid content baseline — same tolerant pattern
    // sequence-create:3 uses for the Mermaid tab's default sample.
    expect(clipboardText).toMatch(/sequenceDiagram|flowchart|graph/i);

    fs.writeFileSync(path.join(EVIDENCE_DIR, 'copy-for-ai-clipboard.txt'), clipboardText);
    await testInfo.attach('copy-for-ai-clipboard', { body: clipboardText, contentType: 'text/plain' });

    // Tracking: surface distinguishes inline viewer from fullscreen (step 0
    // fix in this same task — isFullscreenMode ternary); this spec exercises
    // the inline (published-page) surface, not the Fullscreen modal.
    expect(trackedProps).toMatchObject({
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: 'mermaid',
    });
    // Clipboard write succeeded above, so outcome must reflect a copy (not
    // clipboard_failed) — page context may or may not resolve depending on
    // the freshly-created page's body, so allow either copy outcome.
    expect(['copied', 'copied_diagram_only']).toContain(trackedProps.outcome as string);
    expect(trackedProps.dsl_bytes as number).toBeGreaterThan(0);
  });

  // Cheap negative check — reuses the existing graph insert/publish + frame
  // helpers already exercised by viewer-actions.spec.ts, no new scaffolding.
  test('copy-for-ai:1 — absent on a Graph macro (not a text-DSL type)', async ({ page }) => {
    test.skip(!testConfig.macros.includes('graph'), 'graph not in profile');
    await insertAndPublishMacro(page, 'graph', { title: `gr-cfa-${Date.now()}` });
    const frame = new MacroPage(page).getGraphMacroFrame();
    await expect(frame.locator('body')).toBeVisible({ timeout: 30_000 });
    await expect(frame.getByTestId('copy-for-ai-btn')).toHaveCount(0);
  });
});
