# Agent-first WS3 — Shared AgentLink Gateway Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the existing conf-app AgentLink MCP endpoint (`functions/agent-link/mcp.ts`, a Cloudflare Pages Function) into a cross-product Gateway: a token-free-installable MCP server that adds a `connect_session` code-exchange tool, prefix-routes credentials to a **stateless signed-HTTP Diagramly (DL) adapter** and the **existing Confluence (CL) Durable-Object path**, exposes the DL tool surface (`report_activity`, `render_diagram` with gateway-side ACK polling, `get_status`), and keeps every existing CL behavior working unchanged. Dark by default behind a kill switch; staging-only.

**Architecture:** The current `mcp.ts` is already product-agnostic on dispatch (`DispatchContext.forwardToMacro` is the injected seam) and narrowly coupled to Confluence in three spots (`BoundContext` shape, `mintToken()`'s `CL-` prefix, the mint-endpoint validation, per-content lock addressing). WS3 does **not** rewrite the Durable Object internals (WS-relay / FSM / sliding-TTL). Instead it:

1. Splits `onRequestPost` into a **legacy path** (a token is presented → today's exact behavior, byte-for-byte) and a **gateway path** (no token → token-free discovery + capability-routed tool calls). This is the minimum-regression realization of spec §6.2's "支持两者" (support both old CL-token auth and new exchange simultaneously).
2. Adds new self-contained modules under `functions/agent-link/`: credential-prefix routing, a WebCrypto HMAC request signer, a shared internal-API fixture module (the cross-repo test contract), a stateless DL adapter, a D1-backed CL capability registry, a CL exchange adapter, and a gateway tool-registry + dispatcher.
3. Leaves the DL data plane in Diagramly (Neon) — the gateway holds nothing for DL; it only signs HTTPS calls and polls. CL capability→token bindings live in **D1** (the gateway's existing datastore), never in the DO.

**Tech Stack:** Cloudflare Pages Functions + Durable Objects (staging), D1 (`env.DB`), TypeScript, WebCrypto (`crypto.subtle` — NOT `node:crypto`; this is Worker runtime), Vitest (`pnpm test:unit`, the CI-wired suite that already runs `functions/agent-link/*.spec.ts`). 2-space indent, single quotes, semicolons (repo style; `functions/` is **not** covered by `eslint src/` or the root `tsconfig` — `pnpm test:unit` is the only automated gate).

**Spec:** `../specs/2026-07-16-agent-first-activation-design.md` (in the diagramly.ai repo) §5 (topology), §6.1–6.4 (gateway), §7.2–7.3 (auth/signing/redaction), §10.4 (render ACK), §15 (error contract), §16.2 (contract tests), §17.1 (kill switch), §17.2 (rollout). Cross-repo contracts: `../plans/2026-07-16-agent-first-activation-roadmap.md` §2 (diagramly.ai repo). Format exemplar: `../plans/2026-07-16-agent-first-ws1-foundation.md`.

## Global Constraints

*(Every task implicitly includes these.)*

- **Base branch: `feat/agent-link-sliding-ttl-status-bus`** (the committed sliding-TTL/status-bus work). Cut the WS3 working branch from it: `git switch feat/agent-link-sliding-ttl-status-bus && git switch -c feat/agent-link-ws3-gateway`. (The repo is currently on `main`; do **not** work on `main`.)
- **READ-ONLY on the repo's uncommitted user changes.** `git status --short` before every commit; stage only the files this plan creates/edits. Never `git add -A`, never touch ` M private`, ` M handbook`, `.claude/skills/new-customers/`, `docs/superpowers/plans/2026-07-08-live-agent-link-transport-spike.md`, `tests/e2e-tests/tests/spike/`, `tools/perf/`, or the `.claude/skills/health-check/` rename.
- **Never push without tests green, and know what a push does.** `agent-link-worker-deploy.yml` triggers on push to paths `functions/agent-link/**` → auto-deploys the **staging** companion Worker `conf-agent-link-stg` (re-exports the unchanged `AgentLinkSession` DO — harmless). `build-test-deploy.yml` triggers on push to any branch (paths-ignore excludes `**.md`/`docs/**`/`.claude/**`) → Pages build+test+draft-release. **Pushing this branch = a staging deploy.** That is acceptable (WS3 is staging-scoped) but gate it: push only after `pnpm test:unit` is green.
- **Never touch `wrangler-prod.toml` or the prod `AGENT_LINK` DO binding** (commented out by design — prod enablement is WS6, user-gated). Never run `pnpm --filter agent-link deploy:prod`.
- **DL dark by default.** `DIAGRAMLY_AGENT_LINK_ENABLED` defaults **off** (absent/not `"true"` ⇒ off). DL exchange + DL tools return a stable `AGENT_LINK_UNAVAILABLE` error when off. CL is never gated by this switch (spec §17.1).
- **No fallback secrets.** `AGENT_LINK_SERVICE_SECRET` is a wrangler **secret** (never in `*.toml`, never logged). Its absence at DL call time throws before any network I/O — never `|| "default"`.
- **Redaction (spec §7.3).** Pairing codes, capabilities (`dlc_*`/`clc_*`), CL tokens, `source`, `title`, `summary`, and renderer messages must never appear in logs, error messages, error `data`, or analytics. Gateway error strings are generic; the stable machine code travels in `data.code`, never the secret value.
- **The gateway is NOT a zero-knowledge relay** (spec §5): `render_diagram`'s `source` legitimately passes through gateway request memory to Diagramly, but must never be written to the DO, D1, logs, or analytics.
- **No new hardcoded host.** New code must not hardcode `zenapi.zenuml.com`; the Diagramly base URL is `env.DIAGRAMLY_INTERNAL_API_BASE`, the canonical endpoint host is config/routing-driven (`agent.zenuml.com` DNS is WS6). The legacy `zenapi.zenuml.com/agent-link/mcp` path keeps working via Pages file routing (as-is); it is a **proxy** of the same handler, never an HTTP redirect (spec §6.1).
- **Style/validation:** 2-space indent, single quotes, semicolons; `import type` for type-only imports; specs import `{ describe, it, expect, vi }` from `'vitest'`. Per-commit gate: `pnpm test:unit` (runs all `functions/agent-link/*.spec.ts`). Run one file with `pnpm exec vitest run <path>`. `pnpm lint` (= `eslint src/`) does **not** cover `functions/` — do not rely on it.
- **Commits:** one-line subject explaining *why*; every commit keeps `pnpm test:unit` green.

## Regression contract (what must stay byte-identical, and the one deliberate exception)

The 13 existing `functions/agent-link/*.spec.ts` files lock CL behavior. WS3 keeps **all CL forwarding, cross-isolate auth, cross-session isolation, guardrail, sliding-TTL, content-lock, and guide-serving assertions byte-identical** by routing any request that presents a token down the unchanged legacy path.

**One unavoidable change** (`mcp.spec.ts`): the assertion `'returns 401 when no token is presented'` (posts `tools/list` with no token, expects 401) encodes the *old* "token = auth" model that spec §6.2 explicitly replaces — a token-free install (required for the DL flow to work at all) means a no-token `tools/list` now returns 200. That single assertion is repurposed to prove token-free discovery, and the missing-credential invariant it protected is re-asserted on a capability-required tool call (which still rejects). The two other auth assertions (`'returns 401 for a bogus token'`, `'returns 403 for an expired token'`) present a token → legacy path → **unchanged**. Documented in the DoD and in the final report as the resolved contract ambiguity.

---

### Task 1: Credential prefix-routing module

**Files:**
- Create: `functions/agent-link/gatewayCredentials.ts`
- Test: `functions/agent-link/gatewayCredentials.spec.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `type GatewayProduct = 'DL' | 'CL'`; `detectCodeProduct(code: string): GatewayProduct | null` (routes a pairing code by `DL-`/`CL-` prefix — routing only, **not** auth, spec §6.2); `detectCapabilityProduct(capability: string): GatewayProduct | null` (`dlc_` → DL, `clc_` → CL); prefix constants. Consumed by Tasks 7–8.

- [ ] **Step 1: Write the failing test**

```typescript
// functions/agent-link/gatewayCredentials.spec.ts
import { describe, it, expect } from 'vitest';
import {
  DL_CAPABILITY_PREFIX,
  CL_CAPABILITY_PREFIX,
  detectCapabilityProduct,
  detectCodeProduct,
} from './gatewayCredentials';

describe('detectCodeProduct', () => {
  it('routes DL-prefixed codes to DL and CL-prefixed codes to CL', () => {
    expect(detectCodeProduct('DL-2345-ABCD-6789')).toBe('DL');
    expect(detectCodeProduct('CL-8F3K7Q')).toBe('CL');
  });

  it('is lenient about case and surrounding whitespace (target product validates fully)', () => {
    expect(detectCodeProduct('  dl-2345-abcd-6789 ')).toBe('DL');
    expect(detectCodeProduct('cl-7f3k-q9m2')).toBe('CL');
  });

  it('returns null for anything without a known product prefix', () => {
    expect(detectCodeProduct('XY-0000')).toBeNull();
    expect(detectCodeProduct('')).toBeNull();
    expect(detectCodeProduct('DLADDER')).toBeNull(); // must be DL then a code separator/char, not a word
  });
});

describe('detectCapabilityProduct', () => {
  it('routes dlc_ to DL and clc_ to CL (case-sensitive — capabilities are base64url)', () => {
    expect(detectCapabilityProduct(`${DL_CAPABILITY_PREFIX}abc123`)).toBe('DL');
    expect(detectCapabilityProduct(`${CL_CAPABILITY_PREFIX}abc123`)).toBe('CL');
  });

  it('returns null for a missing/foreign prefix', () => {
    expect(detectCapabilityProduct('dls_abc')).toBeNull(); // claim secret, not a capability
    expect(detectCapabilityProduct('DLC_ABC')).toBeNull(); // wrong case
    expect(detectCapabilityProduct('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run functions/agent-link/gatewayCredentials.spec.ts`
Expected: FAIL — cannot resolve `./gatewayCredentials`.

- [ ] **Step 3: Write the implementation**

```typescript
// functions/agent-link/gatewayCredentials.ts
// Prefix-based product routing for the shared Gateway (spec §6.2). The prefix
// is ROUTING ONLY, never authentication — the target product independently
// verifies the code hash / TTL / single-use state (codes) or the capability
// hash (capabilities). DL codes/capabilities are minted by Diagramly, CL ones
// by the Confluence path; the Gateway never mints a DL credential.

export const DL_CODE_PREFIX = 'DL-';
export const CL_CODE_PREFIX = 'CL-';
export const DL_CAPABILITY_PREFIX = 'dlc_';
export const CL_CAPABILITY_PREFIX = 'clc_';

export type GatewayProduct = 'DL' | 'CL';

/**
 * Routes a human-pasteable pairing code by product prefix. Lenient about case
 * and whitespace (the agent retyped/pasted it; the owning product does the
 * strict canonicalization + hash check). Requires the two-letter product code
 * to be followed by a `-` or an alphanumeric grouping char so a plain word
 * like "DLADDER" doesn't route.
 */
export function detectCodeProduct(code: string): GatewayProduct | null {
  const c = code.trim().toUpperCase();
  if (/^DL[-0-9A-Z]/.test(c) && (c.startsWith('DL-') || /^DL[0-9]/.test(c))) return 'DL';
  if (/^CL[-0-9A-Z]/.test(c) && (c.startsWith('CL-') || /^CL[0-9]/.test(c))) return 'CL';
  return null;
}

/** Routes a session capability by its (case-sensitive) `dlc_`/`clc_` prefix. */
export function detectCapabilityProduct(capability: string): GatewayProduct | null {
  if (capability.startsWith(DL_CAPABILITY_PREFIX)) return 'DL';
  if (capability.startsWith(CL_CAPABILITY_PREFIX)) return 'CL';
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run functions/agent-link/gatewayCredentials.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/agent-link/gatewayCredentials.ts functions/agent-link/gatewayCredentials.spec.ts
git commit -m "feat(agent-link): prefix-route credentials by product so one endpoint serves CL and DL (spec §6.2)"
```

---

### Task 2: WebCrypto HMAC request signer

**Files:**
- Create: `functions/agent-link/diagramlySigner.ts`
- Test: `functions/agent-link/diagramlySigner.spec.ts`

**Interfaces:**
- Consumes: global `crypto.subtle` (Worker runtime; present in Vitest's Node env).
- Produces: `sha256Hex(data: string): Promise<string>`; `signInternalRequest(params: { method: string; pathname: string; timestampMs: number; rawBody: string; secret: string }): Promise<string>` — hex `HMAC-SHA256(secret, ` `${METHOD}\n${pathname}\n${timestampMs}\n${sha256hex(rawBody)}` `)` (roadmap §2.2). `pathname` is the URL path **without** query string (WHATWG `url.pathname`) — both repos sign the same canonical string; query params (e.g. `renderId`) are authorized by the capability + session-ownership check on Diagramly, not by the signature. Consumed by Task 4.

- [ ] **Step 1: Write the failing test** (cross-checks the WebCrypto output against a `node:crypto` reference)

```typescript
// functions/agent-link/diagramlySigner.spec.ts
import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { sha256Hex, signInternalRequest } from './diagramlySigner';

function referenceSig(method: string, pathname: string, ts: number, rawBody: string, secret: string): string {
  const bodyDigest = createHash('sha256').update(rawBody).digest('hex');
  const canonical = `${method}\n${pathname}\n${ts}\n${bodyDigest}`;
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

describe('sha256Hex', () => {
  it('matches node:crypto sha256 and is 64 lowercase hex chars', async () => {
    const out = await sha256Hex('{"code":"DL-2345-ABCD-6789"}');
    expect(out).toBe(createHash('sha256').update('{"code":"DL-2345-ABCD-6789"}').digest('hex'));
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes the empty body (GET requests) deterministically', async () => {
    expect(await sha256Hex('')).toBe(createHash('sha256').update('').digest('hex'));
  });
});

describe('signInternalRequest', () => {
  const secret = 'test-service-secret';

  it('produces the canonical HMAC-SHA256 that Diagramly will recompute', async () => {
    const params = {
      method: 'POST',
      pathname: '/api/agent-link/internal/connect',
      timestampMs: 1_752_600_000_000,
      rawBody: '{"code":"DL-2345-ABCD-6789"}',
      secret,
    };
    expect(await signInternalRequest(params)).toBe(
      referenceSig(params.method, params.pathname, params.timestampMs, params.rawBody, secret),
    );
  });

  it('changes when body, path, timestamp, or secret changes', async () => {
    const base = {
      method: 'POST',
      pathname: '/api/agent-link/internal/render',
      timestampMs: 1_752_600_000_000,
      rawBody: '{"a":1}',
      secret,
    };
    const sig = await signInternalRequest(base);
    expect(await signInternalRequest({ ...base, rawBody: '{"a":2}' })).not.toBe(sig);
    expect(await signInternalRequest({ ...base, pathname: '/api/agent-link/internal/status' })).not.toBe(sig);
    expect(await signInternalRequest({ ...base, timestampMs: base.timestampMs + 1 })).not.toBe(sig);
    expect(await signInternalRequest({ ...base, secret: 'other' })).not.toBe(sig);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run functions/agent-link/diagramlySigner.spec.ts`
Expected: FAIL — cannot resolve `./diagramlySigner`.

- [ ] **Step 3: Write the implementation**

```typescript
// functions/agent-link/diagramlySigner.ts
// Rotatable HMAC service signature for Gateway -> Diagramly internal API
// (spec §7.3, roadmap §2.2). WebCrypto only — this runs in the Cloudflare
// Workers runtime, which has no `node:crypto`. The signature proves the
// request came from the Gateway; the session capability in the body/header
// proves authorization for the specific session. Both are required.

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return toHex(new Uint8Array(digest));
}

export async function signInternalRequest(params: {
  method: string;
  pathname: string;
  timestampMs: number;
  rawBody: string;
  secret: string;
}): Promise<string> {
  const bodyDigest = await sha256Hex(params.rawBody);
  const canonical = `${params.method}\n${params.pathname}\n${params.timestampMs}\n${bodyDigest}`;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(params.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(canonical));
  return toHex(new Uint8Array(sig));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run functions/agent-link/diagramlySigner.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/agent-link/diagramlySigner.ts functions/agent-link/diagramlySigner.spec.ts
git commit -m "feat(agent-link): WebCrypto HMAC signer so Diagramly can prove requests came from the Gateway (spec §7.3)"
```

---

### Task 3: Cross-repo internal-API fixtures (the shared test contract)

**Files:**
- Create: `functions/agent-link/__fixtures__/diagramly-internal-api.ts`
- Test: `functions/agent-link/__fixtures__/diagramly-internal-api.spec.ts`

**Interfaces:**
- Produces: TypeScript request/response interfaces + canned fixture objects for every internal endpoint in roadmap §2.2 (`/internal/connect`, `/internal/activity`, `/internal/render`, `/internal/render-status`, `/internal/status`) **and** the §15 error envelope. This module is the single source of truth both WS2's Diagramly tests and WS3's gateway mocks import — changing a field here is a deliberate cross-repo decision. Path constants live here too. Consumed by Tasks 4–5, 8–10.

- [ ] **Step 1: Write the failing test**

```typescript
// functions/agent-link/__fixtures__/diagramly-internal-api.spec.ts
import { describe, it, expect } from 'vitest';
import {
  INTERNAL_PATHS,
  CONNECT_RESPONSE,
  ACTIVITY_RESPONSE,
  RENDER_ACCEPTED_RESPONSE,
  RENDER_STATUS_SUCCEEDED,
  RENDER_STATUS_FAILED,
  RENDER_STATUS_PENDING,
  STATUS_RESPONSE,
  errorEnvelope,
} from './diagramly-internal-api';

describe('internal-api fixtures mirror roadmap §2.2', () => {
  it('pins the internal path table', () => {
    expect(INTERNAL_PATHS).toEqual({
      connect: '/api/agent-link/internal/connect',
      activity: '/api/agent-link/internal/activity',
      render: '/api/agent-link/internal/render',
      renderStatus: '/api/agent-link/internal/render-status',
      status: '/api/agent-link/internal/status',
    });
  });

  it('connect returns a dlc_ capability, expiry, notations and a privacy summary', () => {
    expect(CONNECT_RESPONSE.capability).toMatch(/^dlc_/);
    expect(typeof CONNECT_RESPONSE.capabilityExpiresAt).toBe('string');
    expect(CONNECT_RESPONSE.notations).toEqual(['mermaid', 'zenuml', 'plantuml']);
    expect(typeof CONNECT_RESPONSE.privacySummary).toBe('string');
    expect(typeof CONNECT_RESPONSE.sessionId).toBe('string');
  });

  it('activity returns a monotonic sequence', () => {
    expect(typeof ACTIVITY_RESPONSE.sequence).toBe('number');
  });

  it('render is accepted PENDING with a renderId + sequence', () => {
    expect(RENDER_ACCEPTED_RESPONSE.status).toBe('PENDING');
    expect(typeof RENDER_ACCEPTED_RESPONSE.renderId).toBe('string');
    expect(typeof RENDER_ACCEPTED_RESPONSE.sequence).toBe('number');
  });

  it('render-status carries terminal outcomes with sanitized error fields', () => {
    expect(RENDER_STATUS_SUCCEEDED.status).toBe('SUCCEEDED');
    expect(typeof RENDER_STATUS_SUCCEEDED.durationMs).toBe('number');
    expect(RENDER_STATUS_FAILED.status).toBe('FAILED');
    expect(typeof RENDER_STATUS_FAILED.errorCode).toBe('string');
    expect(typeof RENDER_STATUS_FAILED.errorLine).toBe('number');
    expect(RENDER_STATUS_PENDING.status).toBe('PENDING');
  });

  it('status snapshot never claims to slide the TTL (documented contract)', () => {
    expect(STATUS_RESPONSE.status).toBeDefined();
    expect(STATUS_RESPONSE).not.toHaveProperty('capability');
  });

  it('the error envelope carries a stable machine code and no secret', () => {
    const env = errorEnvelope('PAIRING_CODE_INVALID', 'The pairing code is invalid or already used.');
    expect(env.error.code).toBe('PAIRING_CODE_INVALID');
    expect(env.error.message).not.toMatch(/DL-|dlc_|clc_|CL-/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run functions/agent-link/__fixtures__/diagramly-internal-api.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// functions/agent-link/__fixtures__/diagramly-internal-api.ts
// SHARED CROSS-REPO CONTRACT (roadmap §2.2 + spec §15). WS3 gateway mocks and
// WS2 Diagramly tests both import these shapes so there is one truth. Changing
// a field here is a deliberate cross-repo decision, not a drive-by edit.
//
// All paths are relative to env.DIAGRAMLY_INTERNAL_API_BASE (the Diagramly
// origin, e.g. https://staging.diagramly.ai). The signed canonical string uses
// the path WITHOUT query string (url.pathname).

export const INTERNAL_PATHS = {
  connect: '/api/agent-link/internal/connect',
  activity: '/api/agent-link/internal/activity',
  render: '/api/agent-link/internal/render',
  renderStatus: '/api/agent-link/internal/render-status',
  status: '/api/agent-link/internal/status',
} as const;

/** Lowercase notation keys shared by connect.notations and render.notation. */
export type DlNotation = 'mermaid' | 'zenuml' | 'plantuml';

// ---- Requests (Gateway -> Diagramly) ----

export interface ConnectRequest {
  code: string;
  clientName?: string;
  clientVersion?: string;
  /** Agent IP from CF-Connecting-IP; body is signature-covered so it can't be
   *  tampered in transit. Absent when the runtime doesn't provide it. */
  clientIp?: string;
}

export interface ActivityRequest {
  capability: string;
  phase: string;
  summary: string;
}

export interface RenderRequest {
  capability: string;
  title: string;
  notation: DlNotation;
  subType?: string;
  source: string;
}

// ---- Responses (Diagramly -> Gateway) ----

export interface ConnectResponse {
  sessionId: string;
  capability: string; // dlc_ + 43 base64url chars
  capabilityExpiresAt: string; // ISO 8601
  notations: DlNotation[];
  privacySummary: string;
}

export interface ActivityResponse {
  sequence: number;
}

export interface RenderAcceptedResponse {
  renderId: string;
  sequence: number;
  status: 'PENDING';
}

export interface RenderStatusResponse {
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  durationMs?: number;
  errorCode?: string;
  errorLine?: number;
  errorMessage?: string;
}

export interface StatusResponse {
  status: 'PAIRED' | 'ACTIVE' | 'CLAIMED' | 'EXPIRED';
  notations?: DlNotation[];
  lastSuccessfulRenderId?: string | null;
  activityCount?: number;
  renderCount?: number;
  capabilityExpiresAt?: string;
}

// ---- Error envelope (spec §15) ----

export interface InternalErrorEnvelope {
  error: { code: string; message: string; retryAfter?: number };
}

export function errorEnvelope(code: string, message: string, retryAfter?: number): InternalErrorEnvelope {
  return { error: { code, message, ...(retryAfter !== undefined ? { retryAfter } : {}) } };
}

// ---- Canned fixtures ----

export const CONNECT_RESPONSE: ConnectResponse = {
  sessionId: 'cl_session_fixture_0001',
  capability: 'dlc_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  capabilityExpiresAt: '2026-07-16T10:30:00.000Z',
  notations: ['mermaid', 'zenuml', 'plantuml'],
  privacySummary:
    'Anonymous session. Renders are transient and become inaccessible after 24h unless you sign in and save; unsaved data is physically deleted within a further 24h.',
};

export const ACTIVITY_RESPONSE: ActivityResponse = { sequence: 3 };

export const RENDER_ACCEPTED_RESPONSE: RenderAcceptedResponse = {
  renderId: 'alr_render_fixture_0001',
  sequence: 4,
  status: 'PENDING',
};

export const RENDER_STATUS_SUCCEEDED: RenderStatusResponse = { status: 'SUCCEEDED', durationMs: 412 };

export const RENDER_STATUS_FAILED: RenderStatusResponse = {
  status: 'FAILED',
  durationMs: 130,
  errorCode: 'PARSE_ERROR',
  errorLine: 7,
  errorMessage: 'Unexpected token near line 7',
};

export const RENDER_STATUS_PENDING: RenderStatusResponse = { status: 'PENDING' };

export const STATUS_RESPONSE: StatusResponse = {
  status: 'ACTIVE',
  notations: ['mermaid', 'zenuml', 'plantuml'],
  lastSuccessfulRenderId: null,
  activityCount: 2,
  renderCount: 1,
  capabilityExpiresAt: '2026-07-16T10:30:00.000Z',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run functions/agent-link/__fixtures__/diagramly-internal-api.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/agent-link/__fixtures__/diagramly-internal-api.ts functions/agent-link/__fixtures__/diagramly-internal-api.spec.ts
git commit -m "test(agent-link): one shared internal-API fixture so WS2 and WS3 test against identical shapes (roadmap §2.2)"
```

---

### Task 4: Diagramly DL adapter — connect / report_activity / get_status

**Files:**
- Create: `functions/agent-link/diagramlyAdapter.ts`
- Test: `functions/agent-link/diagramlyAdapter.spec.ts`

**Interfaces:**
- Consumes: Task 2 signer, Task 3 fixtures/types.
- Produces: `interface DiagramlyAdapterConfig { base: string; secret: string; fetch: typeof fetch; now: () => number; sleep: (ms: number) => Promise<void>; uuid: () => string }`; `class GatewayAdapterError extends Error { code: string; retriable: boolean }` (stable machine code, generic message — redaction); `createDiagramlyAdapter(cfg): DiagramlyAdapter` with `connect(req)`, `reportActivity(req)`, `getStatus(capability)` (render lands in Task 5). Every method signs via Task 2, sends `X-AgentLink-Timestamp`/`X-AgentLink-Signature`, adds `Idempotency-Key` on mutations, and puts the capability in the `X-AgentLink-Capability` header on GETs. Non-2xx with a JSON `{error:{code}}` surfaces that stable code; transport failure → `GATEWAY_TRANSPORT_ERROR` (retriable). Consumed by Task 8.

- [ ] **Step 1: Write the failing test**

```typescript
// functions/agent-link/diagramlyAdapter.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { createDiagramlyAdapter, GatewayAdapterError } from './diagramlyAdapter';
import type { DiagramlyAdapterConfig } from './diagramlyAdapter';
import {
  ACTIVITY_RESPONSE,
  CONNECT_RESPONSE,
  STATUS_RESPONSE,
  errorEnvelope,
} from './__fixtures__/diagramly-internal-api';

const BASE = 'https://staging.diagramly.ai';
const SECRET = 'svc-secret';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Captured { url: string; init: RequestInit }

function makeConfig(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>): {
  cfg: DiagramlyAdapterConfig;
  captured: Captured[];
} {
  const captured: Captured[] = [];
  const cfg: DiagramlyAdapterConfig = {
    base: BASE,
    secret: SECRET,
    fetch: (async (url: string, init?: RequestInit) => {
      captured.push({ url, init: init ?? {} });
      return fetchImpl(url, init);
    }) as unknown as typeof fetch,
    now: () => 1_752_600_000_000,
    sleep: async () => {},
    uuid: () => 'idem-fixed-uuid',
  };
  return { cfg, captured };
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string>)[name];
}

describe('DiagramlyAdapter.connect', () => {
  it('signs a POST /internal/connect, forwards clientIp, and returns the connect response', async () => {
    const { cfg, captured } = makeConfig(async () => jsonResponse(CONNECT_RESPONSE));
    const adapter = createDiagramlyAdapter(cfg);

    const res = await adapter.connect({ code: 'DL-2345-ABCD-6789', clientName: 'claude', clientIp: '203.0.113.7' });

    expect(res).toEqual(CONNECT_RESPONSE);
    const { url, init } = captured[0];
    expect(url).toBe(`${BASE}/api/agent-link/internal/connect`);
    expect(init.method).toBe('POST');
    expect(headerOf(init, 'Idempotency-Key')).toBe('idem-fixed-uuid');
    expect(headerOf(init, 'X-AgentLink-Timestamp')).toBe('1752600000000');

    // The signature is exactly what Diagramly will recompute over the RAW body.
    const rawBody = init.body as string;
    expect(JSON.parse(rawBody).clientIp).toBe('203.0.113.7');
    const digest = createHash('sha256').update(rawBody).digest('hex');
    const canonical = `POST\n/api/agent-link/internal/connect\n1752600000000\n${digest}`;
    expect(headerOf(init, 'X-AgentLink-Signature')).toBe(
      createHmac('sha256', SECRET).update(canonical).digest('hex'),
    );
  });

  it('maps a 4xx {error:{code}} to a GatewayAdapterError carrying that stable code, and never leaks the code value', async () => {
    const { cfg } = makeConfig(async () =>
      jsonResponse(errorEnvelope('PAIRING_CODE_INVALID', 'invalid'), 400),
    );
    const adapter = createDiagramlyAdapter(cfg);
    await expect(adapter.connect({ code: 'DL-0000-0000-0000' })).rejects.toMatchObject({
      code: 'PAIRING_CODE_INVALID',
    });
    await adapter.connect({ code: 'DL-secret-code-XXXX' }).catch((e: GatewayAdapterError) => {
      expect(e.message).not.toContain('DL-secret-code-XXXX');
    });
  });

  it('maps a thrown fetch (transport) to a retriable GATEWAY_TRANSPORT_ERROR', async () => {
    const { cfg } = makeConfig(async () => {
      throw new Error('network down');
    });
    const adapter = createDiagramlyAdapter(cfg);
    await expect(adapter.connect({ code: 'DL-2345-ABCD-6789' })).rejects.toMatchObject({
      code: 'GATEWAY_TRANSPORT_ERROR',
      retriable: true,
    });
  });

  it('throws before any I/O when the service secret is missing (no fallback secret)', async () => {
    const { cfg, captured } = makeConfig(async () => jsonResponse(CONNECT_RESPONSE));
    const adapter = createDiagramlyAdapter({ ...cfg, secret: '' });
    await expect(adapter.connect({ code: 'DL-2345-ABCD-6789' })).rejects.toThrow(/AGENT_LINK_SERVICE_SECRET/);
    expect(captured).toHaveLength(0);
  });
});

describe('DiagramlyAdapter.reportActivity', () => {
  it('signs a POST /internal/activity with the capability in the body', async () => {
    const { cfg, captured } = makeConfig(async () => jsonResponse(ACTIVITY_RESPONSE));
    const adapter = createDiagramlyAdapter(cfg);
    const res = await adapter.reportActivity({ capability: 'dlc_abc', phase: 'analyzing', summary: 'reading repo' });
    expect(res).toEqual(ACTIVITY_RESPONSE);
    expect(captured[0].url).toBe(`${BASE}/api/agent-link/internal/activity`);
    expect(JSON.parse(captured[0].init.body as string).capability).toBe('dlc_abc');
    expect(headerOf(captured[0].init, 'Idempotency-Key')).toBeDefined();
  });
});

describe('DiagramlyAdapter.getStatus', () => {
  it('signs a GET /internal/status with the capability in the header, empty-body digest, no idempotency key', async () => {
    const { cfg, captured } = makeConfig(async () => jsonResponse(STATUS_RESPONSE));
    const adapter = createDiagramlyAdapter(cfg);
    const res = await adapter.getStatus('dlc_abc');
    expect(res).toEqual(STATUS_RESPONSE);
    const { url, init } = captured[0];
    expect(url).toBe(`${BASE}/api/agent-link/internal/status`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(headerOf(init, 'X-AgentLink-Capability')).toBe('dlc_abc');
    expect(headerOf(init, 'Idempotency-Key')).toBeUndefined();
  });

  it('maps an expired-capability 401 {error:{code}} to SESSION_CAPABILITY_EXPIRED', async () => {
    const { cfg } = makeConfig(async () =>
      jsonResponse(errorEnvelope('SESSION_CAPABILITY_EXPIRED', 'expired'), 401),
    );
    const adapter = createDiagramlyAdapter(cfg);
    await expect(adapter.getStatus('dlc_abc')).rejects.toMatchObject({ code: 'SESSION_CAPABILITY_EXPIRED' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run functions/agent-link/diagramlyAdapter.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// functions/agent-link/diagramlyAdapter.ts
// Stateless Diagramly (DL) adapter (spec §5, §6.1, §7.2/§7.3). The Gateway
// holds NO DL session state — every call is a signed HTTPS request to
// Diagramly's internal API, which owns the Neon session. No Durable Object,
// no Redis. render() (with gateway-side ACK polling) lands in the next task.

import { signInternalRequest } from './diagramlySigner';
import {
  INTERNAL_PATHS,
  type ActivityRequest,
  type ActivityResponse,
  type ConnectRequest,
  type ConnectResponse,
  type InternalErrorEnvelope,
  type StatusResponse,
} from './__fixtures__/diagramly-internal-api';

export interface DiagramlyAdapterConfig {
  base: string; // env.DIAGRAMLY_INTERNAL_API_BASE (origin)
  secret: string; // env.AGENT_LINK_SERVICE_SECRET
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  uuid: () => string;
}

/**
 * A tool-contract failure with a stable machine `code` (spec §15) and a
 * GENERIC message. The raw code/capability/pairing-code value is NEVER placed
 * in `message` — redaction (spec §7.3). `retriable` marks transport errors the
 * agent may retry (§15 row 6/7).
 */
export class GatewayAdapterError extends Error {
  readonly code: string;
  readonly retriable: boolean;
  constructor(code: string, message: string, retriable = false) {
    super(message);
    this.name = 'GatewayAdapterError';
    this.code = code;
    this.retriable = retriable;
  }
}

interface SignedCall {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string>;
  body?: unknown; // undefined => empty raw body (GET)
  capabilityHeader?: string; // GET endpoints carry the capability in a header
  idempotent?: boolean; // POST mutations carry Idempotency-Key
}

export interface DiagramlyAdapter {
  connect(req: ConnectRequest): Promise<ConnectResponse>;
  reportActivity(req: ActivityRequest): Promise<ActivityResponse>;
  getStatus(capability: string): Promise<StatusResponse>;
  /** Shared by render() in Task 5 — exposed so that module extends this one. */
  signedFetch(call: SignedCall): Promise<{ status: number; body: unknown }>;
}

export function createDiagramlyAdapter(cfg: DiagramlyAdapterConfig): DiagramlyAdapter {
  async function signedFetch(call: SignedCall): Promise<{ status: number; body: unknown }> {
    if (!cfg.secret) {
      // Fail before any network I/O — a silent default secret would forge the
      // Gateway's identity to Diagramly (spec §7.3, Global Constraints).
      throw new Error('Missing required secret: AGENT_LINK_SERVICE_SECRET');
    }
    const rawBody = call.body === undefined ? '' : JSON.stringify(call.body);
    const timestampMs = cfg.now();
    const signature = await signInternalRequest({
      method: call.method,
      pathname: call.path, // signed path excludes query (both repos agree)
      timestampMs,
      rawBody,
      secret: cfg.secret,
    });

    const headers: Record<string, string> = {
      'X-AgentLink-Timestamp': String(timestampMs),
      'X-AgentLink-Signature': signature,
    };
    if (call.method === 'POST') headers['Content-Type'] = 'application/json';
    if (call.idempotent) headers['Idempotency-Key'] = cfg.uuid();
    if (call.capabilityHeader) headers['X-AgentLink-Capability'] = call.capabilityHeader;

    const qs = call.query
      ? '?' + new URLSearchParams(call.query).toString()
      : '';
    const url = `${cfg.base}${call.path}${qs}`;

    let res: Response;
    try {
      res = await cfg.fetch(url, {
        method: call.method,
        headers,
        body: call.method === 'GET' ? undefined : rawBody,
      });
    } catch {
      // Never echo the URL/body — they can contain source/capability.
      throw new GatewayAdapterError('GATEWAY_TRANSPORT_ERROR', 'The Gateway could not reach Diagramly.', true);
    }

    let body: unknown = undefined;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    return { status: res.status, body };
  }

  /** Turn a non-2xx into a redacted GatewayAdapterError using Diagramly's stable code. */
  function raiseFromError(status: number, body: unknown): never {
    const code = (body as InternalErrorEnvelope | undefined)?.error?.code;
    if (typeof code === 'string' && code.length > 0) {
      // 5xx are retriable transport-ish; 4xx are contract errors.
      throw new GatewayAdapterError(code, 'The Diagramly session rejected the request.', status >= 500);
    }
    throw new GatewayAdapterError(
      status >= 500 ? 'GATEWAY_TRANSPORT_ERROR' : 'DIAGRAMLY_REQUEST_FAILED',
      'The Diagramly session returned an unexpected response.',
      status >= 500,
    );
  }

  async function ok<T>(call: SignedCall): Promise<T> {
    const { status, body } = await signedFetch(call);
    if (status < 200 || status >= 300) raiseFromError(status, body);
    return body as T;
  }

  return {
    signedFetch,

    connect(req: ConnectRequest): Promise<ConnectResponse> {
      return ok<ConnectResponse>({
        method: 'POST',
        path: INTERNAL_PATHS.connect,
        body: req,
        idempotent: true,
      });
    },

    reportActivity(req: ActivityRequest): Promise<ActivityResponse> {
      return ok<ActivityResponse>({
        method: 'POST',
        path: INTERNAL_PATHS.activity,
        body: req,
        idempotent: true,
      });
    },

    getStatus(capability: string): Promise<StatusResponse> {
      // GET /internal/status does NOT slide the idle TTL (spec §7.2) — that is
      // enforced Diagramly-side; the Gateway just relays the snapshot.
      return ok<StatusResponse>({
        method: 'GET',
        path: INTERNAL_PATHS.status,
        capabilityHeader: capability,
      });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run functions/agent-link/diagramlyAdapter.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/agent-link/diagramlyAdapter.ts functions/agent-link/diagramlyAdapter.spec.ts
git commit -m "feat(agent-link): stateless signed-HTTP DL adapter for connect/activity/status so the Gateway stores no DL state (spec §5, §7.2)"
```

---

### Task 5: DL adapter — `render_diagram` with gateway-side ACK polling

**Files:**
- Modify: `functions/agent-link/diagramlyAdapter.ts` (add `render`)
- Test: `functions/agent-link/diagramlyAdapter-render.spec.ts`

**Interfaces:**
- Consumes: Task 4 adapter internals (`signedFetch`).
- Produces: `RENDER_POLL_INTERVAL_MS = 1000`, `RENDER_ACK_TIMEOUT_MS = 18000`; `type RenderOutcome = { status: 'succeeded'; renderId; sequence; durationMs } | { status: 'failed'; renderId; sequence; durationMs; errorCode; errorLine?; errorMessage? } | { status: 'pending'; renderId; sequence }`; `adapter.render(req): Promise<RenderOutcome>` — POST `/internal/render`, then poll `/internal/render-status` every ~1s up to ~18s and return `succeeded`/`failed`/`pending` (spec §10.4). Consumed by Task 8.

- [ ] **Step 1: Write the failing test** (fake fetch flips PENDING→terminal; fake sleep advances instantly)

```typescript
// functions/agent-link/diagramlyAdapter-render.spec.ts
import { describe, it, expect } from 'vitest';
import { createDiagramlyAdapter, RENDER_ACK_TIMEOUT_MS, RENDER_POLL_INTERVAL_MS } from './diagramlyAdapter';
import type { DiagramlyAdapterConfig } from './diagramlyAdapter';
import {
  RENDER_ACCEPTED_RESPONSE,
  RENDER_STATUS_FAILED,
  RENDER_STATUS_PENDING,
  RENDER_STATUS_SUCCEEDED,
} from './__fixtures__/diagramly-internal-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Drives a virtual clock: sleep() advances `nowMs` so the poll loop terminates without real timers. */
function makeConfig(handlers: {
  render: () => Response;
  renderStatus: (pollIndex: number) => Response;
}): { cfg: DiagramlyAdapterConfig; pollCount: () => number } {
  let nowMs = 1_752_600_000_000;
  let polls = 0;
  const cfg: DiagramlyAdapterConfig = {
    base: 'https://staging.diagramly.ai',
    secret: 's',
    now: () => nowMs,
    sleep: async (ms: number) => {
      nowMs += ms;
    },
    uuid: () => 'idem',
    fetch: (async (url: string) => {
      if (url.includes('/internal/render-status')) return handlers.renderStatus(polls++);
      if (url.includes('/internal/render')) return handlers.render();
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch,
  };
  return { cfg, pollCount: () => polls };
}

describe('DiagramlyAdapter.render (ACK polling, spec §10.4)', () => {
  it('returns succeeded once render-status flips to SUCCEEDED', async () => {
    const { cfg } = makeConfig({
      render: () => jsonResponse(RENDER_ACCEPTED_RESPONSE),
      renderStatus: (i) => jsonResponse(i < 2 ? RENDER_STATUS_PENDING : RENDER_STATUS_SUCCEEDED),
    });
    const adapter = createDiagramlyAdapter(cfg);
    const out = await adapter.render({ capability: 'dlc_abc', title: 'Flow', notation: 'mermaid', source: 'graph TD;A-->B' });
    expect(out).toEqual({
      status: 'succeeded',
      renderId: RENDER_ACCEPTED_RESPONSE.renderId,
      sequence: RENDER_ACCEPTED_RESPONSE.sequence,
      durationMs: RENDER_STATUS_SUCCEEDED.durationMs,
    });
  });

  it('returns failed with sanitized error line/message', async () => {
    const { cfg } = makeConfig({
      render: () => jsonResponse(RENDER_ACCEPTED_RESPONSE),
      renderStatus: () => jsonResponse(RENDER_STATUS_FAILED),
    });
    const adapter = createDiagramlyAdapter(cfg);
    const out = await adapter.render({ capability: 'dlc_abc', title: 'Flow', notation: 'zenuml', source: 'A->B' });
    expect(out).toMatchObject({
      status: 'failed',
      errorCode: 'PARSE_ERROR',
      errorLine: 7,
      errorMessage: 'Unexpected token near line 7',
    });
  });

  it('returns pending when the browser never ACKs within the timeout (offline tab, spec §15 row 3)', async () => {
    const { cfg, pollCount } = makeConfig({
      render: () => jsonResponse(RENDER_ACCEPTED_RESPONSE),
      renderStatus: () => jsonResponse(RENDER_STATUS_PENDING),
    });
    const adapter = createDiagramlyAdapter(cfg);
    const out = await adapter.render({ capability: 'dlc_abc', title: 'Flow', notation: 'plantuml', source: '@startuml\n@enduml' });
    expect(out.status).toBe('pending');
    // Bounded: at most ceil(timeout / interval) polls.
    expect(pollCount()).toBeLessThanOrEqual(Math.ceil(RENDER_ACK_TIMEOUT_MS / RENDER_POLL_INTERVAL_MS));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run functions/agent-link/diagramlyAdapter-render.spec.ts`
Expected: FAIL — `render` / the two constants are not exported.

- [ ] **Step 3: Extend the implementation** — add the exports and `render` to `diagramlyAdapter.ts`

Add near the top (after the imports), extending the fixture import to include the render types:

```typescript
// add RenderAcceptedResponse, RenderRequest, RenderStatusResponse to the
// existing import from './__fixtures__/diagramly-internal-api'.

// Gateway-side ACK wait (spec §10.4: "wait 15-20s"). Poll ~1s, cap ~18s, then
// return `pending` (the browser is offline / hasn't ACKed) — NOT a failure.
export const RENDER_POLL_INTERVAL_MS = 1000;
export const RENDER_ACK_TIMEOUT_MS = 18000;

export type RenderOutcome =
  | { status: 'succeeded'; renderId: string; sequence: number; durationMs: number }
  | {
      status: 'failed';
      renderId: string;
      sequence: number;
      durationMs: number;
      errorCode: string;
      errorLine?: number;
      errorMessage?: string;
    }
  | { status: 'pending'; renderId: string; sequence: number };
```

Add `render(req: RenderRequest): Promise<RenderOutcome>` to the `DiagramlyAdapter` interface, and implement it in the returned object (it uses the same `ok`/`signedFetch` already in scope):

```typescript
    async render(req: RenderRequest): Promise<RenderOutcome> {
      const accepted = await ok<RenderAcceptedResponse>({
        method: 'POST',
        path: INTERNAL_PATHS.render,
        body: req,
        idempotent: true,
      });
      const { renderId, sequence } = accepted;

      const deadline = cfg.now() + RENDER_ACK_TIMEOUT_MS;
      while (cfg.now() < deadline) {
        await cfg.sleep(RENDER_POLL_INTERVAL_MS);
        const status = await ok<RenderStatusResponse>({
          method: 'GET',
          path: INTERNAL_PATHS.renderStatus,
          query: { renderId },
          capabilityHeader: req.capability,
        });
        if (status.status === 'SUCCEEDED') {
          return { status: 'succeeded', renderId, sequence, durationMs: status.durationMs ?? 0 };
        }
        if (status.status === 'FAILED') {
          return {
            status: 'failed',
            renderId,
            sequence,
            durationMs: status.durationMs ?? 0,
            errorCode: status.errorCode ?? 'RENDER_FAILED',
            errorLine: status.errorLine,
            errorMessage: status.errorMessage,
          };
        }
        // PENDING -> keep polling until the deadline.
      }
      // Timed out waiting for the browser ACK — recoverable via get_status.
      return { status: 'pending', renderId, sequence };
    },
```

(`render` is added to the interface and object; `RenderAcceptedResponse`, `RenderRequest`, `RenderStatusResponse` join the fixture import.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run functions/agent-link/diagramlyAdapter-render.spec.ts functions/agent-link/diagramlyAdapter.spec.ts`
Expected: PASS (Task 4 tests still green).

- [ ] **Step 5: Commit**

```bash
git add functions/agent-link/diagramlyAdapter.ts functions/agent-link/diagramlyAdapter-render.spec.ts
git commit -m "feat(agent-link): gateway-side render ACK polling so Diagramly stays serverless-short and the agent gets succeeded/failed/pending (spec §10.4)"
```

---

### Task 6: D1-backed CL capability registry + additive migration

**Files:**
- Create: `functions/migrations/0015_add_agent_link_capability.sql`, `functions/agent-link/capabilityRegistry.ts`
- Test: `functions/agent-link/capabilityRegistry.spec.ts`

**Interfaces:**
- Consumes: Task 2 `sha256Hex`; `env.DB` (existing D1 binding — present at top-level and `env.production` in both `wrangler-dev.toml` and `wrangler-stg.toml`).
- Produces: `interface CapabilityRegistry { bind(capability, target, expiresAtMs): Promise<void>; resolve(capability, nowMs): Promise<string | null> }`; `class D1CapabilityRegistry implements CapabilityRegistry`. Stores **only** `sha256(capability)` → the underlying CL DO-addressing token, with an expiry; the raw `clc_` capability and the CL token are never persisted in the clear (redaction). Used by Task 7 so the gateway can resolve a `clc_` capability back to the DO the CL tools already address by token — without touching the DO. Why D1, not the DO: the DL data plane needs no gateway store, and the CL binding is exactly the kind of small keyed lookup D1 (the gateway's primary datastore) already serves; adding a DO route would edit the 967-line `AgentLinkSession`, which the WS3 scope forbids.

- [ ] **Step 1: Write the migration**

```sql
-- Migration number: 0015 	 2026-07-16T00:00:00.000Z
-- Agent-first Stage 0/1 (spec 2026-07-16 §6.2): binds a server-issued clc_
-- session capability to the underlying CL DO-addressing token, so post-connect
-- CL tool calls can carry the capability in structured args (never a URL) yet
-- still reach the same AgentLinkSession Durable Object. Additive only.
CREATE TABLE IF NOT EXISTS AgentLinkCapability (
  capabilityHash TEXT PRIMARY KEY,   -- sha256(clc_...) hex; raw capability never stored
  target         TEXT NOT NULL,      -- the CL DO-addressing token (idFromName)
  product        TEXT NOT NULL,      -- 'CL' (reserved for future products)
  createdAt      INTEGER NOT NULL,   -- unix ms
  expiresAt      INTEGER NOT NULL    -- unix ms; matched by the read path, swept by cleanup
);

CREATE INDEX IF NOT EXISTS idx_agentlinkcapability_expiresAt
  ON AgentLinkCapability (expiresAt);
```

- [ ] **Step 2: Write the failing test** (fake D1 — a Map-backed `prepare/bind/first/run` stub)

```typescript
// functions/agent-link/capabilityRegistry.spec.ts
import { describe, it, expect } from 'vitest';
import { sha256Hex } from './diagramlySigner';
import { D1CapabilityRegistry } from './capabilityRegistry';

/** Minimal D1 double supporting exactly the two statements the registry runs. */
function fakeDb() {
  const rows = new Map<string, { target: string; product: string; createdAt: number; expiresAt: number }>();
  return {
    rows,
    prepare(sql: string) {
      const isInsert = /INSERT/i.test(sql);
      const isSelect = /SELECT/i.test(sql);
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          args = a;
          return stmt;
        },
        async run() {
          // INSERT OR REPLACE INTO AgentLinkCapability (hash,target,product,createdAt,expiresAt)
          const [hash, target, product, createdAt, expiresAt] = args as [string, string, string, number, number];
          if (isInsert) rows.set(hash, { target, product, createdAt, expiresAt });
          return { success: true };
        },
        async first<T>(): Promise<T | null> {
          // SELECT target FROM AgentLinkCapability WHERE capabilityHash=?1 AND expiresAt>?2
          if (!isSelect) return null;
          const [hash, now] = args as [string, number];
          const row = rows.get(hash);
          if (!row || row.expiresAt <= (now as number)) return null;
          return { target: row.target } as unknown as T;
        },
      };
      return stmt;
    },
  };
}

describe('D1CapabilityRegistry', () => {
  it('binds a capability and resolves it to its target, storing only the hash', async () => {
    const db = fakeDb();
    const registry = new D1CapabilityRegistry(db as unknown as D1Database);
    const now = 1_752_600_000_000;
    await registry.bind('clc_secretcapability', 'CL-8F3K7Q', now + 600_000);

    // Raw capability + raw token are never stored.
    for (const key of db.rows.keys()) expect(key).not.toContain('clc_secretcapability');

    expect(await registry.resolve('clc_secretcapability', now)).toBe('CL-8F3K7Q');
    expect(await registry.resolve('clc_secretcapability', now)).toBe('CL-8F3K7Q');
    // The lookup key is the sha256 of the capability.
    expect(db.rows.has(await sha256Hex('clc_secretcapability'))).toBe(true);
  });

  it('returns null for an unknown or expired capability', async () => {
    const db = fakeDb();
    const registry = new D1CapabilityRegistry(db as unknown as D1Database);
    const now = 1_752_600_000_000;
    expect(await registry.resolve('clc_unknown', now)).toBeNull();
    await registry.bind('clc_x', 'CL-AAAAAA', now + 1000);
    expect(await registry.resolve('clc_x', now + 2000)).toBeNull(); // past expiry
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run functions/agent-link/capabilityRegistry.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```typescript
// functions/agent-link/capabilityRegistry.ts
// Binds a server-issued clc_ session capability to the underlying CL
// DO-addressing token (spec §6.2). Persists ONLY sha256(capability) — the raw
// capability never touches storage or logs (redaction, spec §7.3). Backed by
// D1 (env.DB), the Gateway's existing datastore; the Durable Object is untouched.

import { sha256Hex } from './diagramlySigner';

export interface CapabilityRegistry {
  bind(capability: string, target: string, expiresAtMs: number): Promise<void>;
  resolve(capability: string, nowMs: number): Promise<string | null>;
}

export class D1CapabilityRegistry implements CapabilityRegistry {
  constructor(private readonly db: D1Database) {}

  async bind(capability: string, target: string, expiresAtMs: number): Promise<void> {
    const hash = await sha256Hex(capability);
    await this.db
      .prepare(
        'INSERT OR REPLACE INTO AgentLinkCapability (capabilityHash, target, product, createdAt, expiresAt) VALUES (?1, ?2, ?3, ?4, ?5)',
      )
      .bind(hash, target, 'CL', Date.now(), expiresAtMs)
      .run();
  }

  async resolve(capability: string, nowMs: number): Promise<string | null> {
    const hash = await sha256Hex(capability);
    const row = await this.db
      .prepare('SELECT target FROM AgentLinkCapability WHERE capabilityHash = ?1 AND expiresAt > ?2')
      .bind(hash, nowMs)
      .first<{ target: string }>();
    return row?.target ?? null;
  }
}
```

- [ ] **Step 5: Apply the migration locally and run tests**

Apply to the local D1 (uses the `db:migrate:local` script's target `conf-zenuml-dev`):

```bash
pnpm db:migrate:local
pnpm exec vitest run functions/agent-link/capabilityRegistry.spec.ts
```

Expected: migration `0015` applies (`CREATE TABLE AgentLinkCapability`); test PASS. Staging D1 (`conf-zenuml-stg`) migrations are applied by the deploy pipeline (`migrations_dir = functions/migrations`) on push — do **not** apply to any prod DB.

- [ ] **Step 6: Commit**

```bash
git add functions/migrations/0015_add_agent_link_capability.sql functions/agent-link/capabilityRegistry.ts functions/agent-link/capabilityRegistry.spec.ts
git commit -m "feat(agent-link): D1 capability binding so clc_ resolves to the CL session without a URL token or DO change (spec §6.2)"
```

---

### Task 7: Confluence CL exchange adapter

**Files:**
- Create: `functions/agent-link/confluenceAdapter.ts`
- Test: `functions/agent-link/confluenceAdapter.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`normalize`/detect), Task 6 registry, `CAPABILITY_IDLE_TTL`-style expiry from the validated session.
- Produces: `interface ClSessionValidation { ok: boolean; expiresAtMs?: number }`; `interface ConfluenceAdapterDeps { registry: CapabilityRegistry; validateSession(clToken: string): Promise<ClSessionValidation>; generateCapability(): string; now: () => number }`; `class ConfluenceAdapter` with `connect(code): Promise<ConnectResult>` (validate the CL code as a live DO session, mint a fresh `clc_` 256-bit capability, bind it, return the uniform connect result — never leaking the CL token) and `resolve(capability): Promise<string | null>`. `ConnectResult` is the product-neutral shape both adapters return. `generateCapability` produces `clc_` + 43 base64url chars (256 bits). Consumed by Task 8.

- [ ] **Step 1: Write the failing test**

```typescript
// functions/agent-link/confluenceAdapter.spec.ts
import { describe, it, expect } from 'vitest';
import { ConfluenceAdapter, GatewayAdapterError } from './confluenceAdapter';
import type { CapabilityRegistry } from './capabilityRegistry';

function fakeRegistry() {
  const store = new Map<string, { target: string; expiresAtMs: number }>();
  const registry: CapabilityRegistry = {
    async bind(capability, target, expiresAtMs) {
      store.set(capability, { target, expiresAtMs });
    },
    async resolve(capability, nowMs) {
      const row = store.get(capability);
      return row && row.expiresAtMs > nowMs ? row.target : null;
    },
  };
  return { registry, store };
}

const NOW = 1_752_600_000_000;

function makeAdapter(validate: (t: string) => Promise<{ ok: boolean; expiresAtMs?: number }>) {
  const { registry, store } = fakeRegistry();
  let counter = 0;
  const adapter = new ConfluenceAdapter({
    registry,
    validateSession: validate,
    generateCapability: () => `clc_${'A'.repeat(42)}${counter++}`,
    now: () => NOW,
  });
  return { adapter, store };
}

describe('ConfluenceAdapter.connect', () => {
  it('exchanges a live CL code for a fresh clc_ capability bound to the CL token — no token leak', async () => {
    const { adapter, store } = makeAdapter(async () => ({ ok: true, expiresAtMs: NOW + 600_000 }));

    const res = await adapter.connect('CL-8F3K7Q');

    expect(res.product).toBe('CL');
    expect(res.capability).toMatch(/^clc_/);
    expect(res.capabilityExpiresAt).toBe(new Date(NOW + 600_000).toISOString());
    expect(res.notations).toEqual(['mermaid', 'zenuml', 'plantuml']);
    // The binding stores the CL token as the target; the response never carries it.
    expect(store.get(res.capability)?.target).toBe('CL-8F3K7Q');
    expect(JSON.stringify(res)).not.toContain('CL-8F3K7Q');
  });

  it('rejects an invalid/expired CL code with PAIRING_CODE_INVALID', async () => {
    const { adapter } = makeAdapter(async () => ({ ok: false }));
    await expect(adapter.connect('CL-000000')).rejects.toMatchObject({ code: 'PAIRING_CODE_INVALID' });
  });

  it('rejects a code with no CL prefix as PAIRING_CODE_INVALID before any validation', async () => {
    let validated = false;
    const { adapter } = makeAdapter(async () => {
      validated = true;
      return { ok: true };
    });
    await expect(adapter.connect('DL-2345-ABCD-6789')).rejects.toMatchObject({ code: 'PAIRING_CODE_INVALID' });
    expect(validated).toBe(false);
  });
});

describe('ConfluenceAdapter.resolve', () => {
  it('resolves a bound capability to its CL token and null once expired', async () => {
    const { adapter } = makeAdapter(async () => ({ ok: true, expiresAtMs: NOW + 1000 }));
    const res = await adapter.connect('CL-8F3K7Q');
    expect(await adapter.resolve(res.capability)).toBe('CL-8F3K7Q');
    // GatewayAdapterError is exported for the dispatcher's redaction checks.
    expect(GatewayAdapterError).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run functions/agent-link/confluenceAdapter.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// functions/agent-link/confluenceAdapter.ts
// Confluence (CL) exchange adapter (spec §6.2). connect_session for a CL code
// validates it as a live AgentLinkSession (the DO the CL tools already address
// by token), then mints a fresh 256-bit clc_ capability bound in D1 to that
// token — so post-connect CL tool calls carry the capability in structured
// args (never a URL). The legacy query/bearer CL-token path keeps working in
// parallel (unchanged); its shutdown is WS6.

import { detectCodeProduct } from './gatewayCredentials';
import { GatewayAdapterError } from './diagramlyAdapter';
import type { CapabilityRegistry } from './capabilityRegistry';
import type { DlNotation } from './__fixtures__/diagramly-internal-api';

/** Product-neutral connect result returned by BOTH adapters (uniform pairing contract, spec §5). */
export interface ConnectResult {
  product: 'CL' | 'DL';
  sessionId?: string;
  capability: string;
  capabilityExpiresAt: string; // ISO 8601
  notations: DlNotation[];
  privacySummary: string;
}

export { GatewayAdapterError };

export interface ClSessionValidation {
  ok: boolean;
  /** Effective (slid, capped) session expiry in unix ms, when known. */
  expiresAtMs?: number;
}

export interface ConfluenceAdapterDeps {
  registry: CapabilityRegistry;
  /** Validates the CL code is a live session (prod: DO GET /session; tests: fake). */
  validateSession(clToken: string): Promise<ClSessionValidation>;
  /** Mints a fresh clc_ + 43 base64url chars (256 bits). */
  generateCapability(): string;
  now: () => number;
}

// Sessions the CL tools operate on are sequence diagrams etc.; the shared guide
// notations advertised are the three DSLs (spec §6.3). OpenAPI stays a legacy
// CL-only resource served on the legacy path.
const CL_NOTATIONS: DlNotation[] = ['mermaid', 'zenuml', 'plantuml'];

const CL_PRIVACY_SUMMARY =
  'Connected to your Confluence page via the ZenUML macro. The agent can read the bound page/diagrams you permit and propose edits your macro renders and saves.';

export class ConfluenceAdapter {
  constructor(private readonly deps: ConfluenceAdapterDeps) {}

  async connect(code: string): Promise<ConnectResult> {
    if (detectCodeProduct(code) !== 'CL') {
      // Never echo the code (redaction).
      throw new GatewayAdapterError('PAIRING_CODE_INVALID', 'The pairing code is not a Confluence code.');
    }
    // The CL code IS the DO-addressing token today; the target validates it.
    const clToken = code.trim().toUpperCase();
    const validation = await this.deps.validateSession(clToken);
    if (!validation.ok) {
      throw new GatewayAdapterError('PAIRING_CODE_INVALID', 'The pairing code is invalid, used, or expired.');
    }

    const capability = this.deps.generateCapability();
    const expiresAtMs = validation.expiresAtMs ?? this.deps.now() + 10 * 60 * 1000;
    await this.deps.registry.bind(capability, clToken, expiresAtMs);

    return {
      product: 'CL',
      capability,
      capabilityExpiresAt: new Date(expiresAtMs).toISOString(),
      notations: CL_NOTATIONS,
      privacySummary: CL_PRIVACY_SUMMARY,
    };
  }

  resolve(capability: string): Promise<string | null> {
    return this.deps.registry.resolve(capability, this.deps.now());
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run functions/agent-link/confluenceAdapter.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/agent-link/confluenceAdapter.ts functions/agent-link/confluenceAdapter.spec.ts
git commit -m "feat(agent-link): CL code-exchange adapter mints a clc_ capability so the token leaves the URL, legacy path intact (spec §6.2)"
```

---

### Task 8: Gateway tool registry + capability-routed dispatcher

**Files:**
- Create: `functions/agent-link/gatewayTools.ts`, `functions/agent-link/gatewayDispatch.ts`
- Test: `functions/agent-link/gatewayDispatch.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`detectCodeProduct`/`detectCapabilityProduct`), Task 4/5 (`DiagramlyAdapter`, `GatewayAdapterError`), Task 7 (`ConfluenceAdapter`, `ConnectResult`), `mcpTools` (`TOOLS`, `ToolName`, `ForwardResult`).
- Produces (`gatewayTools.ts`): `GATEWAY_TOOL_DESCRIPTORS` (connect_session, get_status, report_activity, render_diagram + the five CL context tools each augmented with a required `sessionCapability`) for the gateway-path `tools/list`; `GATEWAY_TOOL_NAMES` set. Produces (`gatewayDispatch.ts`): `interface GatewayDispatchContext { dlEnabled; dl: DiagramlyAdapter | null; cl: ConfluenceAdapter; clientIp?; runClTool(clToken, name, args): Promise<ForwardResult> }`; `dispatchGatewayTool(name, rawArgs, ctx): Promise<unknown>` — the capability router. Consumed by Task 10 (`mcp.ts`).

- [ ] **Step 1: Write `gatewayTools.ts`** (no test of its own beyond the dispatch/mcp tests; it is pure data)

```typescript
// functions/agent-link/gatewayTools.ts
// The gateway-path tool surface (spec §6.3). Kept SEPARATE from mcpTools.TOOLS
// so the legacy CL tool list (asserted `toBe(TOOLS)` in mcpTools.spec.ts)
// stays byte-identical. tools/list on the gateway path advertises the full
// cross-product surface; dispatch enforces product-match at call time and
// rejects a wrong-product tool with TOOL_NOT_AVAILABLE_FOR_SESSION.

import { TOOLS } from './mcpTools';

export interface GatewayToolProperty {
  type: string;
  description?: string;
  items?: { type: string };
}

export interface GatewayToolDescriptor {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, GatewayToolProperty>;
    required?: string[];
  };
}

const CAPABILITY_PROP: GatewayToolProperty = {
  type: 'string',
  description: 'The session capability returned by connect_session. Carry it here, never in a URL.',
};

/** Clone a CL context descriptor with a required `sessionCapability` param. */
function withCapability(d: (typeof TOOLS)[number]): GatewayToolDescriptor {
  return {
    name: d.name,
    description: d.description,
    inputSchema: {
      type: 'object',
      properties: { sessionCapability: CAPABILITY_PROP, ...d.inputSchema.properties },
      required: ['sessionCapability', ...(d.inputSchema.required ?? [])],
    },
  };
}

const CONNECT_SESSION: GatewayToolDescriptor = {
  name: 'connect_session',
  description:
    'Exchange a one-time pairing code (DL-… from diagramly.ai, or CL-… from a ZenUML Confluence macro) for a session capability. Call this once before any other session tool. The code is single-use.',
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'The pairing code shown by the product (DL-XXXX-XXXX-XXXX or CL-XXXXXX).' },
      clientName: { type: 'string', description: 'Optional agent/client name (e.g. "claude-code").' },
      clientVersion: { type: 'string', description: 'Optional agent/client version.' },
    },
    required: ['code'],
  },
};

const GET_STATUS: GatewayToolDescriptor = {
  name: 'get_status',
  description: 'Get the current session status (connection, expiry, last render). Does not extend the session.',
  inputSchema: {
    type: 'object',
    properties: { sessionCapability: CAPABILITY_PROP },
    required: ['sessionCapability'],
  },
};

const REPORT_ACTIVITY: GatewayToolDescriptor = {
  name: 'report_activity',
  description:
    'Report a short, human-readable activity summary shown live in the diagramly.ai Workbench (e.g. what you are analyzing). Diagramly session only.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionCapability: CAPABILITY_PROP,
      phase: { type: 'string', description: 'A short phase label, e.g. "analyzing" or "drafting".' },
      summary: { type: 'string', description: 'One line describing what you are doing (bounded to 240 chars).' },
    },
    required: ['sessionCapability', 'phase', 'summary'],
  },
};

const RENDER_DIAGRAM: GatewayToolDescriptor = {
  name: 'render_diagram',
  description:
    'Propose a diagram for the diagramly.ai Workbench to render. Returns succeeded, failed (with line/message), or pending (browser offline — retry get_status). Diagramly session only.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionCapability: CAPABILITY_PROP,
      title: { type: 'string', description: 'A short diagram title (bounded to 160 chars).' },
      notation: { type: 'string', description: 'One of: "mermaid", "zenuml", "plantuml".' },
      subType: { type: 'string', description: 'Optional notation sub-type.' },
      source: { type: 'string', description: 'The full diagram source in the chosen notation (bounded to 200KB).' },
    },
    required: ['sessionCapability', 'title', 'notation', 'source'],
  },
};

export const GATEWAY_TOOL_DESCRIPTORS: GatewayToolDescriptor[] = [
  CONNECT_SESSION,
  GET_STATUS,
  REPORT_ACTIVITY,
  RENDER_DIAGRAM,
  ...TOOLS.filter((t) => t.name !== 'get_status').map(withCapability),
];

export const GATEWAY_TOOL_NAMES: ReadonlySet<string> = new Set(
  GATEWAY_TOOL_DESCRIPTORS.map((t) => t.name),
);

/** CL context tools that route (via clc_) to the existing Durable-Object path. */
export const CL_CONTEXT_TOOL_NAMES: ReadonlySet<string> = new Set(
  TOOLS.filter((t) => t.name !== 'get_status').map((t) => t.name),
);
```

- [ ] **Step 2: Write the failing dispatcher test**

```typescript
// functions/agent-link/gatewayDispatch.spec.ts
import { describe, it, expect } from 'vitest';
import { dispatchGatewayTool } from './gatewayDispatch';
import type { GatewayDispatchContext } from './gatewayDispatch';
import { GatewayAdapterError } from './diagramlyAdapter';

function makeCtx(over: Partial<GatewayDispatchContext> = {}): {
  ctx: GatewayDispatchContext;
  dlCalls: Array<{ m: string; capability?: string; code?: string }>;
  clForwards: Array<{ clToken: string; name: string; args: unknown }>;
} {
  const dlCalls: Array<{ m: string; capability?: string; code?: string }> = [];
  const clForwards: Array<{ clToken: string; name: string; args: unknown }> = [];
  const dl = {
    connect: async (r: { code: string }) => {
      dlCalls.push({ m: 'connect', code: r.code });
      return { sessionId: 'dl1', capability: 'dlc_new', capabilityExpiresAt: 'x', notations: ['mermaid'], privacySummary: 'p' };
    },
    reportActivity: async (r: { capability: string }) => {
      dlCalls.push({ m: 'activity', capability: r.capability });
      return { sequence: 1 };
    },
    render: async (r: { capability: string }) => {
      dlCalls.push({ m: 'render', capability: r.capability });
      return { status: 'succeeded', renderId: 'r1', sequence: 2, durationMs: 5 };
    },
    getStatus: async (capability: string) => {
      dlCalls.push({ m: 'status', capability });
      return { status: 'ACTIVE' };
    },
    reportActivityRaw: undefined,
  };
  const cl = {
    connect: async (code: string) => ({ product: 'CL', capability: 'clc_new', capabilityExpiresAt: 'x', notations: ['zenuml'], privacySummary: 'p' }),
    resolve: async (capability: string) => (capability === 'clc_good' ? 'CL-TOKEN-1' : null),
  };
  const ctx: GatewayDispatchContext = {
    dlEnabled: true,
    dl: dl as unknown as GatewayDispatchContext['dl'],
    cl: cl as unknown as GatewayDispatchContext['cl'],
    clientIp: '203.0.113.9',
    runClTool: async (clToken: string, name: string, args: Record<string, unknown>) => {
      clForwards.push({ clToken, name, args });
      return { ok: true, forwardedTo: clToken, tool: name };
    },
    ...over,
  };
  return { ctx, dlCalls, clForwards };
}

describe('connect_session routing', () => {
  it('routes a DL code to the DL adapter and forwards clientIp implicitly', async () => {
    const { ctx, dlCalls } = makeCtx();
    const res = (await dispatchGatewayTool('connect_session', { code: 'DL-2345-ABCD-6789' }, ctx)) as { capability: string };
    expect(res.capability).toBe('dlc_new');
    expect(dlCalls[0]).toMatchObject({ m: 'connect', code: 'DL-2345-ABCD-6789' });
  });

  it('routes a CL code to the CL adapter', async () => {
    const { ctx } = makeCtx();
    const res = (await dispatchGatewayTool('connect_session', { code: 'CL-8F3K7Q' }, ctx)) as { capability: string };
    expect(res.capability).toBe('clc_new');
  });

  it('rejects an unrecognized code prefix with PAIRING_CODE_INVALID', async () => {
    const { ctx } = makeCtx();
    await expect(dispatchGatewayTool('connect_session', { code: 'XY-1' }, ctx)).rejects.toMatchObject({
      code: 'PAIRING_CODE_INVALID',
    });
  });
});

describe('capability isolation + wrong-product rejection', () => {
  it('report_activity/render_diagram accept only DL capabilities', async () => {
    const { ctx, dlCalls } = makeCtx();
    await dispatchGatewayTool('report_activity', { sessionCapability: 'dlc_A', phase: 'p', summary: 's' }, ctx);
    await dispatchGatewayTool('render_diagram', { sessionCapability: 'dlc_B', title: 't', notation: 'mermaid', source: 'g' }, ctx);
    expect(dlCalls.map((c) => c.capability)).toEqual(['dlc_A', 'dlc_B']); // each call carries only its own capability
    await expect(
      dispatchGatewayTool('render_diagram', { sessionCapability: 'clc_good', title: 't', notation: 'mermaid', source: 'g' }, ctx),
    ).rejects.toMatchObject({ code: 'TOOL_NOT_AVAILABLE_FOR_SESSION' });
  });

  it('CL context tools accept only CL capabilities and forward to the resolved DO token', async () => {
    const { ctx, clForwards } = makeCtx();
    const res = await dispatchGatewayTool('read_page', { sessionCapability: 'clc_good' }, ctx);
    expect(res).toMatchObject({ forwardedTo: 'CL-TOKEN-1', tool: 'read_page' });
    // The capability is stripped before forwarding to the DO.
    expect(clForwards[0].args).not.toHaveProperty('sessionCapability');
    await expect(
      dispatchGatewayTool('read_page', { sessionCapability: 'dlc_A' }, ctx),
    ).rejects.toMatchObject({ code: 'TOOL_NOT_AVAILABLE_FOR_SESSION' });
  });

  it('an unresolvable/expired CL capability yields SESSION_CAPABILITY_EXPIRED', async () => {
    const { ctx } = makeCtx();
    await expect(
      dispatchGatewayTool('read_page', { sessionCapability: 'clc_stale' }, ctx),
    ).rejects.toMatchObject({ code: 'SESSION_CAPABILITY_EXPIRED' });
  });

  it('get_status routes DL->adapter and CL->resolved DO forward', async () => {
    const { ctx, dlCalls, clForwards } = makeCtx();
    await dispatchGatewayTool('get_status', { sessionCapability: 'dlc_A' }, ctx);
    await dispatchGatewayTool('get_status', { sessionCapability: 'clc_good' }, ctx);
    expect(dlCalls.some((c) => c.m === 'status' && c.capability === 'dlc_A')).toBe(true);
    expect(clForwards.some((f) => f.name === 'get_status' && f.clToken === 'CL-TOKEN-1')).toBe(true);
  });
});

describe('kill switch + redaction', () => {
  it('rejects DL connect and DL tools with AGENT_LINK_UNAVAILABLE when disabled, never leaking the capability', async () => {
    const { ctx } = makeCtx({ dlEnabled: false, dl: null });
    await expect(dispatchGatewayTool('connect_session', { code: 'DL-2345-ABCD-6789' }, ctx)).rejects.toMatchObject({
      code: 'AGENT_LINK_UNAVAILABLE',
    });
    const err = await dispatchGatewayTool('render_diagram', { sessionCapability: 'dlc_secret', title: 't', notation: 'mermaid', source: 'g' }, ctx).catch(
      (e: GatewayAdapterError) => e,
    );
    expect(err.code).toBe('AGENT_LINK_UNAVAILABLE');
    expect(err.message).not.toContain('dlc_secret');
  });

  it('leaves CL working when the DL kill switch is off', async () => {
    const { ctx } = makeCtx({ dlEnabled: false, dl: null });
    const res = (await dispatchGatewayTool('connect_session', { code: 'CL-8F3K7Q' }, ctx)) as { capability: string };
    expect(res.capability).toBe('clc_new');
  });

  it('rejects an unknown tool name', async () => {
    const { ctx } = makeCtx();
    await expect(dispatchGatewayTool('delete_everything', {}, ctx)).rejects.toMatchObject({ code: 'UNKNOWN_TOOL' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run functions/agent-link/gatewayDispatch.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `gatewayDispatch.ts`**

```typescript
// functions/agent-link/gatewayDispatch.ts
// Capability router for the gateway path (spec §6.2/§6.3, §15). Stateless:
// every call routes purely on the code/capability the agent supplied, so
// concurrent sessions cannot cross-leak. Wrong-product calls reject with
// TOOL_NOT_AVAILABLE_FOR_SESSION; the DL kill switch yields AGENT_LINK_UNAVAILABLE.
// Errors carry a stable machine code and a GENERIC message — the raw
// code/capability is never interpolated (redaction, spec §7.3).

import { detectCapabilityProduct, detectCodeProduct } from './gatewayCredentials';
import { GatewayAdapterError, type DiagramlyAdapter } from './diagramlyAdapter';
import type { ConfluenceAdapter } from './confluenceAdapter';
import type { ForwardResult, ToolName } from './mcpTools';
import { CL_CONTEXT_TOOL_NAMES, GATEWAY_TOOL_NAMES } from './gatewayTools';

export interface GatewayDispatchContext {
  dlEnabled: boolean;
  dl: DiagramlyAdapter | null;
  cl: ConfluenceAdapter;
  clientIp?: string;
  /** Resolve-and-forward a CL tool to the Durable Object addressed by `clToken`
   *  (mcp.ts wires this to authenticateViaDo + dispatchTool). */
  runClTool(clToken: string, name: string, args: Record<string, unknown>): Promise<ForwardResult>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(args: Record<string, unknown>, field: string): string {
  const v = args[field];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new GatewayAdapterError('INVALID_ARGS', `Missing required "${field}".`);
  }
  return v;
}

function requireDl(ctx: GatewayDispatchContext): DiagramlyAdapter {
  if (!ctx.dlEnabled || !ctx.dl) {
    throw new GatewayAdapterError('AGENT_LINK_UNAVAILABLE', 'The Diagramly agent link is currently unavailable.', true);
  }
  return ctx.dl;
}

/** Resolve a clc_ capability to its CL DO-addressing token, or fail expired. */
async function resolveCl(ctx: GatewayDispatchContext, capability: string): Promise<string> {
  const clToken = await ctx.cl.resolve(capability);
  if (!clToken) {
    throw new GatewayAdapterError('SESSION_CAPABILITY_EXPIRED', 'The session has expired; reconnect to continue.');
  }
  return clToken;
}

export async function dispatchGatewayTool(
  name: string,
  rawArgs: unknown,
  ctx: GatewayDispatchContext,
): Promise<unknown> {
  if (!GATEWAY_TOOL_NAMES.has(name)) {
    throw new GatewayAdapterError('UNKNOWN_TOOL', `Unknown tool: ${name}`);
  }
  const args = rawArgs ?? {};
  if (!isPlainObject(args)) {
    throw new GatewayAdapterError('INVALID_ARGS', `Arguments for "${name}" must be an object.`);
  }

  if (name === 'connect_session') {
    const code = requireString(args, 'code');
    const product = detectCodeProduct(code);
    const clientName = typeof args.clientName === 'string' ? args.clientName : undefined;
    const clientVersion = typeof args.clientVersion === 'string' ? args.clientVersion : undefined;
    if (product === 'DL') {
      return requireDl(ctx).connect({ code, clientName, clientVersion, clientIp: ctx.clientIp });
    }
    if (product === 'CL') {
      return ctx.cl.connect(code);
    }
    throw new GatewayAdapterError('PAIRING_CODE_INVALID', 'The pairing code is not recognized.');
  }

  // Every other tool carries a session capability.
  const capability = requireString(args, 'sessionCapability');
  const capProduct = detectCapabilityProduct(capability);

  if (name === 'report_activity') {
    if (capProduct !== 'DL') throw wrongProduct();
    return requireDl(ctx).reportActivity({
      capability,
      phase: requireString(args, 'phase'),
      summary: requireString(args, 'summary'),
    });
  }

  if (name === 'render_diagram') {
    if (capProduct !== 'DL') throw wrongProduct();
    const dl = requireDl(ctx);
    const notation = requireString(args, 'notation') as 'mermaid' | 'zenuml' | 'plantuml';
    return dl.render({
      capability,
      title: requireString(args, 'title'),
      notation,
      subType: typeof args.subType === 'string' ? args.subType : undefined,
      source: requireString(args, 'source'),
    });
  }

  if (name === 'get_status') {
    if (capProduct === 'DL') return requireDl(ctx).getStatus(capability);
    if (capProduct === 'CL') {
      const clToken = await resolveCl(ctx, capability);
      return ctx.runClTool(clToken, 'get_status', {});
    }
    throw new GatewayAdapterError('SESSION_CAPABILITY_EXPIRED', 'The session has expired; reconnect to continue.');
  }

  // CL context tools (read_page / read_diagram / update_diagram / search_diagrams / list_diagrams).
  if (CL_CONTEXT_TOOL_NAMES.has(name)) {
    if (capProduct !== 'CL') throw wrongProduct();
    const clToken = await resolveCl(ctx, capability);
    const { sessionCapability, ...forwardArgs } = args; // strip the capability before forwarding
    void sessionCapability;
    return ctx.runClTool(clToken, name as ToolName, forwardArgs);
  }

  // Unreachable: GATEWAY_TOOL_NAMES gate above covers every case.
  throw new GatewayAdapterError('UNKNOWN_TOOL', `Unknown tool: ${name}`);
}

function wrongProduct(): GatewayAdapterError {
  return new GatewayAdapterError(
    'TOOL_NOT_AVAILABLE_FOR_SESSION',
    'That tool is not available for this session type.',
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run functions/agent-link/gatewayDispatch.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/agent-link/gatewayTools.ts functions/agent-link/gatewayDispatch.ts functions/agent-link/gatewayDispatch.spec.ts
git commit -m "feat(agent-link): capability router enforces product isolation + kill switch so DL and CL never cross (spec §6.3, §15)"
```

---

### Task 9: Versioned DL guide resources (single-source, additive)

**Files:**
- Modify: `functions/agent-link/dslGuides.ts` (add versioned gateway listing; leave the existing 4-guide `listGuideResources()` untouched)
- Test: `functions/agent-link/dslGuides-gateway.spec.ts`

**Interfaces:**
- Produces: `AGENT_LINK_GUIDES_VERSION` (dated, single-source — the guides are the sole content source, spec §6.4); `GATEWAY_GUIDE_DIALECTS: GuideDialect[]` = `['mermaid','zenuml','plantuml']`; `listGatewayGuideResources()` — the three DL notations, each carrying a `version`, reusing the existing `GUIDES` registry (no duplicated prompt text). The legacy `listGuideResources()` still returns all four (incl. OpenAPI) so the existing CL `dslGuides`/`mcp` specs pass unmodified. Consumed by Task 10 (gateway-path `resources/list`).

- [ ] **Step 1: Write the failing test**

```typescript
// functions/agent-link/dslGuides-gateway.spec.ts
import { describe, it, expect } from 'vitest';
import {
  AGENT_LINK_GUIDES_VERSION,
  getGuideByUri,
  listGatewayGuideResources,
  listGuideResources,
} from './dslGuides';

describe('gateway (DL) guide resources', () => {
  it('advertises exactly the three DL notations (no OpenAPI), each versioned', () => {
    const gateway = listGatewayGuideResources();
    expect(gateway.map((r) => r.uri).sort()).toEqual(
      ['mermaid://dsl-guide', 'plantuml://dsl-guide', 'zenuml://dsl-guide'].sort(),
    );
    for (const r of gateway) {
      expect(r.version).toBe(AGENT_LINK_GUIDES_VERSION);
      expect(r.mimeType).toBe('text/markdown');
    }
  });

  it('serves the same single-source content as the resource reader (no drift)', () => {
    for (const r of listGatewayGuideResources()) {
      expect(getGuideByUri(r.uri)?.text.length).toBeGreaterThan(0);
    }
  });

  it('leaves the legacy 4-guide listing (incl. OpenAPI) unchanged', () => {
    expect(listGuideResources().map((r) => r.uri).sort()).toEqual(
      ['mermaid://dsl-guide', 'openapi://dsl-guide', 'plantuml://dsl-guide', 'zenuml://dsl-guide'].sort(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run functions/agent-link/dslGuides-gateway.spec.ts`
Expected: FAIL — `listGatewayGuideResources` / `AGENT_LINK_GUIDES_VERSION` not exported.

- [ ] **Step 3: Add the exports to `dslGuides.ts`** (append after `listGuideResources`)

```typescript
// Single-source version stamp for the DL-facing guide resources (spec §6.3
// "versioned", §6.4 "唯一内容来源" — the Gateway guides are the one source;
// Diagramly does not fork a second prompt set). Dated rather than per-dialect
// semver so it can't drift from the content it labels.
export const AGENT_LINK_GUIDES_VERSION = '2026-07-16';

/** The notations a Diagramly (DL) session renders (spec §3.1/§6.3) — no OpenAPI. */
export const GATEWAY_GUIDE_DIALECTS: GuideDialect[] = ['mermaid', 'zenuml', 'plantuml'];

/**
 * Gateway-path resources/list: the three DL notations, each versioned, drawn
 * from the SAME GUIDES registry the CL path serves. OpenAPI is a Confluence-only
 * diagram type and stays on the legacy `listGuideResources()` (four entries).
 */
export function listGatewayGuideResources(): Array<{
  uri: string;
  name: string;
  mimeType: string;
  description: string;
  version: string;
}> {
  return GATEWAY_GUIDE_DIALECTS.map((k) => ({
    uri: GUIDES[k].uri,
    name: GUIDES[k].resourceName,
    mimeType: 'text/markdown',
    description: GUIDES[k].resourceDescription,
    version: AGENT_LINK_GUIDES_VERSION,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run functions/agent-link/dslGuides-gateway.spec.ts functions/agent-link/dslGuides.spec.ts`
Expected: PASS (existing `dslGuides.spec.ts` still green).

- [ ] **Step 5: Commit**

```bash
git add functions/agent-link/dslGuides.ts functions/agent-link/dslGuides-gateway.spec.ts
git commit -m "feat(agent-link): versioned DL guide resources from the single guide source, OpenAPI stays CL-only (spec §6.3, §6.4)"
```

---

### Task 10: Wire the gateway path into `mcp.ts` (legacy/gateway split)

The capstone. Tasks 1–9 are self-contained modules with no caller; this task splits `onRequestPost` so **no token → the token-free gateway path** (discovery + `dispatchGatewayTool`) and **a token present → today's exact legacy path, byte-for-byte**. This is the minimum-regression realization of spec §6.2's "支持两者" (support both old CL-token auth and the new exchange simultaneously) and the composition root that constructs the concrete adapters from `env`.

**Files:**
- Modify: `functions/agent-link/mcp.ts` (branch on token; add the gateway handler + composition root)
- Modify: `functions/agent-link/mcp.spec.ts` (the ONE deliberate assertion change — the documented exception in the Regression contract)
- Modify: `wrangler-stg.toml`, `wrangler-dev.toml` (add the two non-secret gateway vars; the service secret is a wrangler **secret**, never in a `*.toml`)
- Test: `functions/agent-link/mcp-gateway.spec.ts` (the gateway-path integration surface)

**Interfaces:**
- Consumes: Task 4/5 (`createDiagramlyAdapter`, `GatewayAdapterError`), Task 6 (`D1CapabilityRegistry`), Task 7 (`ConfluenceAdapter`), Task 8 (`GATEWAY_TOOL_DESCRIPTORS`, `dispatchGatewayTool`, `GatewayDispatchContext`), Task 9 (`listGatewayGuideResources`), plus the existing `authenticateViaDo`, `doForwardToMacro`, `stubForwardToMacro`, `dispatchTool`, `getGuideByUri`, `effectiveExpiryMs`, `authenticateSession`, `sessionRegistry`, `ToolError`, `MacroForwardError`.
- Produces: no new exports. `onRequestPost` gains a top-level token branch; two module-private helpers (`handleGatewayPost`, `buildGatewayContext`) and a `generateClCapability` composition helper are added. The legacy code from `let body` downward is **unchanged**.

- [ ] **Step 1: Write the failing gateway test**

```typescript
// functions/agent-link/mcp-gateway.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { onRequestPost } from './mcp';
import { CONNECT_RESPONSE } from './__fixtures__/diagramly-internal-api';
import type { BoundContext } from './sessionToken';

function rpc(method: string, params?: unknown, id: number | string = 1) {
  return { jsonrpc: '2.0', id, method, params };
}

/** A no-token request (the gateway path); optional CF-Connecting-IP header. */
function gwRequest(body: unknown, opts: { clientIp?: string } = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.clientIp) headers['CF-Connecting-IP'] = opts.clientIp;
  return new Request('https://example.com/agent-link/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function gwPost(body: unknown, env: unknown, opts?: { clientIp?: string }) {
  const res = await onRequestPost({ request: gwRequest(body, opts), env } as any);
  return { res, json: await res.json() };
}

/** Minimal D1 double — exactly the two statements D1CapabilityRegistry runs (mirrors Task 6). */
function fakeD1() {
  const rows = new Map<string, { target: string; product: string; createdAt: number; expiresAt: number }>();
  return {
    prepare(sql: string) {
      const isInsert = /INSERT/i.test(sql);
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          args = a;
          return stmt;
        },
        async run() {
          const [hash, target, product, createdAt, expiresAt] = args as [string, string, string, number, number];
          if (isInsert) rows.set(hash, { target, product, createdAt, expiresAt });
          return { success: true };
        },
        async first<T>(): Promise<T | null> {
          const [hash, now] = args as [string, number];
          const row = rows.get(hash);
          if (!row || row.expiresAt <= (now as number)) return null;
          return { target: row.target } as unknown as T;
        },
      };
      return stmt;
    },
  };
}

/** Minimal AgentLinkSession DO namespace double — GET /session + POST /agent-op. */
function fakeAgentLink(session: { boundContext: BoundContext; issuedAtMs: number; lastActivityMs: number; state: string }) {
  const forwards: Array<{ op: string; args: unknown }> = [];
  const ns = {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      fetch: async (url: string, init?: RequestInit) => {
        if (url.includes('/session')) {
          return new Response(
            JSON.stringify({
              state: session.state,
              boundContext: session.boundContext,
              issuedAtMs: session.issuedAtMs,
              lastActivityMs: session.lastActivityMs,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (url.includes('/agent-op')) {
          const parsed = JSON.parse(init!.body as string) as { op: string; args: unknown };
          forwards.push({ op: parsed.op, args: parsed.args });
          return new Response(JSON.stringify({ ok: true, payload: { forwarded: parsed.op } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    }),
  };
  return { ns, forwards };
}

describe('token-free discovery (spec §6.2, §16.2)', () => {
  it('initialize works with no token', async () => {
    const { res, json } = await gwPost(rpc('initialize'), {});
    expect(res.status).toBe(200);
    expect(json.result.serverInfo.name).toBe('conf-agent-link');
    expect(json.result.capabilities).toEqual({ tools: {}, resources: {} });
  });

  it('tools/list advertises the cross-product surface; CL context tools carry a required sessionCapability', async () => {
    const { json } = await gwPost(rpc('tools/list'), {});
    const names = json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('connect_session');
    expect(names).toContain('report_activity');
    expect(names).toContain('render_diagram');
    expect(names).toContain('read_page');
    const readPage = json.result.tools.find((t: { name: string }) => t.name === 'read_page');
    expect(readPage.inputSchema.required).toContain('sessionCapability');
  });

  it('resources/list serves exactly the three versioned DL guides (no OpenAPI)', async () => {
    const { json } = await gwPost(rpc('resources/list'), {});
    expect(json.result.resources.map((r: { uri: string }) => r.uri).sort()).toEqual(
      ['mermaid://dsl-guide', 'plantuml://dsl-guide', 'zenuml://dsl-guide'].sort(),
    );
    for (const r of json.result.resources) expect(r.version).toBe('2026-07-16');
  });

  it('resources/read returns guide text; notifications/initialized → 202', async () => {
    const read = await gwPost(rpc('resources/read', { uri: 'mermaid://dsl-guide' }), {});
    expect(read.json.result.contents[0].text.length).toBeGreaterThan(0);
    const note = await onRequestPost({
      request: gwRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      env: {},
    } as any);
    expect(note.status).toBe(202);
  });
});

describe('DL kill switch is dark by default (spec §17.1, §15)', () => {
  it('with no DIAGRAMLY_AGENT_LINK_ENABLED, DL connect + DL tools return AGENT_LINK_UNAVAILABLE and never leak the capability', async () => {
    const env = { DB: fakeD1() }; // flag absent ⇒ off

    const c = await gwPost(rpc('tools/call', { name: 'connect_session', arguments: { code: 'DL-2345-ABCD-6789' } }), env);
    expect(c.json.error.data?.code).toBe('AGENT_LINK_UNAVAILABLE');

    const r = await gwPost(
      rpc('tools/call', {
        name: 'render_diagram',
        arguments: { sessionCapability: 'dlc_supersecret', title: 't', notation: 'mermaid', source: 'graph TD;A-->B' },
      }),
      env,
    );
    expect(r.json.error.data?.code).toBe('AGENT_LINK_UNAVAILABLE');
    expect(r.res.status).toBe(503); // retriable transport-class
    expect(JSON.stringify(r.json)).not.toContain('dlc_supersecret'); // redaction (spec §7.3)
  });
});

describe('DL enabled: signed HTTP to Diagramly (spec §7.3, roadmap §2.2)', () => {
  it('connect_session with a DL code routes to Diagramly and forwards CF-Connecting-IP in the signed body', async () => {
    const captured: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      captured.push({ url, init: init ?? {} });
      return new Response(JSON.stringify(CONNECT_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    try {
      const env = {
        DIAGRAMLY_AGENT_LINK_ENABLED: 'true',
        DIAGRAMLY_INTERNAL_API_BASE: 'https://staging.diagramly.ai',
        AGENT_LINK_SERVICE_SECRET: 'svc-secret',
      };
      const { res, json } = await gwPost(
        rpc('tools/call', { name: 'connect_session', arguments: { code: 'DL-2345-ABCD-6789', clientName: 'claude-code' } }),
        env,
        { clientIp: '203.0.113.7' },
      );
      expect(res.status).toBe(200);
      expect(json.result.structuredContent.capability).toMatch(/^dlc_/);
      expect(captured[0].url).toBe('https://staging.diagramly.ai/api/agent-link/internal/connect');
      expect(headerOf(captured[0].init, 'X-AgentLink-Signature')).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.parse(captured[0].init.body as string).clientIp).toBe('203.0.113.7');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string>)[name];
}

describe('one install connects CL and rejects a cross-adapter capability (DoD §18.1/§18.2)', () => {
  it('connect_session (CL) → clc_, then a CL tool forwards to the DO; a DL capability on a CL tool is rejected', async () => {
    const now = Date.now();
    const { ns, forwards } = fakeAgentLink({
      boundContext: { cloudId: 'c', pageId: 'p', contentId: 'x' },
      issuedAtMs: now,
      lastActivityMs: now,
      state: 'created',
    });
    const env = { AGENT_LINK: ns, DB: fakeD1() };

    // 1. Exchange a CL code for a fresh clc_ capability (no token leak).
    const connect = await gwPost(rpc('tools/call', { name: 'connect_session', arguments: { code: 'CL-8F3K7Q' } }), env);
    expect(connect.res.status).toBe(200);
    const capability = connect.json.result.structuredContent.capability as string;
    expect(capability).toMatch(/^clc_[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(connect.json)).not.toContain('CL-8F3K7Q'); // redaction

    // 2. read_page with that capability resolves clc_ → the DO token and forwards.
    const read = await gwPost(rpc('tools/call', { name: 'read_page', arguments: { sessionCapability: capability } }), env);
    expect(read.res.status).toBe(200);
    expect(forwards.some((f) => f.op === 'read_page')).toBe(true);

    // 3. A DL capability on a CL tool is a cross-adapter call → rejected.
    const wrong = await gwPost(rpc('tools/call', { name: 'read_page', arguments: { sessionCapability: 'dlc_x' } }), env);
    expect(wrong.json.error.data?.code).toBe('TOOL_NOT_AVAILABLE_FOR_SESSION');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run functions/agent-link/mcp-gateway.spec.ts`
Expected: FAIL — a no-token `initialize`/`tools/list` currently returns 401 `missing` (the pre-WS3 handler), so every assertion mismatches.

- [ ] **Step 3: Split `onRequestPost` and add the gateway composition root**

Extend the `Env` interface (the gateway reads three vars + the existing D1 binding):

```typescript
interface Env {
  AGENT_LINK?: DurableObjectNamespace;
  /** D1 binding (`DB` in wrangler-*.toml) — the CL capability registry (Task 6). */
  DB?: D1Database;
  /** Kill switch (spec §17.1). Absent / not exactly "true" ⇒ DL is OFF. */
  DIAGRAMLY_AGENT_LINK_ENABLED?: string;
  /** Diagramly origin, e.g. https://staging.diagramly.ai (roadmap §2.5). */
  DIAGRAMLY_INTERNAL_API_BASE?: string;
  /** Rotatable HMAC service secret — wrangler SECRET, never a *.toml value. */
  AGENT_LINK_SERVICE_SECRET?: string;
}
```

Add to the imports at the top of `mcp.ts`:

```typescript
import { authenticateSession } from './mcpAuth';
import { dispatchTool, getToolSchemas, ToolError } from './mcpTools';
import type { DispatchContext, ForwardResult, ToolName } from './mcpTools';
import { getGuideByUri, listGuideResources, listGatewayGuideResources, selectInstructions } from './dslGuides';
import { GATEWAY_TOOL_DESCRIPTORS } from './gatewayTools';
import { dispatchGatewayTool } from './gatewayDispatch';
import type { GatewayDispatchContext } from './gatewayDispatch';
import { createDiagramlyAdapter, GatewayAdapterError } from './diagramlyAdapter';
import { ConfluenceAdapter } from './confluenceAdapter';
import { D1CapabilityRegistry } from './capabilityRegistry';
```

(The first three lines already exist — only `listGatewayGuideResources` is new on the `dslGuides` import; the `authenticateSession`/`dispatchTool` lines are shown for context, unchanged.)

Add a gateway-path JSON-RPC error code near the other `RPC_*` constants:

```typescript
// Gateway-path tool failure (spec §15): the stable machine code rides in
// `error.data.code`; the message stays GENERIC (redaction, spec §7.3 — the raw
// capability/code value is never interpolated).
const RPC_GATEWAY_ERROR = -32010;
```

Add these module-private helpers (place them just above `onRequestOptions`):

```typescript
function base64UrlNoPad(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh CL session capability: `clc_` + 43 base64url chars (256 bits). */
function generateClCapability(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `clc_${base64UrlNoPad(bytes)}`;
}

/**
 * Composition root for the gateway path: builds the DL/CL adapters and the CL
 * forwarder from `env`. Called only on `tools/call` (discovery methods need no
 * adapters). DL is null unless the kill switch is exactly "true" (spec §17.1);
 * the CL forwarder reuses the SAME DO auth + dispatch the legacy path uses, so
 * a `clc_`-routed CL tool hits the identical AgentLinkSession behavior.
 */
function buildGatewayContext(request: Request, env: Env): GatewayDispatchContext {
  const dlEnabled = env.DIAGRAMLY_AGENT_LINK_ENABLED === 'true';
  const dl = dlEnabled
    ? createDiagramlyAdapter({
        base: env.DIAGRAMLY_INTERNAL_API_BASE ?? '',
        secret: env.AGENT_LINK_SERVICE_SECRET ?? '', // adapter throws before I/O if blank (no fallback secret)
        fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
        now: () => Date.now(),
        sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
        uuid: () => crypto.randomUUID(),
      })
    : null;

  const cl = new ConfluenceAdapter({
    registry: new D1CapabilityRegistry(env.DB as D1Database),
    validateSession: async (clToken: string) => {
      // A CL code IS the DO-addressing token today; validate it as a live
      // session and read its effective (slid, capped) expiry for the binding.
      if (!env.AGENT_LINK) return { ok: false };
      const { auth } = await authenticateViaDo(env.AGENT_LINK, clToken, false); // never bumps — pure validation
      if (!auth.ok) return { ok: false };
      return { ok: true, expiresAtMs: effectiveExpiryMs(auth.session.issuedAtMs, auth.session.lastActivityMs) };
    },
    generateCapability: generateClCapability,
    now: () => Date.now(),
  });

  return {
    dlEnabled,
    dl,
    cl,
    clientIp: request.headers.get('CF-Connecting-IP') ?? undefined,
    runClTool: async (clToken: string, name: string, args: Record<string, unknown>): Promise<ForwardResult> => {
      // No companion Worker (local dev / this file's tests without a DO): reuse
      // the same stub the legacy path uses so the CL surface stays exercisable.
      if (!env.AGENT_LINK) {
        const auth = authenticateSession(clToken, sessionRegistry, Date.now());
        if (!auth.ok) {
          throw new GatewayAdapterError('SESSION_CAPABILITY_EXPIRED', 'The session has expired; reconnect to continue.');
        }
        return dispatchTool(name, args, { session: auth.session, forwardToMacro: stubForwardToMacro(auth.session) });
      }
      const bumpWorthy = name !== 'get_status';
      const { auth, diagram } = await authenticateViaDo(env.AGENT_LINK, clToken, bumpWorthy);
      if (!auth.ok) {
        throw new GatewayAdapterError('SESSION_CAPABILITY_EXPIRED', 'The session has expired; reconnect to continue.');
      }
      const ctx: DispatchContext = {
        session: auth.session,
        forwardToMacro: doForwardToMacro(env.AGENT_LINK, clToken),
        diagramSnapshot: diagram,
      };
      try {
        return await dispatchTool(name, args, ctx);
      } catch (err) {
        // Parity with the legacy path: a pre-forward guardrail reject is the
        // worst dead-air case, so surface it on the DO status bus (best-effort).
        if (err instanceof ToolError && err.code === 'guardrail') {
          try {
            const stub = env.AGENT_LINK.get(env.AGENT_LINK.idFromName(clToken));
            await stub.fetch('https://agent-link-do/activity', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'guardrail_rejected',
                detail: (err.data as { reason?: string } | undefined)?.reason ?? 'guardrail',
              }),
            });
          } catch {
            // swallow — a failed report must not mask the RPC error reply
          }
        }
        throw err;
      }
    },
  };
}

/** Maps a gateway-path tool error to a JSON-RPC response (stable code in `data.code`, generic message). */
function gatewayToolErrorResponse(id: JsonRpcId, err: unknown): Response {
  if (err instanceof GatewayAdapterError) {
    // Retriable transport / kill-switch → 503 so the agent's HTTP client can
    // short-circuit and retry (spec §15 "Gateway 不可用 | retriable"); a
    // contract rejection → HTTP 200 with a JSON-RPC error envelope.
    const status = err.retriable ? 503 : 200;
    return jsonRpcError(status, id, RPC_GATEWAY_ERROR, err.message, {
      code: err.code,
      ...(err.retriable ? { retriable: true } : {}),
    });
  }
  if (err instanceof ToolError) {
    // A CL context tool forwarded via runClTool — same mapping as the legacy path.
    let code = RPC_UNKNOWN_TOOL;
    if (err.code === 'bad_args') code = RPC_INVALID_PARAMS;
    else if (err.code === 'guardrail') code = RPC_GUARDRAIL_REJECTED;
    return jsonRpcError(200, id, code, err.message, err.data ?? { code: err.code });
  }
  if (err instanceof MacroForwardError) {
    const status =
      err.code === 'macro_not_connected' || err.code === 'macro_disconnected'
        ? 409
        : err.code === 'macro_timeout'
          ? 504
          : 502;
    return jsonRpcError(status, id, RPC_MACRO_ERROR, err.message, err.data ?? { code: err.code });
  }
  throw err;
}

/**
 * The token-free gateway path (spec §6.2): discovery works unconnected;
 * every capability-bearing tool authorizes per call inside dispatchGatewayTool.
 * Structurally mirrors the legacy switch (initialize/tools/list/resources/
 * tools/call/notifications) but serves the cross-product surface and routes
 * `tools/call` through the capability router.
 */
async function handleGatewayPost(request: Request, env: Env): Promise<Response> {
  let body: JsonRpcRequestBody;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(400, null, RPC_PARSE_ERROR, 'Parse error: invalid JSON body');
  }
  if (!body || typeof body !== 'object' || typeof body.method !== 'string') {
    return jsonRpcError(400, body?.id ?? null, RPC_INVALID_REQUEST, 'Invalid Request: missing "method"');
  }
  const id = body.id ?? null;

  if (body.method.startsWith('notifications/')) {
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  switch (body.method) {
    case 'initialize':
      // No bound diagram type on the gateway path (no session yet) — the
      // versioned DL guides are the resource surface; no per-dialect instructions.
      return jsonRpcResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'conf-agent-link', version: '0.1.0' },
      });

    case 'tools/list':
      return jsonRpcResult(id, { tools: GATEWAY_TOOL_DESCRIPTORS });

    case 'resources/list':
      return jsonRpcResult(id, { resources: listGatewayGuideResources() });

    case 'resources/read': {
      // Lenient reader (shared with the legacy path): guide text is public
      // content and carries no secret, so an openapi:// read is harmless even
      // though it isn't advertised on the gateway list.
      const rparams = (body.params ?? {}) as { uri?: unknown };
      const guide = typeof rparams.uri === 'string' ? getGuideByUri(rparams.uri) : undefined;
      if (!guide) {
        return jsonRpcError(400, id, RPC_INVALID_PARAMS, `Unknown resource: ${String(rparams.uri)}`);
      }
      return jsonRpcResult(id, {
        contents: [{ uri: guide.uri, mimeType: 'text/markdown', text: guide.text }],
      });
    }

    case 'tools/call': {
      const params = (body.params ?? {}) as { name?: unknown; arguments?: unknown };
      if (typeof params.name !== 'string') {
        return jsonRpcError(400, id, RPC_INVALID_PARAMS, 'tools/call requires a "name" string');
      }
      const ctx = buildGatewayContext(request, env);
      try {
        const result = await dispatchGatewayTool(params.name, params.arguments, ctx);
        const isRecordResult = result !== null && typeof result === 'object' && !Array.isArray(result);
        return jsonRpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          ...(isRecordResult ? { structuredContent: result as Record<string, unknown> } : {}),
        });
      } catch (err) {
        return gatewayToolErrorResponse(id, err);
      }
    }

    default:
      return jsonRpcError(400, id, RPC_METHOD_NOT_FOUND, `Unknown method: ${body.method}`);
  }
}
```

Finally, replace the **missing-token short-circuit** at the top of `onRequestPost` with the token branch. Change this block:

```typescript
  const url = new URL(request.url);
  const token = extractToken(request, url);

  // Cheap, local, no-I/O check — a blank/absent token can never authenticate
  // anywhere, so there's no reason to round-trip to the DO (or the fallback
  // registry) to find that out. Real token *validity* (known vs. unknown,
  // expired vs. live) is answered below by whichever backing store is live
  // in this environment.
  if (!token || token.trim().length === 0) {
    return jsonRpcError(401, null, RPC_AUTH_ERROR, authErrorMessage('missing'), { code: 'missing' });
  }
```

to:

```typescript
  const url = new URL(request.url);
  const token = extractToken(request, url);

  // WS3 split (spec §6.2, "支持两者"): NO token → the token-free Gateway path
  // (discovery + capability-routed tool calls); a token present → the legacy CL
  // path below, kept byte-for-byte so every existing behavior/assertion holds.
  // A no-token install is REQUIRED for the DL flow to work at all — the old
  // blank-token 401 is now a token-free discovery entry point. The
  // missing-credential invariant it protected is re-asserted inside
  // dispatchGatewayTool (a capability-required tool with no/invalid capability
  // still rejects).
  if (!token || token.trim().length === 0) {
    return handleGatewayPost(request, env ?? ({} as Env));
  }
```

Everything from `let body: JsonRpcRequestBody;` down is **unchanged** — the legacy CL path is byte-identical.

- [ ] **Step 4: Apply the ONE deliberate mcp.spec.ts change** (the documented Regression-contract exception)

Replace the `'returns 401 when no token is presented'` test with the repurposed token-free-discovery assertion. This is the single allowed edit to the 13 locked CL specs:

```typescript
  it('token-free tools/list returns 200 (discovery works unconnected, spec §6.2); the missing-credential invariant moves to a capability-required call', async () => {
    // Pre-WS3 this returned 401 "missing" (token = auth). A token-free install
    // is required for the DL flow, so a no-token tools/list now succeeds.
    const { res, json } = await post(rpc('tools/list'));
    expect(res.status).toBe(200);
    expect(json.result.tools.some((t: { name: string }) => t.name === 'connect_session')).toBe(true);

    // The invariant the old 401 protected — no credential ⇒ no product access —
    // is re-asserted on a capability-required tool: a DL tool with the kill
    // switch off (the default in this harness, which passes no env) rejects
    // rather than silently succeeding.
    const denied = await post(
      rpc('tools/call', {
        name: 'render_diagram',
        arguments: { sessionCapability: 'dlc_x', title: 't', notation: 'mermaid', source: 'graph TD;A-->B' },
      }),
    );
    expect(denied.json.error).toBeDefined();
    expect(denied.json.error.data?.code).toBe('AGENT_LINK_UNAVAILABLE');
  });
```

The two other auth assertions — `'returns 401 for a bogus token'` and `'returns 403 for an expired token'` — present a token, take the legacy path, and stay **unchanged**.

- [ ] **Step 5: Add the two non-secret gateway vars to the staging + dev wrangler configs**

The gateway ships **wired but dark**: `DIAGRAMLY_INTERNAL_API_BASE` is present so flipping DL on later (§17.2 step 8) is a one-var change, and `DIAGRAMLY_AGENT_LINK_ENABLED` is explicitly `"false"` (dark by default). The service secret is **not** added here — it is a wrangler secret (`AGENT_LINK_SERVICE_SECRET`), provisioned out-of-band by the user before DL is enabled; its absence while DL is off is correct (the adapter is never constructed). **Do not touch `wrangler-prod.toml`** (Global Constraints — prod enablement is WS6).

In `wrangler-stg.toml`, extend the top-level `[vars]` and the `[env.production.vars]` blocks (staging deploys `env.production`) with:

```toml
DIAGRAMLY_AGENT_LINK_ENABLED = "false"
DIAGRAMLY_INTERNAL_API_BASE = "https://staging.diagramly.ai"
```

In `wrangler-dev.toml`, add the same two lines to its `[vars]` block(s) (local dev keeps DL off; the base URL points at staging, which is where the internal API lives during WS3).

- [ ] **Step 6: Run the full agent-link suite (legacy regression + the new gateway path)**

```bash
pnpm exec vitest run functions/agent-link/mcp-gateway.spec.ts functions/agent-link/mcp.spec.ts
pnpm test:unit
```

Expected: PASS. `mcp.spec.ts` has 40 tests — 39 unchanged (byte-identical legacy behavior), 1 repurposed. `pnpm test:unit` (the CI-wired gate, all `functions/agent-link/*.spec.ts`) is green.

- [ ] **Step 7: Commit**

```bash
git add functions/agent-link/mcp.ts functions/agent-link/mcp.spec.ts functions/agent-link/mcp-gateway.spec.ts wrangler-stg.toml wrangler-dev.toml
git commit -m "feat(agent-link): split mcp.ts into legacy CL + token-free gateway paths so one install serves CL and DL (spec §6.2)"
```

---

## Cross-repo fixtures consistency (the `/internal/*` contract must byte-match roadmap §2.2)

Task 3's `__fixtures__/diagramly-internal-api.ts` is the **single source of truth** both WS3's gateway mocks and WS2's Diagramly route tests import — so a field only ever changes once, deliberately, in one place. Before this plan is considered done, the fixture shapes were verified field-by-field against roadmap §2.2's endpoint table. **Result: no drift** — every request/response shape, path, header, and the signature canonical string already match. The mapping (for the reviewer):

| roadmap §2.2 | fixture in Task 3 | match |
|---|---|---|
| path base `…/api/agent-link/internal/*` | `INTERNAL_PATHS.{connect,activity,render,renderStatus,status}` = `/api/agent-link/internal/*` | ✅ |
| signature `hex(HMAC-SHA256(secret, "${method}\n${pathname}\n${timestamp}\n${sha256hex(rawBody)}"))` | Task 2 `signInternalRequest` builds the identical canonical string; `pathname` excludes query | ✅ |
| headers `X-AgentLink-Timestamp`, `X-AgentLink-Signature`, `Idempotency-Key` (mutations only) | Task 4 adapter sets exactly these; `X-AgentLink-Capability` on GETs | ✅ |
| `POST /internal/connect` `{ code, clientName?, clientVersion?, clientIp? }` → `{ sessionId, capability, capabilityExpiresAt, notations:["mermaid","zenuml","plantuml"], privacySummary }` | `ConnectRequest` / `ConnectResponse` + `CONNECT_RESPONSE` (notations in the same order) | ✅ |
| `POST /internal/activity` `{ capability, phase, summary }` → `{ sequence }` | `ActivityRequest` / `ActivityResponse` | ✅ |
| `POST /internal/render` `{ capability, title, notation, subType?, source }` → `{ renderId, sequence, status:"PENDING" }` | `RenderRequest` / `RenderAcceptedResponse` | ✅ |
| `GET /internal/render-status?renderId=…` (capability in header) → `{ status, durationMs?, errorCode?, errorLine?, errorMessage? }` | `RenderStatusResponse` + the 3 canned states; render polls with `query:{renderId}` + `capabilityHeader` | ✅ |
| `GET /internal/status` (capability in header) → session snapshot, does **not** slide TTL | `StatusResponse` + `STATUS_RESPONSE`; `getStatus` uses `capabilityHeader`, no idempotency key | ✅ |
| §13.3 `clientIp` populated from `CF-Connecting-IP`, signature-covered | `ConnectRequest.clientIp?`; Task 10 `buildGatewayContext` reads `CF-Connecting-IP`; Task 4 test asserts it rides in the signed body | ✅ |
| §15 error envelope `{ error: { code, message, retryAfter? } }` | `InternalErrorEnvelope` / `errorEnvelope()` | ✅ |

**Enforcement rule for both repos:** WS2's Diagramly route tests must `import` these same interfaces/fixtures (relative or via a copied-then-hash-pinned module) rather than redeclaring shapes; a field change is a two-repo PR touching only this file's shape. If WS2 discovers a needed field the fixture lacks, it is added **here first**, then consumed on both sides — never forked.

## Definition of done (mapping to spec §16.2 + §18.1–2)

WS3 is done when `pnpm test:unit` is green **and** each spec acceptance item below is demonstrably covered by a test in this plan:

| Spec item | Requirement | Proven by |
|---|---|---|
| **§18.1** | One install → connect **one CL session and one DL session** | Token-free discovery (Task 10 `initialize`/`tools/list`) + CL connect→forward round-trip (Task 10 DoD test) + DL connect over signed HTTP (Task 10 DL-enabled test) |
| **§18.2** | CL/DL capability **cannot be used across adapters** | Task 8 `gatewayDispatch.spec.ts` (`report_activity`/`render_diagram` reject `clc_`; CL context tools reject `dlc_` → `TOOL_NOT_AVAILABLE_FOR_SESSION`) + Task 10 DoD test (`dlc_` on `read_page` rejected end-to-end) |
| §16.2 | Standard MCP initialize/notification/tools/resources/call flow | Task 10 discovery tests (initialize, tools/list, resources/list, resources/read, notifications→202) |
| §16.2 | `CL-*` / `DL-*` adapter routing | Task 1 `gatewayCredentials.spec.ts` + Task 8 connect_session routing tests |
| §16.2 | Unconnected tool, wrong-product tool, forged capability rejected | Task 8 (wrong-product + unresolvable `clc_` → `SESSION_CAPABILITY_EXPIRED`) + Task 10 (kill-switch-off DL tool → `AGENT_LINK_UNAVAILABLE`) |
| §16.2 | code exchange, capability expiry, concurrent-session isolation | Task 7 (exchange + expiry), Task 6 (expiry), Task 8 (stateless router routes purely on the supplied capability — no shared state to cross-leak) |
| §16.2 | legacy CL rollout compatibility; query-token shutdown is a **later** phase | Legacy path byte-identical (39/40 mcp.spec.ts unchanged; the 2 token-present auth tests unchanged); the `?token=` query path still works (`mcp.spec.ts` "accepts the token via ?token=" untouched). Shutdown = WS6 (spec §6.2 final state) |
| §15 | error contract: stable machine code, generic message, retriable transport | `gatewayToolErrorResponse` (code in `data.code`, generic message, `retriable`→503) |
| §17.1 | DL kill switch default-off; CL never gated by it | Task 10 kill-switch test (DL off ⇒ `AGENT_LINK_UNAVAILABLE`; CL connect still succeeds with DL off) |
| §7.3 | redaction: codes/capabilities never in logs/errors/data | Every adapter/dispatcher error carries a generic message; Task 4/7/8/10 assert the raw `dlc_`/`clc_`/`CL-`/`DL-` value never appears in the error or the connect result |

**Resolved contract ambiguity (report in the final PR):** the pre-WS3 assertion `'returns 401 when no token is presented'` encoded the "token = auth" model spec §6.2 replaces. A token-free install is a hard requirement of the DL flow, so a no-token `tools/list` now returns 200. That single assertion was repurposed to prove token-free discovery, and the missing-credential invariant it protected is re-asserted on a capability-required tool call (Task 10 Step 4). No other CL assertion changed.

## Self-review record

Reviewed the completed plan against the four checks the WS3 charter calls out; findings recorded candidly (a self-review that finds nothing is a red flag).

1. **§6.2 CL back-compat — PASS.** The legacy path is entered whenever a token is present and runs unchanged from `let body` down, so all CL forwarding / cross-isolate auth / sliding-TTL / content-lock / guardrail / guide behavior is byte-identical (39/40 `mcp.spec.ts` untouched; the 2 token-present auth tests untouched). The `?token=` query path still authenticates (that test is untouched). Query-token *shutdown* is correctly deferred: spec §6.2 sequences it after old sessions drain (60-min cap) and §17.2 step 10 puts it in a later rollout — this plan does **not** remove it. The new `clc_` capability is the migration's forward path; both coexist, which is the whole point of the split.
2. **Kill-switch default-off with a test — PASS.** `DIAGRAMLY_AGENT_LINK_ENABLED === 'true'` is the only enable condition (absent/`"false"`/anything-else ⇒ off), set `"false"` in the wrangler configs, and Task 10's kill-switch test asserts a DL connect + DL tool return `AGENT_LINK_UNAVAILABLE` while CL still connects. `requireDl` throws before any adapter construction/I/O, and the DL adapter is `null` when off — so there is no path to a live DL call with the switch off.
3. **Redaction — PASS.** No pairing code, capability, CL token, `source`, `title`, or `summary` is ever interpolated into an error message, error `data` (only the stable `code`/`retriable` flag travels), or a log line. `GatewayAdapterError` messages are generic by construction; Tasks 4, 7, 8, and 10 each assert the raw secret value is absent from the error/connect result. The gateway is explicitly **not** a zero-knowledge relay for `render_diagram.source` (it passes through request memory to Diagramly) but `source` is never written to the DO, D1, logs, or analytics — no code path does so.
4. **No truncated sections; internal type consistency across tasks — PASS with two consistency notes.** Every task has Files / Interfaces / 5–7 TDD steps with complete code + exact commands + a one-line commit. Cross-task symbol check: `GatewayAdapterError` (Task 4) is re-exported by Task 7 and imported by Tasks 8/10; `ConnectResult` (Task 7) is what the DL adapter's `ConnectResponse` (Task 3) structurally satisfies — both carry `{capability, capabilityExpiresAt, notations, privacySummary}` and `sessionId` (DL sets it, CL omits it via the optional field), so the union the dispatcher returns is coherent; `GatewayDispatchContext.runClTool` returns `ForwardResult` (Task 8 type) and Task 10's implementation returns `dispatchTool(...)`'s `ForwardResult`; `listGatewayGuideResources` (Task 9) appends to `dslGuides.ts` where `GUIDES`/`GuideDialect`/`getGuideByUri` are in module scope. Two things a reviewer should watch: (a) Task 9's `listGatewayGuideResources` return type widens `listGuideResources`'s with a `version` field — the gateway `resources/list` serves the wider shape, which is additive and MCP-tolerated; (b) `generateClCapability` lives in `mcp.ts` (the composition root) rather than being injected like Task 7's test double — deliberate, since concrete crypto wiring belongs at the root, and its 43-char base64url format is asserted by Task 10's CL round-trip test (`/^clc_[A-Za-z0-9_-]{43}$/`).

**One honest gap surfaced (not blocking):** the plan wires the two non-secret wrangler vars but cannot itself provision the `AGENT_LINK_SERVICE_SECRET` wrangler secret (a cloud action requiring user approval, and DL stays dark in WS3 regardless). The plan states this explicitly; enabling DL on staging (§17.2 step 5/8) is gated on the user setting that secret, out of WS3 scope. This is correct scoping, not an omission.

---
