// Simulated MCP Apps host: fetch the view via resources/read, mount it in a
// sandboxed srcdoc iframe under the declared CSP, do the ui/initialize
// handshake, hand it a real render_diagram result, screenshot.
const { chromium } = require('playwright');
const URL_ = process.argv[2];
const OUT = process.argv[3];
async function rpc(method, params) {
  const r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'zenuml-mcp-probe/1' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await r.json()).result;
}
const CASES = [
  ['sequence', { source: 'title Order flow\n@Actor Client\nClient->OrderService.place(order) {\n  Inventory.reserve(items)\n  if (paid) {\n    Billing.charge(card)\n  }\n  return confirmation\n}' }],
  ['mermaid', { source: 'flowchart LR\n  A[Request] --> B{Valid?}\n  B -- yes --> C[Render]\n  B -- no --> D[Report errors]' }],
  ['plantuml', { source: '@startuml\nAlice -> Bob: hello\nBob --> Alice: hi\n@enduml' }],
  ['graph', { source: '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Client" style="rounded=1;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="20" y="20" width="120" height="50" as="geometry"/></mxCell><mxCell id="3" value="Server" style="rounded=1;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="240" y="20" width="120" height="50" as="geometry"/></mxCell><mxCell id="4" edge="1" parent="1" source="2" target="3"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>' }],
  ['openapi', { source: "openapi: 3.0.0\ninfo:\n  title: Demo API\n  version: '1.0'\npaths:\n  /orders:\n    get:\n      summary: List orders\n      responses:\n        '200':\n          description: OK" }],
];
(async () => {
  const view = (await rpc('resources/read', { uri: 'ui://zenuml/diagram' })).contents[0];
  const csp = view._meta.ui.csp;
  const res = csp.resourceDomains.join(' ');
  const policy = `default-src 'none'; script-src 'unsafe-inline' ${res}; style-src 'unsafe-inline' ${res}; img-src data: blob: ${res}; font-src data: ${res}; connect-src ${csp.connectDomains.join(' ')}`;
  const html = view.text.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`);
  const browser = await chromium.launch();
  const results = [];
  for (const [name, args] of CASES) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const cspErrors = [];
    page.on('console', (m) => { if (/Content Security Policy|Refused/.test(m.text())) cspErrors.push(m.text().slice(0, 160)); });
    const toolResult = await rpc('tools/call', { name: 'render_diagram', arguments: args });
    await page.setContent('<html><body style="margin:0;background:#f4f4f5"><iframe id="v" sandbox="allow-scripts" style="width:880px;height:640px;border:1px solid #ccc;background:#fff"></iframe></body></html>');
    await page.evaluate(({ html, toolResult }) => {
      const f = document.getElementById('v');
      window.__log = [];
      window.addEventListener('message', (e) => {
        if (e.source !== f.contentWindow) return;
        const m = e.data; window.__log.push(m.method || 'response');
        if (m.method === 'ui/initialize') f.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, hostInfo: { name: 'sim-host', version: '1' }, hostCapabilities: {}, hostContext: {} } }, '*');
        if (m.method === 'ui/notifications/initialized') f.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: toolResult }, '*');
        if (m.method === 'ui/notifications/size-changed') window.__size = m.params;
      });
      f.srcdoc = html;
    }, { html, toolResult });
    await page.waitForFunction(() => window.__size && window.__size.height > 60, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const frame = page.frames()[1];
    const probe = frame ? await frame.evaluate(() => ({ svg: document.querySelectorAll('svg').length, img: [...document.images].map((i) => i.naturalWidth), text: document.body.innerText.slice(0, 80).replace(/\s+/g, ' ') })) : null;
    const log = await page.evaluate(() => window.__log);
    const size = await page.evaluate(() => window.__size);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    results.push({ name, type: toolResult.structuredContent?.diagramType, detected: toolResult.structuredContent?.detected, handshake: log.join('>'), size, probe, cspErrors: cspErrors.slice(0, 3) });
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(results, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
