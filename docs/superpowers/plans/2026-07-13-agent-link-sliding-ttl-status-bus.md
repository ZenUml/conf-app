# Agent Link PR1 — Sliding TTL + Status Bus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sessions slide on real agent activity (idle 10 min, hard cap 60 min), the macro learns everything passively via one relay-originated `status` envelope, and guardrail-rejected edits become visible to the user.

**Architecture:** The AgentLinkSession Durable Object becomes the single expiry authority: every bump-worthy MCP request bumps `lastActivityMs` via a `?bump=1` flag riding the auth round-trip that already happens, re-arms the DO alarm at `min(lastActivity+10m, issuedAt+60m)`, and pushes a `{kind:'status', expiresAt, hitCap, activity?}` envelope down the macro's existing WebSocket. The client mirrors — never computes — the deadline. Guardrail rejects (which never reach the macro today) surface through the same bus via a new DO `/activity` ingress. Spec: `docs/superpowers/specs/2026-07-13-agent-link-sliding-ttl-and-activity-design.md` (v2).

**Tech Stack:** Cloudflare Pages Functions + companion Worker Durable Object (TypeScript), Vue 3 composables, Vitest, Playwright.

## Global Constraints

- **Pure Forge — no Connect code** (`AP.*`, `xdm_e` banned). Client relay code uses plain `fetch`/`WebSocket` against the already-allowlisted backend host (existing pattern in `relayUrl.ts`).
- **Client privacy:** no real tenant names in any file.
- **Policy (user-decided):** idle TTL **10 min**, absolute cap **60 min**. `get_status` / `initialize` / `tools/list` / `notifications/*` never bump; `tools/call` (except `get_status`) and `resources/read` bump. Guardrail-rejected `update_diagram` bumps (its auth already bumped).
- **Analytics events-first:** Task 1 (catalog/types) is the first commit on the branch.
- **Testing verdict (recon, evidence-based):** `forge tunnel` CANNOT exercise the relay WS — Forge's injected CSP allows `https://*.zenuml.com` but not `wss://` over the tunnel origin (memory `reference_agent_link_relay_ws_testing.md`, verified live). E2E therefore runs on **lite-stg** after the branch push deploys staging.
- **Deploy topology:** branch push auto-deploys BOTH the DO worker (`agent-link-worker-deploy.yml`, path-filtered on `functions/agent-link/**` + `workers/agent-link/**`, ~1–2 min → `conf-agent-link-stg`) and the Pages backend (`build-test-deploy.yml` → `conf-stg-lite`, ~5 min). DO lands first — matches the spec's required order. Both are SHARED staging targets — last writer wins across branches.
- **Commits:** one-line subject, no prose body (harness trailers excepted).
- **Unit tests:** `pnpm test:unit <paths>` (vitest). There is NO typecheck script; use `npx vue-tsc --noEmit` and compare against main's ~150 pre-existing errors — only NEW errors count.
- **Wire compat:** old macro clients silently ignore unknown envelope kinds (`relayClient.handleMessage` falls through) — `status` is backward-safe. Forwarded op envelopes stay verbatim; the relay NEVER stamps metadata into peer messages.

---

## File structure

- `src/utils/analytics/catalog.ts` / `types.ts` — register `agent_link_session_extended`, `AgentLinkExpiryCause`, new properties (Task 1).
- `functions/agent-link/sessionToken.ts` — pure TTL core: `IDLE_TTL_MS`, `MAX_SESSION_MS`, `effectiveExpiryMs`, `isAtCap`, 3-arg `isExpired`, `SessionRecord.lastActivityMs` (Task 2).
- `functions/agent-link/sessionRegistry.ts`, `mcpAuth.ts` — caller updates for the new record field / signature (Task 2).
- `functions/agent-link/forwarding.ts` — `statusEnvelope()` builder + `StatusActivity` type. `EnvelopeKind` (the PEER-message union) deliberately unchanged: peers must never send `status`, so `parseEnvelope` keeps rejecting it (Task 3).
- `functions/agent-link/AgentLinkSession.ts` — bump-on-auth, `/activity` ingress, status push, alarm re-arm, stored-record migration (Task 4).
- `functions/agent-link/session.ts` — mint `expiresInSec` = idle window; content-lock claimed at the 60-min cap (Task 5).
- `functions/agent-link/mcp.ts` — parse-body-before-auth reorder, bump-worthiness, `?bump=1`, guardrail-reject report (Task 6).
- `src/composables/agentLink/relayClient.ts` — receive `status` envelopes → `RelayStateEvent` (Task 7).
- `src/composables/agentLink/useAgentLinkSession.ts` — status branch: mirror deadline, throttled `session_extended`, guardrail feed row, `expiry_cause` (Task 8).
- `tests/e2e-tests/tests/agent-link/agent-link-e2e.spec.ts` — "TTL slides on activity" E2E (Task 10).

---

### Task 1: Analytics registration (events-first commit)

**Files:**
- Modify: `src/utils/analytics/catalog.ts` (union at ~line 171–227; reason enums at ~line 242+)
- Modify: `src/utils/analytics/types.ts` (imports ~line 17–21; agent-link property block ~line 140–185)

**Interfaces:**
- Produces: `"agent_link_session_extended"` member of `AnalyticsEventName`; `export type AgentLinkExpiryCause = "idle" | "absolute_cap"`; optional properties `expires_in_sec`, `hit_cap`, `expiry_cause` on `AnalyticsEventProperties`.

- [x] **Step 1: Add the event + enum to catalog.ts**

Next to the existing `"agent_link_session_expired"` member (~line 215), add:

```ts
  // PR1 sliding TTL (spec 2026-07-13 §7): fired by the relay owner when a
  // status envelope moves the deadline forward — throttled client-side to at
  // most one per minute, NOT one per op.
  | "agent_link_session_extended"
```

Near the other agent-link reason enums (~line 242+), add:

```ts
// Why a session finally expired under the sliding-TTL policy (spec
// 2026-07-13 §3): 'idle' = 10-min idle window lapsed; 'absolute_cap' = the
// 60-min hard cap bounded an otherwise-active session.
export type AgentLinkExpiryCause = "idle" | "absolute_cap";
```

- [x] **Step 2: Add the properties to types.ts**

Add `AgentLinkExpiryCause` to the existing catalog-type import block (~line 17–21), then in the agent-link property block (near `had_agent_connected`, ~line 155):

```ts
  // PR1 sliding TTL (spec 2026-07-13 §7).
  // agent_link_session_extended: seconds until the NEW deadline at fire time.
  expires_in_sec?: number;
  // True once the effective deadline is bounded by the 60-min absolute cap
  // rather than the 10-min idle window (both _extended and _expired carry it).
  hit_cap?: boolean;
  // agent_link_session_expired only.
  expiry_cause?: AgentLinkExpiryCause;
```

- [x] **Step 3: Verify it compiles standalone**

Run: `npx vue-tsc --noEmit 2>&1 | grep -E "catalog|analytics/types" | head`
Expected: no NEW errors mentioning these two files.

- [x] **Step 4: Commit**

```bash
git add src/utils/analytics/catalog.ts src/utils/analytics/types.ts
git commit -m "feat(analytics): register agent_link_session_extended + expiry_cause/hit_cap (events-first)"
```

---

### Task 2: sessionToken pure TTL core + caller updates

**Files:**
- Modify: `functions/agent-link/sessionToken.ts` (replace `TOKEN_TTL_MS` block at lines 47–48, `isExpired` at 69–72, extend `SessionRecord` at 38–45)
- Modify: `functions/agent-link/sessionRegistry.ts` (record literal lines 20–26; `expireStale` line 53)
- Modify: `functions/agent-link/mcpAuth.ts` (line 37)
- Test: `functions/agent-link/sessionToken.spec.ts`, `sessionRegistry.spec.ts`, `mcpAuth.spec.ts`

**Interfaces:**
- Produces (every later task consumes these exact names):
  - `export const IDLE_TTL_MS = 10 * 60 * 1000`
  - `export const MAX_SESSION_MS = 60 * 60 * 1000`
  - `effectiveExpiryMs(issuedAtMs: number, lastActivityMs: number): number`
  - `isAtCap(issuedAtMs: number, lastActivityMs: number): boolean`
  - `isExpired(issuedAtMs: number, lastActivityMs: number, nowMs: number): boolean` (**3-arg — signature change**)
  - `SessionRecord` gains required `lastActivityMs: number`
  - `TOKEN_TTL_MS` is **deleted** — grep confirms remaining importers are `session.ts`, `AgentLinkSession.ts`, `mcp.ts` (+ their specs), all updated in Tasks 4–6. This task may leave them temporarily red; run ONLY the three spec files below in this task.

- [x] **Step 1: Write the failing tests**

In `sessionToken.spec.ts`, replacing tests that reference `TOKEN_TTL_MS`:

```ts
import { effectiveExpiryMs, isAtCap, isExpired, IDLE_TTL_MS, MAX_SESSION_MS } from './sessionToken';

describe('sliding TTL core (spec 2026-07-13 §3)', () => {
  const T0 = 1_000_000;

  it('fresh session expires at issuedAt + idle window', () => {
    expect(effectiveExpiryMs(T0, T0)).toBe(T0 + IDLE_TTL_MS);
  });

  it('a bump slides the deadline', () => {
    const bumped = T0 + 5 * 60_000;
    expect(effectiveExpiryMs(T0, bumped)).toBe(bumped + IDLE_TTL_MS);
  });

  it('the absolute cap bounds a fully-active session', () => {
    const lateBump = T0 + 55 * 60_000; // idle window would reach 65 min
    expect(effectiveExpiryMs(T0, lateBump)).toBe(T0 + MAX_SESSION_MS);
    expect(isAtCap(T0, lateBump)).toBe(true);
    expect(isAtCap(T0, T0)).toBe(false);
  });

  it('isExpired honors the slid deadline', () => {
    const bumped = T0 + 5 * 60_000;
    expect(isExpired(T0, bumped, bumped + IDLE_TTL_MS - 1)).toBe(false);
    expect(isExpired(T0, bumped, bumped + IDLE_TTL_MS)).toBe(true);
    // v1 behavior would have expired here (10 min past issue); sliding must not:
    expect(isExpired(T0, bumped, T0 + IDLE_TTL_MS + 1)).toBe(false);
  });

  it('isExpired is clamped by the cap even with continuous bumps', () => {
    const nowAtCap = T0 + MAX_SESSION_MS;
    expect(isExpired(T0, nowAtCap - 1, nowAtCap)).toBe(true);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm test:unit functions/agent-link/sessionToken.spec.ts`
Expected: FAIL — `effectiveExpiryMs` not exported.

- [x] **Step 3: Implement**

In `sessionToken.ts`, replace lines 47–48 and 69–72:

```ts
/** Sliding-TTL policy (spec 2026-07-13 §3, user-decided): each bump-worthy
 * agent request resets a 10-min idle window; no session outlives 60 min. */
export const IDLE_TTL_MS = 10 * 60 * 1000;
export const MAX_SESSION_MS = 60 * 60 * 1000;

/** The server-authoritative deadline: min(idle window, absolute cap). */
export function effectiveExpiryMs(issuedAtMs: number, lastActivityMs: number): number {
  return Math.min(lastActivityMs + IDLE_TTL_MS, issuedAtMs + MAX_SESSION_MS);
}

/** True once the deadline is bounded by the cap, not the idle window —
 * carried on status envelopes so the client can report expiry_cause. */
export function isAtCap(issuedAtMs: number, lastActivityMs: number): boolean {
  return lastActivityMs + IDLE_TTL_MS >= issuedAtMs + MAX_SESSION_MS;
}

/** True once `nowMs` is at or past the effective (slid, capped) deadline. */
export function isExpired(issuedAtMs: number, lastActivityMs: number, nowMs: number): boolean {
  return nowMs >= effectiveExpiryMs(issuedAtMs, lastActivityMs);
}
```

`SessionRecord` (lines 38–45) gains, after `issuedAtMs`:

```ts
  /** Last bump-worthy agent activity (spec 2026-07-13 §3); starts = issuedAtMs. */
  lastActivityMs: number;
```

`sessionRegistry.ts`: record literal adds `lastActivityMs: <same Date.now() value as issuedAtMs>` — hoist `const nowMs = Date.now()` and use it for both fields; `expireStale` line 53 becomes `isExpired(record.issuedAtMs, record.lastActivityMs, nowMs)`.
`mcpAuth.ts` line 37 becomes `isExpired(session.issuedAtMs, session.lastActivityMs, nowMs)`.
Fix any `SessionRecord` literals in these three spec files by adding `lastActivityMs` (same value as `issuedAtMs` unless the test is about sliding).

- [x] **Step 4: Run the three spec files**

Run: `pnpm test:unit functions/agent-link/sessionToken.spec.ts functions/agent-link/sessionRegistry.spec.ts functions/agent-link/mcpAuth.spec.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add functions/agent-link/sessionToken.ts functions/agent-link/sessionToken.spec.ts functions/agent-link/sessionRegistry.ts functions/agent-link/sessionRegistry.spec.ts functions/agent-link/mcpAuth.ts functions/agent-link/mcpAuth.spec.ts
git commit -m "feat(agent-link): sliding-TTL core — effectiveExpiry = min(lastActivity+10m, issuedAt+60m)"
```

---

### Task 3: statusEnvelope builder (forwarding.ts)

**Files:**
- Modify: `functions/agent-link/forwarding.ts`
- Test: `functions/agent-link/forwarding.spec.ts`

**Interfaces:**
- Produces: `export interface StatusActivity { type: 'agent_request' | 'guardrail_rejected' | 'turn'; detail?: string }`; `export function statusEnvelope(expiresAt: number, hitCap: boolean, activity?: StatusActivity): string`.
- Deliberate factoring (documents a small spec-v2 deviation): `status` is NOT added to `EnvelopeKind` — that union describes PEER messages, and a peer sending `status` must stay `invalid`/unrouted. The relay-originated envelope gets its own builder instead.

- [x] **Step 1: Write the failing tests**

Append to `forwarding.spec.ts`:

```ts
import { statusEnvelope, parseEnvelope, routeMessage } from './forwarding';

describe('statusEnvelope (relay-originated status bus, spec 2026-07-13 §4)', () => {
  it('serializes expiresAt + hitCap, omitting activity when absent', () => {
    expect(JSON.parse(statusEnvelope(1234, false))).toEqual({ kind: 'status', expiresAt: 1234, hitCap: false });
  });

  it('carries an activity payload when given', () => {
    expect(JSON.parse(statusEnvelope(1234, true, { type: 'guardrail_rejected', detail: 'parse_error' }))).toEqual({
      kind: 'status', expiresAt: 1234, hitCap: true,
      activity: { type: 'guardrail_rejected', detail: 'parse_error' },
    });
  });

  it('a PEER-sent status stays invalid — relay-originated only', () => {
    const parsed = parseEnvelope(statusEnvelope(1234, false));
    expect(parsed.kind).toBe('invalid');
  });
});
```

- [x] **Step 2: Run to verify failure** — `pnpm test:unit functions/agent-link/forwarding.spec.ts` → FAIL (no export).

- [x] **Step 3: Implement** — append to `forwarding.ts`:

```ts
/** Activity descriptor carried on a relay-originated status envelope
 * (spec 2026-07-13 §4): 'agent_request' = a bump-worthy MCP request;
 * 'guardrail_rejected' = mcp.ts's update_diagram guard refused a write the
 * macro never saw; 'turn' = a host-side hook bracket (PR3, reserved). */
export interface StatusActivity {
  type: 'agent_request' | 'guardrail_rejected' | 'turn';
  detail?: string;
}

/** Builds the ONE relay-originated envelope kind (macro-bound, never routed
 * between peers — parseEnvelope deliberately keeps rejecting a peer-sent
 * 'status'). Everything the macro passively learns rides this: the fresh
 * authoritative deadline, whether the 60-min cap now bounds it, and any
 * non-forwarded activity worth showing. */
export function statusEnvelope(expiresAt: number, hitCap: boolean, activity?: StatusActivity): string {
  return JSON.stringify({ kind: 'status', expiresAt, hitCap, ...(activity ? { activity } : {}) });
}
```

- [x] **Step 4: Run** — same command → PASS (including the peer-rejection test, which needs no code change).

- [x] **Step 5: Commit**

```bash
git add functions/agent-link/forwarding.ts functions/agent-link/forwarding.spec.ts
git commit -m "feat(agent-link): statusEnvelope builder — the relay-originated status bus message"
```

---

### Task 4: AgentLinkSession DO — bump, /activity ingress, status push, alarm re-arm

**Files:**
- Modify: `functions/agent-link/AgentLinkSession.ts`
- Test: `functions/agent-link/AgentLinkSession.spec.ts` (harness: `makeState()` with Map-backed storage at lines 36–58; set private fields via `as any`; macro socket = `{ send: vi.fn() }`)

**Interfaces:**
- Consumes: Task 2's `effectiveExpiryMs`/`isAtCap`/`isExpired`/`IDLE_TTL_MS`, Task 3's `statusEnvelope`.
- Produces: `GET /session?bump=1` (bumps + re-arms + pushes status; response unchanged plus `expiresAtMs`); `POST /activity` body `{type:'guardrail_rejected'|'agent_request'|'turn', detail?}` → 200 `{ok:true}` (auth'd like `/session`); status pushes on the macro socket.

- [x] **Step 1: Write the failing tests**

Add to `AgentLinkSession.spec.ts` (follow the existing harness idioms exactly):

```ts
describe('sliding TTL + status bus (spec 2026-07-13 §4.2)', () => {
  const T0 = Date.now();

  function liveSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
    return {
      token: 'CL-TEST-0001',
      boundContext: { cloudId: 'c1', pageId: 'p1', contentId: 'ct1' },
      scope: 'read-page+write-diagram',
      issuedAtMs: T0,
      lastActivityMs: T0,
      state: 'created',
      ...overrides,
    };
  }

  it('GET /session?bump=1 bumps lastActivity, re-arms the alarm, pushes status', async () => {
    const store = new Map<string, unknown>();
    const state = makeState(store);
    const doInstance = new AgentLinkSession(state, {});
    (doInstance as any).session = liveSession();
    const macroSend = vi.fn();
    (doInstance as any).macroSocket = { send: macroSend };

    const res = await doInstance.fetch(new Request('https://do/session?bump=1'));
    expect(res.status).toBe(200);

    const session = (doInstance as any).session as SessionRecord;
    expect(session.lastActivityMs).toBeGreaterThanOrEqual(T0);
    expect(state.storage.setAlarm).toHaveBeenCalledWith(
      effectiveExpiryMs(session.issuedAtMs, session.lastActivityMs),
    );
    expect(store.get('session')).toEqual(session); // persisted for hibernation wakes
    const pushed = JSON.parse(macroSend.mock.calls[0][0]);
    expect(pushed.kind).toBe('status');
    expect(pushed.expiresAt).toBe(effectiveExpiryMs(session.issuedAtMs, session.lastActivityMs));
    expect(pushed.hitCap).toBe(false);
  });

  it('GET /session without bump does NOT bump or push', async () => {
    const doInstance = new AgentLinkSession(makeState(), {});
    (doInstance as any).session = liveSession();
    const macroSend = vi.fn();
    (doInstance as any).macroSocket = { send: macroSend };
    await doInstance.fetch(new Request('https://do/session'));
    expect(((doInstance as any).session as SessionRecord).lastActivityMs).toBe(T0);
    expect(macroSend).not.toHaveBeenCalled();
  });

  it('POST /activity pushes a status envelope carrying the activity', async () => {
    const doInstance = new AgentLinkSession(makeState(), {});
    (doInstance as any).session = liveSession();
    const macroSend = vi.fn();
    (doInstance as any).macroSocket = { send: macroSend };
    const res = await doInstance.fetch(new Request('https://do/activity', {
      method: 'POST',
      body: JSON.stringify({ type: 'guardrail_rejected', detail: 'parse_error' }),
    }));
    expect(res.status).toBe(200);
    const pushed = JSON.parse(macroSend.mock.calls[0][0]);
    expect(pushed.activity).toEqual({ type: 'guardrail_rejected', detail: 'parse_error' });
  });

  it('bump with no macro socket still succeeds (push is best-effort)', async () => {
    const doInstance = new AgentLinkSession(makeState(), {});
    (doInstance as any).session = liveSession();
    const res = await doInstance.fetch(new Request('https://do/session?bump=1'));
    expect(res.status).toBe(200);
  });

  it('validateSession honors a slid deadline (alive past issuedAt+10min)', async () => {
    const doInstance = new AgentLinkSession(makeState(), {});
    (doInstance as any).session = liveSession({
      issuedAtMs: Date.now() - 15 * 60_000,          // 15 min old — dead under v1
      lastActivityMs: Date.now() - 2 * 60_000,        // active 2 min ago — alive now
    });
    const res = await doInstance.fetch(new Request('https://do/session'));
    expect(res.status).toBe(200);
  });

  it('ensureSession migrates a pre-PR1 stored record (no lastActivityMs)', async () => {
    const store = new Map<string, unknown>();
    const legacy = liveSession();
    delete (legacy as any).lastActivityMs;
    store.set('session', legacy);
    const doInstance = new AgentLinkSession(makeState(store), {});
    const res = await doInstance.fetch(new Request('https://do/session'));
    expect(res.status).toBe(200); // NaN deadline would 403 here
  });
});
```

- [x] **Step 2: Run to verify failure** — `pnpm test:unit functions/agent-link/AgentLinkSession.spec.ts` → FAIL.

- [x] **Step 3: Implement in `AgentLinkSession.ts`**

Imports (line 73): swap `TOKEN_TTL_MS` for `effectiveExpiryMs, IDLE_TTL_MS, isAtCap`, keep `isExpired, nextState`; add `statusEnvelope` + `StatusActivity` to the forwarding import (line 69).

New private helper (near `transition`, ~line 333):

```ts
  /** Records bump-worthy agent activity (spec 2026-07-13 §3/§4.2): slides the
   * idle window, re-arms the expiry alarm at the new effective deadline, and
   * pushes a status envelope so the macro passively learns the fresh deadline
   * (and any non-forwarded activity). Push is best-effort — a missing/closing
   * macro socket must never fail the agent's request. */
  private async bumpActivity(activity?: StatusActivity): Promise<void> {
    if (!this.session) return;
    this.session.lastActivityMs = Date.now();
    await this.state.storage.put('session', this.session);
    const deadline = effectiveExpiryMs(this.session.issuedAtMs, this.session.lastActivityMs);
    await this.state.storage.setAlarm(deadline);
    this.pushStatus(activity);
  }

  /** Sends {kind:'status'} to the macro socket, if one is live. */
  private pushStatus(activity?: StatusActivity): void {
    if (!this.session || !this.macroSocket) return;
    try {
      this.macroSocket.send(
        statusEnvelope(
          effectiveExpiryMs(this.session.issuedAtMs, this.session.lastActivityMs),
          isAtCap(this.session.issuedAtMs, this.session.lastActivityMs),
          activity,
        ),
      );
    } catch {
      // Best-effort — the socket may be closing; the agent's request must not fail.
    }
  }
```

Route changes in `fetch` (lines 352–357): `handleSessionInfo` gains the request —

```ts
    if (url.pathname === '/session' && request.method === 'GET') {
      return this.handleSessionInfo(url.searchParams.get('bump') === '1');
    }
    if (url.pathname === '/activity' && request.method === 'POST') {
      return this.handleActivity(request);
    }
```

`handleSessionInfo(bump: boolean)` (line 501): after auth passes, before building the response:

```ts
    if (bump) await this.bumpActivity();
```

and add to the response body: `expiresAtMs: effectiveExpiryMs(session.issuedAtMs, session.lastActivityMs)`.

New `handleActivity` (mirror `handleContentClaim`'s body-validation shape):

```ts
  /** `POST /activity` — the non-forwarded-activity ingress (spec §4.2): today
   * mcp.ts reports guardrail rejects here; PR3's host hooks will reuse it.
   * Any report is real agent engagement → bump + status push. */
  private async handleActivity(request: Request): Promise<Response> {
    await this.ensureSession();
    const auth = this.validateSession();
    if (!auth.ok) return jsonResponse({ error: auth.code }, auth.status);
    let body: { type?: unknown; detail?: unknown };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid_body' }, 400);
    }
    const type = body?.type;
    if (type !== 'guardrail_rejected' && type !== 'agent_request' && type !== 'turn') {
      return jsonResponse({ error: 'invalid_body' }, 400);
    }
    const detail = typeof body?.detail === 'string' ? body.detail : undefined;
    await this.bumpActivity({ type, ...(detail ? { detail } : {}) });
    return jsonResponse({ ok: true }, 200);
  }
```

Deadline-derivation sweep (every `TOKEN_TTL_MS` site):
- `validateSession` (line 487): `isExpired(this.session.issuedAtMs, this.session.lastActivityMs, Date.now())`.
- `handleAgentOp` suspended branch (line 547): `const resume_deadline = effectiveExpiryMs(session.issuedAtMs, session.lastActivityMs);`
- `handleAgentOp` get_status (line 575–578): `expiresInSec: Math.max(0, Math.round((effectiveExpiryMs(session.issuedAtMs, session.lastActivityMs) - Date.now()) / 1000))`.
- Bootstrap (lines 395–407): record gains `lastActivityMs: Date.now()` (hoist `const nowMs = Date.now()` for both fields); alarm becomes `await this.state.storage.setAlarm(effectiveExpiryMs(this.session.issuedAtMs, this.session.lastActivityMs));` (replaces the hardcoded `+ 10 * 60 * 1000`).
- `ensureSession` (line 169), migration for in-flight pre-PR1 records: after `this.session = stored;` add

```ts
    // Migration: a record persisted by pre-PR1 code has no lastActivityMs —
    // backfill with issuedAtMs (v1-equivalent deadline) so effectiveExpiryMs
    // never sees undefined (NaN would 403 every live session at deploy time).
    if (typeof (this.session as Partial<SessionRecord>).lastActivityMs !== 'number') {
      this.session.lastActivityMs = this.session.issuedAtMs;
    }
```

- `alarm()` (line 765): wrap with a re-arm branch —

```ts
  async alarm(): Promise<void> {
    if (!this.session) return;
    if (!isExpired(this.session.issuedAtMs, this.session.lastActivityMs, Date.now())) {
      // A bump slid the deadline past this (already-replaced) alarm — re-arm
      // defensively at the current effective deadline instead of expiring.
      await this.state.storage.setAlarm(
        effectiveExpiryMs(this.session.issuedAtMs, this.session.lastActivityMs),
      );
      return;
    }
    /* existing expiry teardown body unchanged */
  }
```

- [x] **Step 4: Run** — `pnpm test:unit functions/agent-link/AgentLinkSession.spec.ts` → PASS (fix any pre-existing tests constructing `SessionRecord` without `lastActivityMs`).

- [x] **Step 5: Commit**

```bash
git add functions/agent-link/AgentLinkSession.ts functions/agent-link/AgentLinkSession.spec.ts
git commit -m "feat(agent-link): DO bumps on ?bump=1 + /activity ingress, re-arms alarm, pushes status envelopes"
```

---

### Task 5: session.ts — mint window + content-lock at the cap

**Files:**
- Modify: `functions/agent-link/session.ts` (lines 10, 77, 88)
- Test: `functions/agent-link/session.spec.ts`

**Interfaces:**
- Consumes: `IDLE_TTL_MS`, `MAX_SESSION_MS` (Task 2).
- Produces: mint response `expiresInSec: 600` (idle window — unchanged value, new derivation); content-claim `expiresAt: Date.now() + MAX_SESSION_MS`.

- [x] **Step 1: Write the failing test** (add to `session.spec.ts`, following its existing request-builder idioms):

```ts
it('claims the content lock for the ABSOLUTE cap, not the idle window (spec §4.3)', async () => {
  // Under sliding TTL a session can outlive a 10-min lock — a lock claimed at
  // the 60-min cap covers the whole possible lifetime with no refresh path.
  const claims: Array<{ expiresAt: number }> = [];
  const env = {
    AGENT_LINK: {
      idFromName: (name: string) => ({ name }),
      get: () => ({
        fetch: async (_url: string, init?: RequestInit) => {
          claims.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      }),
    },
  };
  const before = Date.now();
  const res = await onRequestPost(makeContext(env, { cloudId: 'c', pageId: 'p', contentId: 'ct' }));
  expect(res.status).toBe(200);
  expect(claims[0].expiresAt).toBeGreaterThanOrEqual(before + MAX_SESSION_MS);
  expect((await res.json()).expiresInSec).toBe(IDLE_TTL_MS / 1000);
});
```

(Adapt `makeContext` to however the existing spec builds a `PagesFunction` context — reuse its helper.)

- [x] **Step 2: Run to verify failure** — `pnpm test:unit functions/agent-link/session.spec.ts` → FAIL (lock claimed at +10 min).

- [x] **Step 3: Implement** — in `session.ts`: import `IDLE_TTL_MS, MAX_SESSION_MS` instead of `TOKEN_TTL_MS`; line 77 `expiresAt: Date.now() + MAX_SESSION_MS` (update the surrounding comment: the lock must cover the whole POSSIBLE session lifetime under sliding TTL — spec §4.3); line 88 `expiresInSec: IDLE_TTL_MS / 1000`.

- [x] **Step 4: Run** — same command → PASS.

- [x] **Step 5: Commit**

```bash
git add functions/agent-link/session.ts functions/agent-link/session.spec.ts
git commit -m "fix(agent-link): content-lock claimed at the 60-min cap so sliding sessions can't outlive it"
```

---

### Task 6: mcp.ts — bump-worthiness rides auth; guardrail rejects reported

**Files:**
- Modify: `functions/agent-link/mcp.ts`
- Test: `functions/agent-link/mcp.spec.ts` (harness `makeDoEnv` at lines 284–304)

**Interfaces:**
- Consumes: DO routes from Task 4 (`/session?bump=1`, `/activity`).
- Produces: auth requests carry `?bump=1` iff bump-worthy; a `ToolError` with `code === 'guardrail'` triggers a best-effort `POST /activity {type:'guardrail_rejected', detail}`.
- **Ordering change (documented):** body is parsed BEFORE auth (bump-worthiness needs `method`/`params.name`). The blank-token 401 stays first. Net observable change: invalid-token + malformed-JSON now 400s (was 401) — update any spec asserting that combination.

- [x] **Step 1: Write the failing tests** (add to `mcp.spec.ts` using `makeDoEnv`, extending its fake stub to RECORD fetched URLs):

```ts
it('tools/call (non-get_status) auths with ?bump=1', async () => {
  const { env, fetchedUrls } = makeRecordingDoEnv(/* session: live, agentOp: ok */);
  await onRequestPost(makeCtx(env, rpc('tools/call', { name: 'read_diagram', arguments: {} })));
  expect(fetchedUrls.some((u) => u.endsWith('/session?bump=1'))).toBe(true);
});

it('get_status and tools/list auth WITHOUT bump', async () => {
  const { env, fetchedUrls } = makeRecordingDoEnv(/* ... */);
  await onRequestPost(makeCtx(env, rpc('tools/call', { name: 'get_status', arguments: {} })));
  await onRequestPost(makeCtx(env, rpc('tools/list')));
  expect(fetchedUrls.every((u) => !u.includes('bump=1'))).toBe(true);
});

it('resources/read auths WITH bump', async () => { /* same pattern, expect bump=1 */ });

it('a guardrail rejection reports POST /activity {type:guardrail_rejected}', async () => {
  // Arrange a DO whose /session returns a lastDiagram snapshot that makes
  // updateDiagramGuard reject (e.g. new dsl unparseable for the cached type),
  // then call tools/call update_diagram and assert the recorded /activity POST.
  const { env, activityBodies } = makeRecordingDoEnv(/* session with lastDiagram */);
  const res = await onRequestPost(makeCtx(env, rpc('tools/call', {
    name: 'update_diagram', arguments: { dsl: '<<<not a diagram>>>' },
  })));
  const rpcBody = await res.json();
  expect(rpcBody.error.code).toBe(-32004); // RPC_GUARDRAIL_REJECTED — unchanged
  expect(activityBodies[0].type).toBe('guardrail_rejected');
});
```

Write `makeRecordingDoEnv` as a thin wrapper over the existing `makeDoEnv` pattern that also collects `fetchedUrls: string[]` and `activityBodies: any[]` (parse `init.body` for `/activity` calls). Reuse an existing guardrail-reject fixture from the current spec file if one exists (search `RPC_GUARDRAIL_REJECTED` / `-32004` in `mcp.spec.ts` and copy its arrangement).

- [x] **Step 2: Run to verify failure** — `pnpm test:unit functions/agent-link/mcp.spec.ts` → new tests FAIL.

- [x] **Step 3: Implement in `mcp.ts`**

1. `authenticateViaDo(agentLink, token, bump: boolean)` (line 173): `stub.fetch('https://agent-link-do/session' + (bump ? '?bump=1' : ''), { method: 'GET' })`.
2. In `onRequestPost` (line 324): move the body-parse + method-validation block (lines 354–363) to directly AFTER the blank-token check (line 335), then compute:

```ts
  // Bump-worthiness (spec 2026-07-13 §3): real work slides the idle window;
  // passive/handshake traffic must not keep a dead session alive.
  const params = (body.params ?? {}) as { name?: unknown };
  const bumpWorthy =
    (body.method === 'tools/call' && params.name !== 'get_status') ||
    body.method === 'resources/read';
```

then `authenticateViaDo(env.AGENT_LINK, token, bumpWorthy)`. The fallback `authenticateSession` branch is untouched (local dev never bumps).
3. Guardrail report — in the `tools/call` catch (line 454), inside the `ToolError` branch:

```ts
        if (err instanceof ToolError) {
          if (err.code === 'guardrail' && env?.AGENT_LINK) {
            // Surface the reject to the user via the DO's status bus — the
            // macro never saw this op (guard runs before forwarding), which
            // was the worst dead-air case (spec 2026-07-13 §1/§4.2).
            // Best-effort: a failed report must not mask the RPC error reply.
            try {
              const stub = env.AGENT_LINK.get(env.AGENT_LINK.idFromName(token));
              await stub.fetch('https://agent-link-do/activity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  type: 'guardrail_rejected',
                  detail: (err.data as { reason?: string } | undefined)?.reason ?? 'guardrail',
                }),
              });
            } catch {
              // swallow — see above
            }
          }
          /* existing code→jsonRpcError mapping unchanged */
```

4. `stubForwardToMacro` get_status (lines 299–311): replace the `TOKEN_TTL_MS` calc with `effectiveExpiryMs(session.issuedAtMs, session.lastActivityMs)`; update the import (line 35).

- [x] **Step 4: Run the whole file** — `pnpm test:unit functions/agent-link/mcp.spec.ts` → PASS (fix ordering-assumption tests per the Interfaces note).

- [x] **Step 5: Commit**

```bash
git add functions/agent-link/mcp.ts functions/agent-link/mcp.spec.ts
git commit -m "feat(agent-link): bump rides MCP auth (?bump=1); guardrail rejects reported to the status bus"
```

---

### Task 7: relayClient — receive status envelopes

**Files:**
- Modify: `src/composables/agentLink/relayClient.ts` (kinds at line 28, events at lines 56–67, handleMessage at lines 271–289)
- Test: `src/composables/agentLink/relayClient.spec.ts`

**Interfaces:**
- Produces: `RelayEnvelopeKind` gains `'status'`; `RelayEnvelope` gains `expiresAt?: number; hitCap?: boolean; activity?: { type: string; detail?: string }`; `RelayStateEvent` gains `{ type: 'status'; expiresAt?: number; hitCap?: boolean; activity?: { type: string; detail?: string } }`.

- [x] **Step 1: Write the failing tests** (follow the file's existing mock-WebSocket idiom):

```ts
it('emits a status state event for a relay-originated status envelope', () => {
  const events: RelayStateEvent[] = [];
  const { socket } = openClient({ onStateEvent: (e) => events.push(e) });
  socket.onmessage!({ data: JSON.stringify({ kind: 'status', expiresAt: 1234, hitCap: true, activity: { type: 'guardrail_rejected', detail: 'parse_error' } }) } as MessageEvent);
  expect(events).toContainEqual({ type: 'status', expiresAt: 1234, hitCap: true, activity: { type: 'guardrail_rejected', detail: 'parse_error' } });
});

it('a status envelope never reaches the op dispatcher', () => {
  const bridge = makeBridgeSpy();
  const { socket } = openClient({ bridge });
  socket.onmessage!({ data: JSON.stringify({ kind: 'status', expiresAt: 1 }) } as MessageEvent);
  expect(bridge.readPage).not.toHaveBeenCalled();
});
```

(`openClient`/`makeBridgeSpy`: reuse the spec file's existing helpers — they exist for every current test; adapt names to match.)

- [x] **Step 2: Run to verify failure** — `pnpm test:unit src/composables/agentLink/relayClient.spec.ts` → FAIL.

- [x] **Step 3: Implement** — in `relayClient.ts`: extend the two unions + `RelayEnvelope` per Interfaces; in `handleMessage` (after the `ping` check, line 279):

```ts
    if (envelope.kind === 'status') {
      // Relay-originated status bus (spec 2026-07-13 §4.4): the DO's own
      // message, not a peer's — carries the fresh authoritative deadline and
      // any non-forwarded activity. Surface as a state event; never an op.
      emit({ type: 'status', expiresAt: envelope.expiresAt, hitCap: envelope.hitCap, activity: envelope.activity })
      return
    }
```

- [x] **Step 4: Run** — same command → PASS.

- [x] **Step 5: Commit**

```bash
git add src/composables/agentLink/relayClient.ts src/composables/agentLink/relayClient.spec.ts
git commit -m "feat(agent-link): relayClient surfaces relay-originated status envelopes as state events"
```

---

### Task 8: useAgentLinkSession — mirror the deadline, throttled extended event, guardrail feed row, expiry_cause

**Files:**
- Modify: `src/composables/agentLink/useAgentLinkSession.ts`
- Test: `src/composables/agentLink/useAgentLinkSession.spec.ts` (existing injectable-clock idiom: `options.clock` + `relay.connect` fake)

**Interfaces:**
- Consumes: Task 7's `{type:'status'}` event; Task 1's event/properties.
- Produces: exported `EXTENDED_EVENT_THROTTLE_MS = 60_000`; exported `GUARDRAIL_REJECTED_FEED_SUMMARY = '⚠ Agent submitted an invalid edit — retrying'`.

- [x] **Step 1: Write the failing tests** (in the existing spec's style — fake relay `connect` capturing `onStateEvent`, injected clock):

```ts
describe('status bus handling (spec 2026-07-13 §4.4)', () => {
  it('a status event re-arms expiresAt and the expiry watchdog', () => {
    const h = mountWithRelay(); // helper: startConnect + resolve mint(expiresInSec:600) → captures onStateEvent
    h.emitStateEvent({ type: 'status', expiresAt: h.now() + 600_000, hitCap: false });
    expect(h.api.expiresAt.value).toBe(h.now() + 600_000);
    // advance past the ORIGINAL deadline: session must still be live
    h.advance(601_000 - 1);
    expect(h.api.state.value).not.toBe('expired');
  });

  it('fires agent_link_session_extended at most once per throttle window', () => {
    const h = mountWithRelay();
    h.emitStateEvent({ type: 'status', expiresAt: h.now() + 600_000 });
    h.emitStateEvent({ type: 'status', expiresAt: h.now() + 601_000 });
    expect(h.trackedEvents.filter((e) => e.name === 'agent_link_session_extended')).toHaveLength(1);
    h.advance(EXTENDED_EVENT_THROTTLE_MS);
    h.emitStateEvent({ type: 'status', expiresAt: h.now() + 700_000 });
    expect(h.trackedEvents.filter((e) => e.name === 'agent_link_session_extended')).toHaveLength(2);
  });

  it('guardrail_rejected activity appends the feed row', () => {
    const h = mountWithRelay();
    h.emitStateEvent({ type: 'status', expiresAt: h.now() + 600_000, activity: { type: 'guardrail_rejected', detail: 'parse_error' } });
    expect(h.api.activityFeed.value.at(-1)?.summary).toBe(GUARDRAIL_REJECTED_FEED_SUMMARY);
  });

  it('expiry after a capped status reports expiry_cause absolute_cap', () => {
    const h = mountWithRelay();
    h.emitStateEvent({ type: 'status', expiresAt: h.now() + 60_000, hitCap: true });
    h.advance(60_000);
    const expired = h.trackedEvents.find((e) => e.name === 'agent_link_session_expired');
    expect(expired?.props.expiry_cause).toBe('absolute_cap');
  });

  it('expiry with no status ever received reports expiry_cause idle', () => {
    const h = mountWithRelay(); // mint expiresInSec 600, no status events
    h.advance(600_000);
    const expired = h.trackedEvents.find((e) => e.name === 'agent_link_session_expired');
    expect(expired?.props.expiry_cause).toBe('idle');
  });
});
```

Build `mountWithRelay` on the spec file's existing fixtures (it already fakes `requestSession`, `connect`, `clock`, and spies `trackAnalyticsEvent` — reuse, don't reinvent).

- [x] **Step 2: Run to verify failure** — `pnpm test:unit src/composables/agentLink/useAgentLinkSession.spec.ts` → FAIL.

- [x] **Step 3: Implement in `useAgentLinkSession.ts`**

Module constants (near `SUSPENDED_FEED_SUMMARY`, line 70):

```ts
// PR1 status bus (spec 2026-07-13 §4.4/§5): guardrail rejects — previously
// invisible (the guard runs relay-side, the macro never sees the op) — get an
// honest feed row; deadline extensions fire a THROTTLED analytics event.
export const GUARDRAIL_REJECTED_FEED_SUMMARY = '⚠ Agent submitted an invalid edit — retrying'
export const EXTENDED_EVENT_THROTTLE_MS = 60_000
```

Internals (near `suspendedAt`, line 300): `let lastHitCap = false` and `let lastExtendedFiredAt = 0`.

New branch at the TOP of `handleRelayStateEvent` (line 306), before the `op` branch:

```ts
    if (event.type === 'status') {
      // Relay-originated status bus: mirror the DO's authoritative deadline —
      // never compute our own (spec §4). hitCap feeds expiry_cause later.
      if (typeof event.hitCap === 'boolean') lastHitCap = event.hitCap
      if (typeof event.expiresAt === 'number') {
        const prev = expiresAt.value
        expiresAt.value = event.expiresAt
        scheduleExpiry()
        if (prev != null && event.expiresAt > prev && now() - lastExtendedFiredAt >= EXTENDED_EVENT_THROTTLE_MS) {
          lastExtendedFiredAt = now()
          trackAnalyticsEvent('agent_link_session_extended', {
            feature_area: 'agent_link',
            surface: 'fullscreen',
            macro_type: macroType,
            expires_in_sec: Math.max(0, Math.round((event.expiresAt - now()) / 1000)),
            hit_cap: lastHitCap,
          })
        }
      }
      if (event.activity?.type === 'guardrail_rejected') {
        activityFeed.value = [...activityFeed.value, { summary: GUARDRAIL_REJECTED_FEED_SUMMARY, at: now() }]
      }
      // Republish so the Fullscreen mirror gets the new deadline + feed row
      // through the existing handoff path (no new plumbing — spec §4.4);
      // currentThinkingFlag() preserves any genuinely in-flight cue.
      publishThinking(currentThinkingFlag())
      return
    }
```

`handleExpired` (line 549), add to the tracked properties: `expiry_cause: lastHitCap ? 'absolute_cap' : 'idle', hit_cap: lastHitCap,`. Reset both new internals in `startConnect`'s reset block (line 841–847: `lastHitCap = false; lastExtendedFiredAt = 0`) and in `attemptReattach` (line 961–966: same).

Note: `lastExtendedFiredAt = 0` means the FIRST real extension always fires (0 is >60s before any real clock) — intended.

- [x] **Step 4: Run** — same command → PASS.

- [x] **Step 5: Commit**

```bash
git add src/composables/agentLink/useAgentLinkSession.ts src/composables/agentLink/useAgentLinkSession.spec.ts
git commit -m "feat(agent-link): client mirrors status-bus deadline; guardrail feed row; expiry_cause analytics"
```

---

### Task 9: Full validation sweep

**Files:** none new.

- [x] **Step 1: Full unit run** — `pnpm test:unit` → everything green (agent-link suites AND the rest — the SessionRecord shape change may ripple into e2e helper types or ApWrapper specs; fix forward).
- [x] **Step 2: Type delta vs main** — `npx vue-tsc --noEmit 2>&1 | tee /tmp/pr1-tsc.txt | wc -l`, then the same on `main` (stash/worktree). Only NEW errors block (~150 pre-existing).
- [x] **Step 3: Grep discipline** — `git grep -n TOKEN_TTL_MS` → zero hits; `git grep -rn "atlassian.net" -- ':!docs' ':!private'` over the diff → no tenant names.
- [x] **Step 4: Commit any fixups** — one-line subjects.

---

### Task 10: E2E — "TTL slides on agent activity" (runs on lite-stg after push)

**Files:**
- Modify: `tests/e2e-tests/tests/agent-link/agent-link-e2e.spec.ts` (+ `helpers/agentLink.ts` if a `getStatus` helper is missing)

**Interfaces:**
- Consumes: deployed staging (branch push → `conf-agent-link-stg` worker ~1–2 min + `conf-stg-lite` Pages ~5 min; verify BOTH workflow runs succeeded for this branch before running).
- Command: `cd tests/e2e-tests && APP=zenuml-lite@stg npx playwright test --project=agent-link --workers=1` (needs `ZENUML_STAGE_USERNAME`/`ZENUML_STAGE_PASSWORD`/`ATLASSIAN_OTP`; the fixed test page shares a 10-min per-contentId lock — one clean run per ~10 min).

- [x] **Step 1: Add the test** (inside the existing describe, reusing its connect fixture):

```ts
test('TTL slides on agent activity (PR1 sliding window)', async ({ page }) => {
  // ...existing connect + token acquisition boilerplate from the spec's first test...
  const s1 = await agentLinkMcp(token, 'tools/call', { name: 'get_status', arguments: {} });
  const e1 = s1.expiresInSec as number; // ~600 right after connect
  await page.waitForTimeout(20_000); // burn 20s of the idle window
  await agentLinkMcp(token, 'tools/call', { name: 'read_diagram', arguments: {} }); // bump
  const s2 = await agentLinkMcp(token, 'tools/call', { name: 'get_status', arguments: {} });
  const e2 = s2.expiresInSec as number;
  // Without sliding, e2 ≈ e1 - 20. With sliding, the read_diagram bump reset
  // the window: e2 ≈ 600 again. Allow generous network slop:
  expect(e2).toBeGreaterThan(e1 - 10);
});
```

(Match the helper's actual unwrap shape — `agentLinkMcp` returns the parsed `structuredContent`/text payload per the existing tests; get_status does NOT bump, so the probe itself can't mask a broken slide.)

- [x] **Step 2: Run it** — expected PASS against staging. Also run the full agent-link project once: the pre-existing pairing/edit/crosstalk tests must still pass.

- [x] **Step 3: Commit**

```bash
git add tests/e2e-tests
git commit -m "test(agent-link): e2e — idle window slides on agent activity, probe via get_status"
```

---

## Self-review

- **Spec coverage:** §3 policy → T2; §4.1 → T2; §4.2 (bump-on-auth, /activity, status push, alarm, deploy order) → T4+T6 + Global Constraints; §4.3 lock-at-cap → T5; §4.4 client → T7+T8; §5's PR1 slice (guardrail visibility) → T6+T8; §7 analytics → T1 (+T8 firing sites); §9 sequencing honored (PR2/PR3 out of scope). Open questions resolved: extended-event throttle = 60s (T8); status pushed on EVERY bump (T4 — simplicity, macro handler idempotent); `TOKEN_TTL_MS` cut cleanly (T2/T9 grep gate).
- **Placeholder scan:** all steps carry code or exact commands; the three "reuse the spec file's existing helper" notes name the helper and its location — adaptation, not invention.
- **Type consistency:** `effectiveExpiryMs(issuedAtMs, lastActivityMs)` / `isAtCap(...)` / 3-arg `isExpired` used identically in T2/T4/T5/T6; `statusEnvelope(expiresAt, hitCap, activity?)` identical in T3/T4; `{type:'status', expiresAt, hitCap, activity}` event shape identical in T7/T8; `lastActivityMs` required on `SessionRecord` everywhere.
- **Migration:** pre-PR1 persisted DO records backfilled in `ensureSession` (T4) — deploy-window sessions survive.

## Deviations (2026-07-16)

- **Suspended sessions do not bump.** `handleAgentOp`'s suspended branch
  returns before any bump-worthy call reaches the macro — retrying against a
  gone macro must not extend a macro-less session. The resume window shown is
  the remaining effective expiry at the moment of the drop, not a
  freshly-bumped one.
- **Lock strategy changed from mint-at-cap to mint-at-`IDLE_TTL_MS` +
  DO re-claim-at-cap on bootstrap.** Plan Task 5 originally called for
  claiming the content lock at `MAX_SESSION_MS` directly in the (unauthenticated)
  mint endpoint; that would let anyone grief a diagram with a full-hour
  exclusivity lock via repeated unauthenticated mints. Landed instead: mint
  claims the 10-min idle lock; the DO re-claims up to the 60-min cap on first
  authenticated bootstrap, best-effort (a failed re-claim leaves the shorter
  lock to self-clear).
- **Guardrail feed copy is `'— rejected'`, not `'— retrying'`** — the status
  push reports one rejection at a time and can't promise a retry, so the row
  states only what demonstrably happened.
- **The mint 409 now carries `lock_expires_at`**, forwarded by `session.ts`
  and surfaced client-side as `lockExpiresAt`, feeding an honest
  already-linked notice instead of a guessed retry window — required because
  the lock's true expiry now depends on whether the DO re-claimed it.
- **Task 5 lock value overridden** — see the mint-at-cap → mint-at-idle
  deviation above; Task 5's own commit landed the idle-window value, and the
  cap upgrade was added to Task 4's DO bootstrap in the same PR.
- **Task 10 staging run deferred to post-push.** The E2E spec (Task 10) was
  written and committed, but the live run against `lite-stg` was deferred
  until after this branch is pushed and both the DO worker and Pages backend
  deploys have completed (per the plan's own Global Constraints — staging
  requires the branch push first).
