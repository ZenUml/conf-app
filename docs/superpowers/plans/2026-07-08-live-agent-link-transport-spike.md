# Live Agent Link — Transport Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Determine which live-channel transport tier a Forge Custom UI iframe can hold to a relay endpoint on conf-app's existing (already-allowlisted) backend host — streaming (SSE / WSS) or long-poll — and whether the existing Forge remote path works, so the real relay/macro design (§4.7 of the design spec) is built on a verified transport instead of an assumption.

**Architecture:** Stand up throwaway relay test endpoints on the Cloudflare Pages backend (`/agent-link-spike/*`), a throwaway Forge Custom UI page that attempts each transport tier and reports results, deploy both to the **development** Forge env + staging backend, then drive the real Forge iframe with Playwright and record which tiers connect + round-trip latency. Output is a findings doc that picks the tier.

**Tech Stack:** Cloudflare Pages Functions (Workers runtime, `WebSocketPair`, SSE, long-poll), Forge Custom UI (`@forge/bridge`), Playwright (crosses the OOPIF), pnpm.

## Global Constraints

- **Pure Forge — no Connect code.** No `AP.*`, `xdm_e`, Connect hosts. Use `@forge/bridge` only. (design spec + CLAUDE.md)
- **Client privacy — no real tenant names** in any public-repo file. Use `example-tenant` / `example.atlassian.net`. Spike findings with real tenant data go in the `private/` submodule. (CLAUDE.md)
- **New Cloudflare function paths MUST be added to `public/_routes.json`** `include` array, else Pages serves them as SPA HTML. (CLAUDE.md)
- **Deploy discipline:** local deploys to the **development** Forge env only; **staging backend deploys go via CI/CD on a pushed branch**, and need an explicit go-ahead before triggering. (memory: feedback_no_local_staging_deploy, feedback_deployment_discipline)
- **Dev env target:** `FORGE_ENV=development`, site `lite-dev.atlassian.net`. (memory: feedback_forge_local_env)
- **This is throwaway spike code.** Everything under `*-spike*` paths + the temporary manifest module is deleted after the findings doc lands (Task 6). Do not wire it into product flows.

---

## File structure

- `functions/agent-link-spike/sse.ts` — SSE endpoint, emits a tick every 2s + echoes injected messages.
- `functions/agent-link-spike/ws.ts` — WebSocket endpoint (echo + server-push).
- `functions/agent-link-spike/poll.ts` — long-poll endpoint, holds the request up to 25s.
- `functions/agent-link-spike/push.ts` — inject a message into a spike "room" (drives round-trip tests).
- `functions/agent-link-spike/_room.ts` — tiny in-memory/KV room registry shared by the above (spike-grade; no durability needed).
- `public/_routes.json` — add `/agent-link-spike/*` to `include`.
- `static/spike/agent-link-transport/index.html` — throwaway Custom UI page attempting all tiers, rendering a result table + a global `window.__spikeResults` for Playwright.
- `manifest.yml` — temporary Custom UI resource + module pointing at the spike page; **record whether the backend host is already in `permissions.external.fetch`** before adding it.
- `tests/spike/agent-link-transport.spec.ts` — Playwright: open the spike page in the real Forge iframe, wait for `__spikeResults`, assert/record per-tier connect + round-trip.
- `docs/superpowers/specs/2026-07-08-live-agent-link-transport-spike-findings.md` — the decision record (output).

---

## Task 1: Relay spike endpoints (SSE / WS / long-poll / push)

**Files:**
- Create: `functions/agent-link-spike/_room.ts`, `functions/agent-link-spike/sse.ts`, `functions/agent-link-spike/ws.ts`, `functions/agent-link-spike/poll.ts`, `functions/agent-link-spike/push.ts`
- Modify: `public/_routes.json` (add `/agent-link-spike/*` to `include`)

**Interfaces:**
- Produces: HTTP endpoints `GET /agent-link-spike/sse?room=<id>`, `GET /agent-link-spike/ws?room=<id>` (Upgrade: websocket), `GET /agent-link-spike/poll?room=<id>&since=<n>`, `POST /agent-link-spike/push?room=<id>` body `{msg}`. All return permissive CORS for the spike.

- [ ] **Step 1: Write the room helper**

Create `functions/agent-link-spike/_room.ts`:

```ts
// Spike-grade in-memory room registry. One isolate may not see another's
// state on Cloudflare — acceptable: SSE/WS hold a single connection in one
// isolate; long-poll uses the `since` cursor + a KV fallback if bound.
type Room = { seq: number; msgs: { seq: number; msg: string; t: number }[] };
const rooms = new Map<string, Room>();
export function room(id: string): Room {
  let r = rooms.get(id);
  if (!r) { r = { seq: 0, msgs: [] }; rooms.set(id, r); }
  return r;
}
export function pushMsg(id: string, msg: string) {
  const r = room(id); r.seq += 1; r.msgs.push({ seq: r.seq, msg, t: Date.now() });
  if (r.msgs.length > 50) r.msgs.shift();
  return r.seq;
}
export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};
```

- [ ] **Step 2: Write the SSE endpoint**

Create `functions/agent-link-spike/sse.ts`:

```ts
import { room, CORS } from './_room';
export const onRequestGet: PagesFunction = async ({ request }) => {
  const id = new URL(request.url).searchParams.get('room') || 'default';
  const enc = new TextEncoder();
  let timer: number;
  const stream = new ReadableStream({
    start(ctrl) {
      let lastSeq = 0;
      ctrl.enqueue(enc.encode(`event: open\ndata: sse-ready\n\n`));
      timer = setInterval(() => {
        const r = room(id);
        r.msgs.filter(m => m.seq > lastSeq).forEach(m => {
          lastSeq = m.seq;
          ctrl.enqueue(enc.encode(`event: msg\ndata: ${JSON.stringify(m)}\n\n`));
        });
        ctrl.enqueue(enc.encode(`event: tick\ndata: ${Date.now()}\n\n`));
      }, 2000) as unknown as number;
    },
    cancel() { clearInterval(timer); },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...CORS },
  });
};
```

- [ ] **Step 3: Write the WebSocket endpoint**

Create `functions/agent-link-spike/ws.ts`:

```ts
export const onRequestGet: PagesFunction = async ({ request }) => {
  if (request.headers.get('Upgrade') !== 'websocket')
    return new Response('expected websocket', { status: 426 });
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
  server.accept();
  server.send(JSON.stringify({ type: 'open', msg: 'ws-ready' }));
  server.addEventListener('message', (e) =>
    server.send(JSON.stringify({ type: 'echo', msg: String(e.data), t: Date.now() })));
  const iv = setInterval(() => server.send(JSON.stringify({ type: 'tick', t: Date.now() })), 2000);
  server.addEventListener('close', () => clearInterval(iv));
  return new Response(null, { status: 101, webSocket: client });
};
```

- [ ] **Step 4: Write the long-poll + push endpoints**

Create `functions/agent-link-spike/poll.ts`:

```ts
import { room, CORS } from './_room';
export const onRequestGet: PagesFunction = async ({ request }) => {
  const u = new URL(request.url);
  const id = u.searchParams.get('room') || 'default';
  const since = Number(u.searchParams.get('since') || '0');
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const fresh = room(id).msgs.filter(m => m.seq > since);
    if (fresh.length) return Response.json({ msgs: fresh, ts: Date.now() }, { headers: CORS });
    await new Promise(r => setTimeout(r, 500));
  }
  return Response.json({ msgs: [], ts: Date.now(), timeout: true }, { headers: CORS });
};
```

Create `functions/agent-link-spike/push.ts`:

```ts
import { pushMsg, CORS } from './_room';
export const onRequestPost: PagesFunction = async ({ request }) => {
  const id = new URL(request.url).searchParams.get('room') || 'default';
  const body = await request.json().catch(() => ({ msg: '' })) as { msg?: string };
  const seq = pushMsg(id, body.msg || '');
  return Response.json({ ok: true, seq }, { headers: CORS });
};
export const onRequestOptions: PagesFunction = async () => new Response(null, { headers: CORS });
```

- [ ] **Step 5: Add the routes to the allowlist**

In `public/_routes.json`, add `"/agent-link-spike/*"` to the `include` array (keep existing entries).

- [ ] **Step 6: Verify locally with wrangler**

Run: `pnpm wrangler pages dev` (or the repo's serve script — check `package.json`), then in another shell:
```bash
curl -N http://localhost:8788/agent-link-spike/sse?room=t   # expect: event: open / periodic tick
curl -s -X POST 'http://localhost:8788/agent-link-spike/push?room=t' -H 'content-type: application/json' -d '{"msg":"hi"}'  # {"ok":true,"seq":1}
curl -s 'http://localhost:8788/agent-link-spike/poll?room=t&since=0'   # {"msgs":[{..."hi"}]}
```
Expected: SSE streams `open`+`tick`; push returns `seq`; poll returns the pushed msg. (WS is verified from the browser in Task 4.)

- [ ] **Step 7: Commit**

```bash
git add functions/agent-link-spike public/_routes.json
git commit -m "spike: relay transport test endpoints (sse/ws/long-poll) for agent-link"
```

---

## Task 2: Deploy relay endpoints to the staging backend

> **CHECKPOINT — needs explicit go-ahead** (staging backend deploy, per Global Constraints). Do not run until the user says go.

**Files:** none new — this deploys Task 1 via CI/CD on a pushed branch.

**Interfaces:**
- Produces: public URLs `https://<staging-backend-host>/agent-link-spike/{sse,ws,poll,push}` reachable from the Forge iframe.

- [ ] **Step 1: Push the spike branch to trigger the staging Pages deploy**

```bash
git push -u origin HEAD   # this branch; CI deploys the Pages backend to the staging Lite project
```

- [ ] **Step 2: Confirm the deploy is live from the public internet**

Run (replace host with the staging Lite backend, e.g. the `conf-stg-lite` domain from docs/ops/cloudflare-pages.md):
```bash
curl -N 'https://<staging-backend-host>/agent-link-spike/sse?room=probe'   # expect event: open + ticks
curl -s -X POST 'https://<staging-backend-host>/agent-link-spike/push?room=probe' -d '{"msg":"x"}' -H 'content-type: application/json'
```
Expected: `content-type: text/event-stream` (NOT `text/html` — if HTML, `_routes.json` include is wrong). Note the exact host for Task 3.

- [ ] **Step 3: (no commit — deploy only)**

---

## Task 3: Forge Custom UI spike page + manifest wiring

**Files:**
- Create: `static/spike/agent-link-transport/index.html`
- Modify: `manifest.yml` (temporary resource + module; record egress state)

**Interfaces:**
- Consumes: the staging backend host from Task 2.
- Produces: a Custom UI page that sets `window.__spikeResults = { sse, ws, poll }` where each is `{ connected: boolean, firstMsgMs: number|null, roundTripMs: number|null, error?: string }`.

- [ ] **Step 1: Record the current egress state (the re-consent answer)**

Read `manifest.yml` `permissions.external.fetch`. **Write down** whether the staging backend host is ALREADY listed (→ tier-1 streaming needs no new host → minor version) or NOT (→ new host → major version). This boolean is a spike finding.

- [ ] **Step 2: Write the spike page**

Create `static/spike/agent-link-transport/index.html` — a page that, on load, runs all three attempts against a fixed `HOST` and `room` (query param), each with an 8s budget, and writes `window.__spikeResults`. Include a visible result table for manual runs. Key logic (inline `<script>`):

```js
const HOST = new URLSearchParams(location.search).get('host'); // staging backend host
const room = 'spike-' + Math.random().toString(36).slice(2, 8);
const out = { sse: null, ws: null, poll: null };
const started = Date.now();

async function testSSE() {
  return await new Promise((resolve) => {
    const t0 = Date.now(); let first = null;
    const es = new EventSource(`https://${HOST}/agent-link-spike/sse?room=${room}`);
    const done = (r) => { es.close(); resolve(r); };
    es.addEventListener('open', () => { first = Date.now() - t0; });
    es.addEventListener('tick', () => { if (first != null) done({ connected: true, firstMsgMs: first, roundTripMs: null }); });
    es.onerror = () => done({ connected: false, firstMsgMs: first, roundTripMs: null, error: 'sse error' });
    setTimeout(() => done({ connected: first != null, firstMsgMs: first, roundTripMs: null, error: 'timeout' }), 8000);
  });
}
async function testWS() {
  return await new Promise((resolve) => {
    const t0 = Date.now();
    let ws; try { ws = new WebSocket(`wss://${HOST}/agent-link-spike/ws?room=${room}`); }
    catch (e) { return resolve({ connected: false, error: 'ctor blocked: ' + e.message }); }
    const done = (r) => { try { ws.close(); } catch {} resolve(r); };
    ws.onopen = () => ws.send('ping-' + t0);
    ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.type === 'echo') done({ connected: true, firstMsgMs: null, roundTripMs: Date.now() - t0 }); };
    ws.onerror = () => done({ connected: false, error: 'ws error' });
    setTimeout(() => done({ connected: false, error: 'timeout' }), 8000);
  });
}
async function testPoll() {
  const t0 = Date.now();
  try {
    await fetch(`https://${HOST}/agent-link-spike/push?room=${room}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ msg: 'poll-ping' }) });
    const r = await fetch(`https://${HOST}/agent-link-spike/poll?room=${room}&since=0`);
    const j = await r.json();
    return { connected: !!j.msgs?.length, firstMsgMs: null, roundTripMs: Date.now() - t0 };
  } catch (e) { return { connected: false, error: 'fetch blocked: ' + e.message }; }
}
(async () => {
  out.sse = await testSSE(); render();
  out.ws = await testWS(); render();
  out.poll = await testPoll(); render();
  window.__spikeResults = { ...out, elapsedMs: Date.now() - started };
})();
function render() { document.getElementById('r').textContent = JSON.stringify(out, null, 2); }
```
(Add a minimal `<pre id="r"></pre>` and a heading.)

- [ ] **Step 3: Wire a temporary Custom UI module in manifest.yml**

Add a resource pointing at `static/spike/agent-link-transport` and a module that renders it (a `confluence:globalPage` is simplest — no macro context needed). Add the staging backend host to `permissions.external.fetch` if not already present. Keep the diff small and clearly `spike`-tagged.

- [ ] **Step 4: Deploy + install to the development env**

```bash
forge deploy --environment development
forge install --upgrade --environment development --site lite-dev.atlassian.net
```
(Check `package.json` for a `forge:deploy:*:dev` wrapper and prefer it if present.)
Expected: deploy reports **minor** version if the host was already allowlisted, **major** if a new egress host was added — record which (confirms Step 1).

- [ ] **Step 5: Commit**

```bash
git add static/spike/agent-link-transport manifest.yml
git commit -m "spike: forge custom UI page probing sse/ws/long-poll transport tiers"
```

---

## Task 4: Drive the real Forge iframe with Playwright + record results

**Files:**
- Create: `tests/spike/agent-link-transport.spec.ts`

**Interfaces:**
- Consumes: `window.__spikeResults` from the deployed spike page.

- [ ] **Step 1: Write the Playwright probe**

Create `tests/spike/agent-link-transport.spec.ts`: log into `lite-dev.atlassian.net`, open the global page hosting the spike module, get the Forge Custom UI iframe via `frameLocator`, `waitForFunction(() => window.__spikeResults)` (up to 40s), read it, and `console.log` + `test.info().attach` the JSON. Assert nothing hard — this is a probe; the goal is the recorded object. (Follow existing `tests/e2e-tests/` login + Forge-iframe patterns; reuse the Lite profile.)

- [ ] **Step 2: Run it against lite-dev**

Run: `pnpm test:e2e -- tests/spike/agent-link-transport.spec.ts` (or the repo's Playwright invocation — check `package.json`). 
Expected: prints `__spikeResults` with per-tier `connected`/timing. This is the raw finding.

- [ ] **Step 3: Cross-check the existing-Forge-remote path (tier 3)**

In the spike page (or a second run), add a probe that reaches the poll endpoint via `@forge/bridge` `invokeRemote`/`requestConfluence` against conf-app's **existing** remote (no new egress) instead of direct `fetch`, and record whether long-poll survives the Forge remote proxy's request timeout. Record the max hold duration observed.

- [ ] **Step 4: Commit**

```bash
git add tests/spike/agent-link-transport.spec.ts
git commit -m "spike: playwright probe recording forge-iframe transport tier results"
```

---

## Task 5: Findings doc + decision, then tear down

**Files:**
- Create: `docs/superpowers/specs/2026-07-08-live-agent-link-transport-spike-findings.md`
- Modify: design spec `2026-07-08-live-agent-link-design.md` §4.7 / §13.1 (record the chosen tier)
- Delete: all `*agent-link-spike*` functions, the spike static page, the temporary manifest module, the spike test (after findings recorded)

- [ ] **Step 1: Write the findings**

Record, from Task 3–4 data: per-tier `connected` + latency; whether the backend host was already egress-allowlisted (major vs minor); tier-3 long-poll max hold via the Forge remote. Conclude with the **chosen transport** and its consequence for the relay/macro design (e.g. "SSE works from the iframe on the existing host → tier 1, minor version" or "streaming blocked → tier 2 long-poll via existing remote").

- [ ] **Step 2: Update the design spec**

In `2026-07-08-live-agent-link-design.md`, replace §13.1's "unverified" with the resolved tier and update §4.7 to mark the chosen tier.

- [ ] **Step 3: Remove the throwaway spike code**

```bash
git rm -r functions/agent-link-spike static/spike/agent-link-transport tests/spike/agent-link-transport.spec.ts
# revert the temporary manifest module + _routes.json spike entry (keep any egress finding noted in the doc)
```

- [ ] **Step 4: Redeploy dev to drop the spike module**

```bash
forge deploy --environment development
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "spike: record agent-link transport findings; remove throwaway probe"
```

---

## Self-review

- **Spec coverage:** This plan covers only design-spec §13.1 (the load-bearing transport spike) + the §4.7 tier decision — by intent. Full-feature coverage (relay/DO, macro bridge ops, MCP remote mode, Connect UI, analytics events) is deferred to plans #2–4, written after this spike resolves the transport tier.
- **Placeholder scan:** endpoint code, curl commands, and the probe logic are concrete. Two deliberately-parameterized values — the **staging backend host** (resolved in Task 2 Step 2 from `docs/ops/cloudflare-pages.md`) and the exact **pnpm/forge script names** (resolved from `package.json`) — are looked up during execution rather than guessed, to avoid fabricating names.
- **Consistency:** room API (`room`/`pushMsg`/`CORS`), endpoint paths (`/agent-link-spike/{sse,ws,poll,push}`), and `window.__spikeResults` shape are used consistently across Tasks 1, 3, 4.
- **Throwaway discipline:** Task 5 deletes every spike artifact; nothing wires into product flows.
