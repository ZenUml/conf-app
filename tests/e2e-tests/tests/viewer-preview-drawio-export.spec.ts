/**
 * Lever D (graph, Option B) — proves the REAL bundled DrawIO answers the export
 * protocol our editor relies on, decoupled from the Forge editor / over-limit space /
 * paywall (where the editGraphMacroFromViewer publish never registers in headless
 * automation, so the end-to-end graph re-save can't be driven).
 *
 * We load the actual editor (public/drawio/index.html, the same build + embed params
 * ForgeGraphEditor uses) directly as the top-level page. In embed mode DrawIO listens
 * for `{action:…}` on window and posts `{event:…}` to parent — and parent === self
 * here — so we can run the full handshake from the page:
 *   {event:'init'} → send {action:'load', xml} → send {action:'export', format:'svg'}
 *   → capture {event:'export'} → assert it is the createSvgDataUri base64 data URI
 *     that decodeDrawioSvgExport expects, decodes to a valid <svg>, and preserves the
 *     shape's geometry/label.
 *
 * Together with decodeDrawioSvgExport.spec (decodes that exact format) and the
 * Persistence/ForgeGraphViewer unit tests, this closes the one Option B piece that
 * was otherwise verified only by reading EditorUi.js.
 *
 *   pnpm start:local &   # vite dev on 127.0.0.1:8080 (serves public/drawio)
 *   npx playwright test tests/viewer-preview-drawio-export.spec.ts --project=preview
 */

import { test, expect } from '@playwright/test';

// Same embed params ForgeGraphEditor.vue uses (offline=1 ⇒ no storage prompts).
const EDITOR_URL =
  'http://127.0.0.1:8080/drawio/index.html?embed=1&spin=1&proto=json&noSaveBtn=1&saveAndExit=1&publishClose=1&noExitBtn=1&libraries=1&offline=1';

const SAMPLE_MXFILE =
  '<mxfile><diagram name="Page-1"><mxGraphModel dx="800" dy="600" grid="0" page="1">' +
  '<root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
  '<mxCell id="2" value="HELLO_LEVER_D" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;" vertex="1" parent="1">' +
  '<mxGeometry x="40" y="40" width="160" height="60" as="geometry"/></mxCell>' +
  '</root></mxGraphModel></diagram></mxfile>';

const B64_PREFIX = 'data:image/svg+xml;base64,';

test.describe('DrawIO export protocol (Lever D Option B producer)', () => {
  test.use({ viewport: { width: 1100, height: 720 } });

  test('real DrawIO answers {action:export,format:svg} with a decodable SVG data URI', async ({ page }) => {
    // DrawIO installs its message handler + posts {event:'init'} only when FRAMED
    // (window.parent !== window). It must also be SAME-ORIGIN as the host (a cross-origin
    // iframe under a data: host loads nothing). vite doesn't serve a bare host page, so we
    // synthesize one at a 127.0.0.1:8080 URL via route-fulfill — same origin as the iframe
    // — exactly the ForgeGraphEditor arrangement (host listens on window, iframe posts to
    // parent). [Diagnosed across 3 prior attempts: top-level = no handler; data: host = no
    // iframe load.]
    const HOST_URL = 'http://127.0.0.1:8080/__drawio_export_host__';
    const hostHtml =
      '<!DOCTYPE html><html><head><script>' +
      'window.__msgs=[];' +
      'window.addEventListener("message",function(e){try{var d=typeof e.data==="string"?JSON.parse(e.data):e.data;window.__msgs.push(d);}catch(_){}}); ' +
      '</' + 'script></head><body style="margin:0">' +
      '<iframe id="dio" style="width:1000px;height:640px;border:0" src="' + EDITOR_URL + '"></iframe>' +
      '</body></html>';
    await page.route(HOST_URL, (route) => route.fulfill({ contentType: 'text/html', body: hostHtml }));
    await page.goto(HOST_URL);

    const sendToFrame = (msg: Record<string, unknown>) =>
      page.evaluate((m) => {
        (document.getElementById('dio') as HTMLIFrameElement).contentWindow!.postMessage(JSON.stringify(m), '*');
      }, msg);

    // 1) init handshake (proves same-origin framed host → handler installed)
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window as unknown as { __msgs: Array<{ event?: string }> }).__msgs.some((m) => m && m.event === 'init'),
          ),
        { timeout: 30_000 },
      )
      .toBeTruthy();

    // 2) load a known graph, 3) request an SVG export (client-side, offline; no spinner)
    await sendToFrame({ action: 'load', xml: SAMPLE_MXFILE });
    await page.waitForTimeout(2000);
    await sendToFrame({ action: 'export', format: 'svg' });

    // 4) capture the export reply
    let captured: string | null = null;
    await expect
      .poll(
        async () => {
          const data = await page.evaluate(() => {
            const msgs = (window as unknown as { __msgs: Array<{ event?: string; data?: string }> }).__msgs;
            const m = [...msgs].reverse().find((x) => x && x.event === 'export' && typeof x.data === 'string');
            return m ? m.data! : null;
          });
          if (data && data.startsWith(B64_PREFIX)) {
            captured = data;
            return true;
          }
          return false;
        },
        { timeout: 30_000, intervals: [1000] },
      )
      .toBeTruthy();

    // captured is the exact Editor.createSvgDataUri shape decodeDrawioSvgExport expects.
    const svg = await page.evaluate((d) => {
      const b64 = d.slice('data:image/svg+xml;base64,'.length);
      return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    }, captured!);

    expect(svg).toMatch(/<svg[\s>]/i);
    expect(svg, 'the shape label must survive the export (geometry baked into the SVG)').toContain('HELLO_LEVER_D');
    expect(svg.length).toBeGreaterThan(200);

    // eslint-disable-next-line no-console
    console.log(`[drawio-export] OK — ${svg.length} byte SVG, base64 data URI, label preserved`);
  });
});
