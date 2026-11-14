// Usage: copy mermaid@11.17.2 dist/mermaid.min.js next to this file, then: node mermaid-no-layout-repro.js
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const lib = fs.readFileSync(path.join(__dirname, 'mermaid.min.js'), 'utf8');
const SRCS = {
  class: `classDiagram
  Customer "1" --> "*" Order : places
  Order "1" *-- "1..*" LineItem : contains
  Order --> Payment : paidBy`,
  er: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains`,
  state: `stateDiagram-v2
  [*] --> Draft
  Draft --> Review : submit
  Review --> Draft : reject
  Review --> [*] : approve`,
  flow_selfloop: `flowchart TD
  A[Start] -->|go| B
  B -->|retry| B
  B --> C[End]`,
};
const page = (s) => `<!doctype html><html><body style="${s}"></body></html>`;
const envs = {
  normal: { top: page('') },
  body_display_none: { top: page('display:none') },
  iframe_0x0: { top: '<iframe id=f style="width:0;height:0;border:0"></iframe>', frame: page('') },
  iframe_display_none: { top: '<iframe id=f style="display:none"></iframe>', frame: page('') },
};
(async () => {
  const b = await chromium.launch();
  for (const [en, env] of Object.entries(envs)) for (const [sn, src] of Object.entries(SRCS)) {
    const p = await b.newPage(); await p.setContent(env.top);
    let t = p.mainFrame();
    if (env.frame) { await p.$eval('#f', (f, h) => { f.srcdoc = h; }, env.frame); await p.waitForTimeout(250); t = p.frames()[1]; }
    await t.addScriptTag({ content: lib });
    const r = await t.evaluate(async (src) => { try { mermaid.initialize({ startOnLoad: false, theme: 'neutral' }); const { svg } = await mermaid.render('m' + Math.random().toString(36).slice(2), src); return 'OK ' + svg.length + (svg.includes('NaN') ? ' (contains NaN)' : ''); } catch (e) { return 'THROW ' + (e && e.message || e); } }, src);
    console.log(en.padEnd(20), sn.padEnd(14), r.slice(0, 90)); await p.close();
  }
  await b.close();
})();
