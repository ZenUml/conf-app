// Measure Confluence page load with per-macro (Forge iframe) readiness.
// Supports cold/warm HTTP cache and Chrome DevTools "Fast 4G" network throttling via CDP.
//
// Usage:
//   node tools/perf/measure-page-load.mjs \
//     --url https://<site>.atlassian.net/wiki/spaces/X/pages/<id>/Title \
//     --label prod-none-cold --throttle none|fast4g --cache cold|warm \
//     --runs 3 --expect 6 --out /path/to/outdir --storage /path/to/storage-state.json \
//     [--timeout 180000] [--headless]
//
// Caveats (methodology):
// - Throttling is applied per CDP target. OOPIF (cross-origin iframe) targets are throttled
//   on 'frameattached', so each iframe's *initial HTML document* request may escape throttling.
//   All iframe subresources (JS bundles, API calls) are throttled. Main frame is fully throttled.
// - Cold cache = Network.clearBrowserCache before navigation. Cookies/localStorage persist
//   (returning-user-with-evicted-cache semantics). No service workers on these pages (verified).
// - Warm cache = one discarded priming load per context before measured runs.

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const nxt = process.argv[i + 1];
    if (nxt && !nxt.startsWith('--')) { args[k] = nxt; i++; } else { args[k] = true; }
  }
}

const URL_ = args.url;
const LABEL = args.label || 'run';
const THROTTLE = args.throttle || 'none';
const CACHE = args.cache || 'cold';
const RUNS = parseInt(args.runs || '3', 10);
const EXPECT = parseInt(args.expect || '6', 10);
const OUT = args.out || 'perf-results';
const TIMEOUT = parseInt(args.timeout || '180000', 10);
const STORAGE = args.storage;

if (!URL_) { console.error('need --url'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

// Chrome DevTools "Fast 4G" preset (devtools-frontend front_end/core/sdk/NetworkManager.ts):
// 9 Mbps down * .9, 1.5 Mbps up * .9, 60ms target RTT * 2.75 applied latency
const FAST4G = {
  offline: false,
  downloadThroughput: 9 * 1000 * 1000 / 8 * 0.9,
  uploadThroughput: 1.5 * 1000 * 1000 / 8 * 0.9,
  latency: 60 * 2.75,
};
const NO_THROTTLE = { offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0 };

// Readiness probe evaluated inside each candidate iframe. Returns a type string once the
// macro's actual content (not just viewer chrome) is present.
const READY_FN = () => {
  const q = (s) => document.querySelector(s);
  if (q('.paywall-banner')) return 'paywall';
  // Type-specific containers that only exist once the diagram is actually rendered.
  if (q('.sequence-diagram')) return 'zenuml';
  if (q('.swagger-ui .opblock') || q('.swagger-ui .operation-tag-content')) return 'openapi';
  // Size-gated: viewer chrome carries 16-20px icon svgs; real diagrams are >=100px.
  // (mermaid/plantuml/graph render a bare svg/img straight into the canvas)
  const canvas = q('.graph-viewer-canvas') || q('.viewer-canvas') || q('.screen-capture-content');
  if (canvas) {
    for (const el of canvas.querySelectorAll('svg, img, canvas')) {
      const r = el.getBoundingClientRect();
      if (r.height >= 100 && r.width >= 100) return 'diagram-svg';
    }
  }
  // Non-Lite frames (e.g. AsyncAPI embed) - recorded but excluded from the KPI.
  if (document.body && document.body.innerText.length > 200 && q('svg')) return 'text-content';
  return null;
};

const FRAME_LABEL_FN = () => {
  const t = document.querySelector('.viewer-title');
  if (t && t.textContent.trim()) return t.textContent.trim().slice(0, 60);
  const lines = (document.body ? document.body.innerText : '').split('\n').filter(Boolean);
  return (lines[5] || lines[0] || '').slice(0, 60);
};

const PERF_COLLECT_FN = () => {
  const nav = performance.getEntriesByType('navigation')[0];
  const paints = performance.getEntriesByType('paint').map(p => ({ name: p.name, t: Math.round(p.startTime) }));
  let lcp = null;
  try {
    const po = new PerformanceObserver(() => {});
    po.observe({ type: 'largest-contentful-paint', buffered: true });
    const rs = po.takeRecords();
    if (rs.length) { const last = rs[rs.length - 1]; lcp = { t: Math.round(last.startTime), size: last.size }; }
  } catch (e) {}
  return {
    timeOrigin: performance.timeOrigin,
    nav: nav ? {
      ttfb: Math.round(nav.responseStart),
      responseEnd: Math.round(nav.responseEnd),
      dcl: Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd),
      transfer: nav.transferSize,
      proto: nav.nextHopProtocol,
    } : null,
    paints, lcp,
    resources: performance.getEntriesByType('resource').map(r => ({
      u: r.name.slice(0, 250),
      it: r.initiatorType,
      s: Math.round(r.startTime),
      d: Math.round(r.duration),
      rs: Math.round(r.responseStart),
      tx: r.transferSize,
      enc: r.encodedBodySize,
      dec: r.decodedBodySize,
      p: r.nextHopProtocol,
    })),
  };
};

function decodeMixpanel(post) {
  try {
    if (!post) return null;
    let payload = post;
    if (payload.startsWith('data=')) payload = decodeURIComponent(payload.slice(5).replace(/\+/g, '%20'));
    let json;
    try { json = JSON.parse(payload); }
    catch { json = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')); }
    return Array.isArray(json) ? json : [json];
  } catch { return null; }
}

const MP_PROP_KEYS = ['macro_type', 'duration_ms', 'fetch_ms', 'render_ms', 'event_category', 'load_type', 'renderer', 'cache', 'source', 'content_provider',
  // #382 gate + phase decomposition (load-gate spike)
  'bootstrap_ms', 'context_ms', 'measured_sum_ms', 'content_source', 'cache_state',
  'render_gate', 'render_deferred_ms', 'visible_at_boot', 'gate_mode'];

// --cpu <rate>: CDP CPU throttling multiplier (e.g. 4). Applied to the main
// frame AND every OOPIF target — Forge macro iframes run in their own
// renderer processes, so throttling only the main target would leave the
// macro JS at full speed.
const CPU_RATE = parseFloat(args.cpu || '0') || 0;

async function applyThrottle(context, target, conditions) {
  try {
    const s = await context.newCDPSession(target);
    await s.send('Network.enable');
    if (conditions) await s.send('Network.emulateNetworkConditions', conditions);
    if (CPU_RATE > 1) await s.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });
    return s;
  } catch { return null; }
}

async function runOnce(context, runIdx, { throttled, cold, discard }) {
  const page = await context.newPage();
  const sessions = [];
  const cdpMain = await context.newCDPSession(page);
  await cdpMain.send('Network.enable');
  if (cold) await cdpMain.send('Network.clearBrowserCache');
  if (throttled) await cdpMain.send('Network.emulateNetworkConditions', FAST4G);

  if (CPU_RATE > 1) await cdpMain.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });

  const frameSessionQueue = [];
  page.on('frameattached', (f) => {
    if (throttled || CPU_RATE > 1) {
      const p = applyThrottle(context, f, throttled ? FAST4G : null).then(s => { if (s) sessions.push(s); });
      frameSessionQueue.push(p.catch(() => {}));
    }
  });

  const reqLog = [];
  const mixpanel = [];
  let consoleErrors = 0;
  const tStart = Date.now();
  page.on('request', (r) => {
    const u = r.url();
    reqLog.push({ u: u.slice(0, 250), m: r.method(), rt: r.resourceType(), t: Date.now() - tStart, f: (r.frame() ? r.frame().url() : '').slice(0, 100) });
    if (/mixpanel\.com/.test(u) && r.method() === 'POST') {
      const evs = decodeMixpanel(r.postData());
      if (evs) for (const e of evs) {
        const props = {};
        for (const k of MP_PROP_KEYS) if (e.properties && e.properties[k] !== undefined) props[k] = e.properties[k];
        mixpanel.push({ event: e.event, t: Date.now() - tStart, props });
      }
    }
  });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors++; });

  let navError = null;
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: TIMEOUT }).catch(e => { navError = String(e).slice(0, 200); });

  // Poll frames for macro readiness
  const frameState = new Map();
  const deadline = tStart + TIMEOUT;
  let settledAt = null;
  let lastNewReadyAt = null;
  while (Date.now() < deadline) {
    for (const f of page.frames()) {
      if (f === page.mainFrame() || frameState.has(f)) continue;
      const u = f.url();
      if (!/atlassian-dev\.net|zenapi\.zenuml\.com/.test(u)) continue;
      const type = await f.evaluate(READY_FN).catch(() => null);
      if (type) { frameState.set(f, { type, readyMs: Date.now() - tStart, url: u.slice(0, 120) }); lastNewReadyAt = Date.now(); }
    }
    // KPI frames only: paywall banner and non-Lite embeds don't count toward EXPECT
    const kpiCount = [...frameState.values()].filter(x => x.type !== 'paywall' && x.type !== 'text-content').length;
    if (kpiCount >= EXPECT) {
      if (!settledAt) settledAt = Date.now();
      // linger 6s: catch stragglers + the mixpanel batch flush (default 5s interval)
      if (Date.now() - settledAt > 6000) break;
    }
    // stagnation exit: something rendered but nothing new for 45s -> a frame will never arrive
    if (lastNewReadyAt && Date.now() - lastNewReadyAt > 45000) break;
    await page.waitForTimeout(250);
  }

  // Collect per-frame data
  const frames = [];
  for (const [f, st] of frameState) {
    let label = null, perf = null;
    try { label = await f.evaluate(FRAME_LABEL_FN); } catch {}
    try { perf = await f.evaluate(PERF_COLLECT_FN); } catch {}
    frames.push({ label, ...st, perf });
  }
  let mainPerf = null;
  try { mainPerf = await page.mainFrame().evaluate(PERF_COLLECT_FN); } catch {}

  const readyTimes = frames.filter(x => x.type !== 'paywall' && x.type !== 'text-content').map(x => x.readyMs);
  const result = {
    label: LABEL, runIdx, url: URL_, throttle: throttled ? 'fast4g' : 'none', cache: cold ? 'cold' : 'warm',
    discard: !!discard, navError, consoleErrors,
    tsStart: new Date(tStart).toISOString(),
    summary: {
      framesReady: frameState.size,
      firstMacroMs: readyTimes.length ? Math.min(...readyTimes) : null,
      allMacrosMs: readyTimes.length ? Math.max(...readyTimes) : null,
      paywallMs: (frames.find(x => x.type === 'paywall') || {}).readyMs ?? null,
      mainTtfb: mainPerf?.nav?.ttfb ?? null,
      mainDcl: mainPerf?.nav?.dcl ?? null,
      mainLoad: mainPerf?.nav?.load ?? null,
      mainLcp: mainPerf?.lcp?.t ?? null,
      totalRequests: reqLog.length,
      cacheHitRatio: (() => {
        const all = [...(mainPerf?.resources || []), ...frames.flatMap(fr => fr.perf?.resources || [])];
        if (!all.length) return null;
        return +(all.filter(r => r.tx === 0).length / all.length).toFixed(3);
      })(),
    },
    frames: frames.map(fr => ({ label: fr.label, type: fr.type, readyMs: fr.readyMs, url: fr.url, nav: fr.perf?.nav, timeOrigin: fr.perf?.timeOrigin, resources: fr.perf?.resources })),
    mainPerf,
    mixpanel,
    reqLog,
  };

  // Teardown: reset emulation, detach sessions
  await Promise.all(frameSessionQueue);
  for (const s of sessions) { try { await s.send('Network.emulateNetworkConditions', NO_THROTTLE); await s.detach(); } catch {} }
  try { await cdpMain.send('Network.emulateNetworkConditions', NO_THROTTLE); await cdpMain.detach(); } catch {}
  await page.close().catch(() => {});

  if (!discard) {
    const file = path.join(OUT, `${LABEL}-run${runIdx}.json`);
    fs.writeFileSync(file, JSON.stringify(result));
    console.log(`[${LABEL} run${runIdx}] firstMacro=${result.summary.firstMacroMs}ms allMacros=${result.summary.allMacrosMs}ms paywall=${result.summary.paywallMs}ms dcl=${result.summary.mainDcl}ms load=${result.summary.mainLoad}ms lcp=${result.summary.mainLcp}ms frames=${result.summary.framesReady} cacheHit=${result.summary.cacheHitRatio} reqs=${result.summary.totalRequests}${navError ? ' NAVERR=' + navError : ''}`);
  } else {
    console.log(`[${LABEL} prime] frames=${frameState.size} allMacros=${readyTimes.length ? Math.max(...readyTimes) : 'n/a'}ms (discarded)`);
  }
  return result;
}

const browser = await chromium.launch({ headless: args.headless === true });
const context = await browser.newContext({
  storageState: STORAGE,
  viewport: { width: 1440, height: 900 },
});

// --set-ls key=value: seed a localStorage key in EVERY frame (init script runs
// in OOPIFs too), e.g. --set-ls zenuml.gateMode=load for the #382 load-gate
// spike. The Forge iframe origin is unreachable via storageState origins
// (dynamic CDN host), so an init script is the only reliable seeding point.
if (args['set-ls']) {
  const eq = String(args['set-ls']).indexOf('=');
  const k = String(args['set-ls']).slice(0, eq), v = String(args['set-ls']).slice(eq + 1);
  await context.addInitScript(([key, val]) => {
    try { localStorage.setItem(key, val); } catch { /* opaque/sandboxed origin */ }
  }, [k, v]);
}

try {
  if (CACHE === 'warm') {
    // priming load: unthrottled, populates cache; discarded
    await runOnce(context, -1, { throttled: false, cold: false, discard: true });
  }
  for (let i = 1; i <= RUNS; i++) {
    await runOnce(context, i, { throttled: THROTTLE === 'fast4g', cold: CACHE === 'cold', discard: false });
  }
} finally {
  await context.close();
  await browser.close();
}
