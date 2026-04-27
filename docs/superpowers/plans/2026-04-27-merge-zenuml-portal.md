# Merge zenuml-portal into conf-app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the standalone `zenuml-portal` Cloudflare Worker by porting its two endpoints (`/feature-flags`, `/ai-generate-title`) into conf-app Pages Functions, binding the existing KV namespaces and AI binding to all three variant Pages projects, and removing the `portalDomain.ts` abstraction.

**Architecture:** Each conf-app variant (lite, full, diagramly) serves the portal endpoints on its own backend domain. `forgeGlobal.zenumlRemoteBaseUrl` already resolves to the correct per-variant host, so removing `portalDomain.ts` and pointing callers at `zenumlRemoteBaseUrl` completes the frontend side. The KV data is unchanged — we reuse the same namespace IDs. The standalone `zenuml-portal` Worker stays live for 30 days as a fallback for old Forge bundles.

**Tech Stack:** Cloudflare Pages Functions (TypeScript), Vitest, wrangler TOML, Vue 3 / TypeScript frontend.

---

## File Map

**Create:**
- `functions/feature-flags.ts` — Pages Function serving `GET /feature-flags`
- `functions/ai-generate-title.ts` — Pages Function serving `POST /ai-generate-title`
- `tests/unit/feature-flags.spec.ts` — Vitest tests for the feature-flags handler
- `tests/unit/ai-generate-title.spec.ts` — Vitest tests for the ai-generate-title handler

**Modify:**
- `wrangler.toml` — add `KV_FEATURE_FLAGS` (stg) + `AI` binding
- `wrangler-dev.toml` — same
- `wrangler-stg.toml` — add `KV_FEATURE_FLAGS` (stg) + `AI` binding to production env
- `wrangler-prod.toml` — add `KV_FEATURE_FLAGS` (prod) + `AI` binding to production env
- `src/apis/featureFlags.ts` — replace `getPortalDomain()` with `forgeGlobal.zenumlRemoteBaseUrl`
- `src/apis/aiGenerateTitle.ts` — same replacement

**Delete:**
- `src/apis/portalDomain.ts`

---

## Task 1: Port `feature-flags` endpoint as a Pages Function

**Files:**
- Create: `functions/feature-flags.ts`

- [ ] **Step 1: Create the Pages Function**

Create `functions/feature-flags.ts` with this exact content (logic ported from `zenuml-portal/src/functions/featureFlags.ts`, framework wrapper changed from Hono to Pages Function):

```typescript
interface Env {
  KV_FEATURE_FLAGS: KVNamespace;
}

async function handleCustomerSuccessService(
  kvService: KVNamespace,
  clientDomainInQuery: string,
  result: Record<string, unknown>,
) {
  try {
    const customerSuccessService = await kvService.get('CUSTOMER_SUCCESS_SERVICE');
    if (!customerSuccessService) return;
    const customerSuccessServiceObj = JSON.parse(customerSuccessService);
    const ENABLED_DOMAINS = Object.keys(customerSuccessServiceObj);
    const client = ENABLED_DOMAINS.find((d) => d !== '' && clientDomainInQuery === d);
    if (client) {
      result.CUSTOMER_SUCCESS_SERVICE = customerSuccessServiceObj[client];
    }
  } catch (e) {
    console.error(e);
  }
}

async function handleLitePngExport(
  kvService: KVNamespace,
  client: string,
  result: Record<string, unknown>,
) {
  const litePngExportKeys = ['LITE_PNG_EXPORT_ENABLED', 'LITE_PNG_EXPORT_TRIAL', 'LITE_PNG_EXPORT_LOCKED'];
  for (const key of litePngExportKeys) {
    const raw = await kvService.get(key);
    const ENABLED_DOMAINS: string[] = raw?.split(',') || [];
    if (ENABLED_DOMAINS.some((d) => d !== '' && client === d)) {
      const flagType = key.split('_').pop();
      if (flagType) {
        result.LITE_PNG_EXPORT = { status: flagType };
        break;
      }
    }
  }
}

async function handleAiTitles(
  kvService: KVNamespace,
  client: string,
  result: Record<string, unknown>,
) {
  const raw = await kvService.get('AI_TITLE_ENABLED_DOMAINS');
  const ENABLED_DOMAINS: string[] = raw?.split(',') || [];
  result.AI_TITLE = { enabled: ENABLED_DOMAINS.some((d) => client.includes(d)) };
}

async function handlePersonaAwarePaywall(
  kvService: KVNamespace,
  client: string,
  result: Record<string, unknown>,
) {
  const raw = await kvService.get('PERSONA_AWARE_PAYWALL');
  const ENABLED_DOMAINS: string[] = raw?.split(',') || [];
  if (ENABLED_DOMAINS.some((d) => d !== '' && client === d)) {
    result.PERSONA_AWARE_PAYWALL = true;
  }
}

function handleTest(result: Record<string, unknown>) {
  result.TEST = { enabled: true, data: 'test data' };
}

export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  const url = new URL(request.url);
  const client = url.searchParams.get('client') || '';
  const featuresParam = url.searchParams.get('features') || '';
  const queryAll = url.searchParams.get('queryAll') === 'true';

  if (!client) return new Response('Invalid client field', { status: 400 });
  if (!featuresParam) return new Response('Invalid features field', { status: 400 });

  const features = featuresParam.split(',');
  const kvService = env.KV_FEATURE_FLAGS;
  const result: Record<string, unknown> = {};

  for (const feat of features) {
    if (queryAll || feat === 'CUSTOMER_SUCCESS_SERVICE') {
      await handleCustomerSuccessService(kvService, client, result);
    }
    if (queryAll || feat === 'LITE_PNG_EXPORT') {
      await handleLitePngExport(kvService, client, result);
    }
    if (queryAll || feat === 'AI_TITLE') {
      await handleAiTitles(kvService, client, result);
    }
    if (queryAll || feat === 'PERSONA_AWARE_PAYWALL') {
      await handlePersonaAwarePaywall(kvService, client, result);
    }
    if (queryAll || feat === 'TEST') {
      handleTest(result);
    }
  }

  return Response.json(result);
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/feature-flags.ts
git commit -m "feat(portal): add feature-flags Pages Function ported from zenuml-portal"
```

---

## Task 2: Write tests for `feature-flags.ts`

**Files:**
- Create: `tests/unit/feature-flags.spec.ts`

- [ ] **Step 1: Write the tests**

Create `tests/unit/feature-flags.spec.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { onRequestGet } from '../../functions/feature-flags';

function makeKV(store: Record<string, string>) {
  return {
    get: vi.fn().mockImplementation((key: string) => Promise.resolve(store[key] ?? null)),
  };
}

function makeCtx(params: Record<string, string>, kvStore: Record<string, string>) {
  const url = new URL('https://example.com/feature-flags');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return {
    request: new Request(url.toString()),
    env: { KV_FEATURE_FLAGS: makeKV(kvStore) },
  };
}

describe('feature-flags Pages Function', () => {
  it('returns 400 when client is missing', async () => {
    const url = new URL('https://example.com/feature-flags');
    url.searchParams.set('features', 'CUSTOMER_SUCCESS_SERVICE');
    const ctx = { request: new Request(url.toString()), env: { KV_FEATURE_FLAGS: makeKV({}) } };
    const res = await onRequestGet(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when features is missing', async () => {
    const url = new URL('https://example.com/feature-flags');
    url.searchParams.set('client', 'example.com');
    const ctx = { request: new Request(url.toString()), env: { KV_FEATURE_FLAGS: makeKV({}) } };
    const res = await onRequestGet(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns CUSTOMER_SUCCESS_SERVICE for matching domain', async () => {
    const ctx = makeCtx(
      { client: 'domain1', features: 'CUSTOMER_SUCCESS_SERVICE' },
      { CUSTOMER_SUCCESS_SERVICE: '{"domain1":{"popUpMessage":"Welcome!"}}' },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json();
    expect(body).toEqual({ CUSTOMER_SUCCESS_SERVICE: { popUpMessage: 'Welcome!' } });
  });

  it('returns empty object when client does not match CUSTOMER_SUCCESS_SERVICE', async () => {
    const ctx = makeCtx(
      { client: 'other.com', features: 'CUSTOMER_SUCCESS_SERVICE' },
      { CUSTOMER_SUCCESS_SERVICE: '{"domain1":{"popUpMessage":"Welcome!"}}' },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json();
    expect(body).toEqual({});
  });

  it('returns LITE_PNG_EXPORT ENABLED for matching domain', async () => {
    const ctx = makeCtx(
      { client: 'testClient', features: 'LITE_PNG_EXPORT' },
      { LITE_PNG_EXPORT_ENABLED: 'testClient' },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json();
    expect(body).toEqual({ LITE_PNG_EXPORT: { status: 'ENABLED' } });
  });

  it('returns LITE_PNG_EXPORT TRIAL for matching domain', async () => {
    const ctx = makeCtx(
      { client: 'testClient', features: 'LITE_PNG_EXPORT' },
      { LITE_PNG_EXPORT_TRIAL: 'testClient' },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json();
    expect(body).toEqual({ LITE_PNG_EXPORT: { status: 'TRIAL' } });
  });

  it('returns LITE_PNG_EXPORT LOCKED for matching domain', async () => {
    const ctx = makeCtx(
      { client: 'testClient', features: 'LITE_PNG_EXPORT' },
      { LITE_PNG_EXPORT_LOCKED: 'testClient' },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json();
    expect(body).toEqual({ LITE_PNG_EXPORT: { status: 'LOCKED' } });
  });

  it('returns LITE_PNG_EXPORT empty when client only partially matches (no substring match)', async () => {
    const ctx = makeCtx(
      { client: 'testClient', features: 'LITE_PNG_EXPORT' },
      { LITE_PNG_EXPORT_ENABLED: 'test' },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json();
    expect(body).toEqual({});
  });

  it('returns AI_TITLE enabled when client includes domain', async () => {
    const ctx = makeCtx(
      { client: 'testClient', features: 'AI_TITLE' },
      { AI_TITLE_ENABLED_DOMAINS: 'testClient' },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json();
    expect(body).toEqual({ AI_TITLE: { enabled: true } });
  });

  it('returns PERSONA_AWARE_PAYWALL true for matching domain', async () => {
    const ctx = makeCtx(
      { client: 'domain1', features: 'PERSONA_AWARE_PAYWALL' },
      { PERSONA_AWARE_PAYWALL: 'domain1,domain2' },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json();
    expect(body).toEqual({ PERSONA_AWARE_PAYWALL: true });
  });

  it('returns TEST flag always', async () => {
    const ctx = makeCtx({ client: 'any', features: 'TEST' }, {});
    const res = await onRequestGet(ctx as any);
    const body = await res.json();
    expect(body).toEqual({ TEST: { enabled: true, data: 'test data' } });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm test:unit tests/unit/feature-flags.spec.ts
```

Expected: all 11 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/feature-flags.spec.ts
git commit -m "test(portal): Vitest tests for feature-flags Pages Function"
```

---

## Task 3: Port `ai-generate-title` endpoint as a Pages Function

**Files:**
- Create: `functions/ai-generate-title.ts`

- [ ] **Step 1: Create the Pages Function**

Create `functions/ai-generate-title.ts`:

```typescript
interface Env {
  AI: Ai;
}

type Strategy = (ai: Ai, dsl: string, type?: string) => Promise<string>;

const strategies: Strategy[] = [
  async (ai, dsl, type) => {
    const result = await (ai as any).run('@cf/meta/llama-2-7b-chat-int8', {
      messages: [
        {
          role: 'system',
          content: `You will help the user to create a title for an ${type || 'UML'} diagram, the user will give a DSL that describing an ${type || 'UML'} diagram, you should just give out one title describing the whole UML and enclose it with triple quotes (like: """example title""").`,
        },
        { role: 'user', content: dsl },
      ],
    });
    const matchResult = (result as any).response.match(/"""(.*)"""/is);
    const title = matchResult?.[1];
    if (!title) throw new Error('Failed to extract title');
    return title;
  },
  async (ai, dsl) => {
    const result = await (ai as any).run('@cf/meta/llama-2-7b-chat-int8', {
      messages: [
        {
          role: 'system',
          content: 'You are an expert of ZenUML sequence diagram. Generate title for the given DSL. Only output the title, nothing else.',
        },
        { role: 'user', content: dsl },
      ],
    });
    const matchResult = (result as any).response.match(/[^"]+title[^"]+"([^"]+)"/is);
    const title = matchResult?.[1];
    if (!title) throw new Error('Failed to extract title');
    return title;
  },
];

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  let body: { dsl?: string; type?: string };
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  if (typeof body?.dsl !== 'string') return new Response("Invalid 'dsl' field", { status: 400 });
  if (body.type && typeof body.type !== 'string') return new Response("Invalid 'type' field", { status: 400 });

  const { dsl, type } = body;
  let title = '';
  let lastError = '';

  for (const strategy of strategies) {
    try {
      title = await strategy(env.AI, dsl, type);
      if (title) break;
    } catch (err) {
      lastError = String(err);
    }
  }

  if (!title) return new Response(lastError || 'Failed to generate title', { status: 500 });
  return new Response(title);
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/ai-generate-title.ts
git commit -m "feat(portal): add ai-generate-title Pages Function ported from zenuml-portal"
```

---

## Task 4: Write tests for `ai-generate-title.ts`

**Files:**
- Create: `tests/unit/ai-generate-title.spec.ts`

- [ ] **Step 1: Write the tests**

Create `tests/unit/ai-generate-title.spec.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { onRequestPost } from '../../functions/ai-generate-title';

function makeCtx(body: unknown, aiResponse: string | null = null) {
  const aiRun = vi.fn().mockResolvedValue({ response: aiResponse ?? '' });
  return {
    request: new Request('https://example.com/ai-generate-title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env: { AI: { run: aiRun } },
  };
}

describe('ai-generate-title Pages Function', () => {
  it('returns 400 when dsl is missing', async () => {
    const ctx = makeCtx({ type: 'UML' });
    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const ctx = {
      request: new Request('https://example.com/ai-generate-title', {
        method: 'POST',
        body: 'not json',
      }),
      env: { AI: { run: vi.fn() } },
    };
    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('extracts title enclosed in triple quotes from first strategy', async () => {
    const ctx = makeCtx({ dsl: 'A -> B: hello' }, '"""My Diagram Title"""');
    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('My Diagram Title');
  });

  it('returns 500 when both strategies fail to extract a title', async () => {
    const ctx = makeCtx({ dsl: 'A -> B: hello' }, 'no title here');
    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm test:unit tests/unit/ai-generate-title.spec.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/ai-generate-title.spec.ts
git commit -m "test(portal): Vitest tests for ai-generate-title Pages Function"
```

---

## Task 5: Add KV and AI bindings to all wrangler configs

**Files:**
- Modify: `wrangler.toml`
- Modify: `wrangler-dev.toml`
- Modify: `wrangler-stg.toml`
- Modify: `wrangler-prod.toml`

- [ ] **Step 1: Add bindings to `wrangler.toml`**

Append to the end of `wrangler.toml`:

```toml
# Portal feature flags KV (shared with zenuml-portal staging)
[[kv_namespaces]]
binding = "KV_FEATURE_FLAGS"
id = "fd87eed34f864190880a4b44d25c0e91"

[[env.production.kv_namespaces]]
binding = "KV_FEATURE_FLAGS"
id = "fe9042cb20994651b0a2ef9e68f9037c"

[ai]
binding = "AI"
```

- [ ] **Step 2: Add bindings to `wrangler-dev.toml`**

Append the same block to the end of `wrangler-dev.toml`:

```toml
# Portal feature flags KV (shared with zenuml-portal staging)
[[kv_namespaces]]
binding = "KV_FEATURE_FLAGS"
id = "fd87eed34f864190880a4b44d25c0e91"

[[env.production.kv_namespaces]]
binding = "KV_FEATURE_FLAGS"
id = "fe9042cb20994651b0a2ef9e68f9037c"

[ai]
binding = "AI"
```

- [ ] **Step 3: Add bindings to `wrangler-stg.toml`**

Append to the end of `wrangler-stg.toml`:

```toml
# Portal feature flags KV (shared with zenuml-portal staging)
[[kv_namespaces]]
binding = "KV_FEATURE_FLAGS"
id = "fd87eed34f864190880a4b44d25c0e91"

[[env.production.kv_namespaces]]
binding = "KV_FEATURE_FLAGS"
id = "fd87eed34f864190880a4b44d25c0e91"

[ai]
binding = "AI"
```

Note: stg uses the staging KV (`fd87...`) for both default and production env — no prod data in staging.

- [ ] **Step 4: Add bindings to `wrangler-prod.toml`**

Append to the end of `wrangler-prod.toml`:

```toml
# Portal feature flags KV (production)
[[env.production.kv_namespaces]]
binding = "KV_FEATURE_FLAGS"
id = "fe9042cb20994651b0a2ef9e68f9037c"

[ai]
binding = "AI"
```

- [ ] **Step 5: Commit**

```bash
git add wrangler.toml wrangler-dev.toml wrangler-stg.toml wrangler-prod.toml
git commit -m "config: bind KV_FEATURE_FLAGS and AI to all conf-app wrangler configs"
```

---

## Task 6: Update frontend callers and delete `portalDomain.ts`

**Files:**
- Modify: `src/apis/featureFlags.ts`
- Modify: `src/apis/aiGenerateTitle.ts`
- Delete: `src/apis/portalDomain.ts`

- [ ] **Step 1: Update `src/apis/featureFlags.ts`**

Replace the file content with:

```typescript
import { trackEvent, serializeError } from "@/utils/window";
import { getClientDomain } from "@/utils/ContextParameters/ContextParameters";
import forgeGlobal from "@/model/globals/forgeGlobal";

export default async function (features: string[]) {
  const client = getClientDomain();
  const featuresParam = features.join(",");

  trackEvent(`${client || 'empty'}|${featuresParam}`, 'get_feature_flags_attempt', 'info');

  if (!client) {
    trackEvent('empty_client_domain', 'get_feature_flags', 'error');
    return {};
  }

  try {
    const baseUrl = forgeGlobal.zenumlRemoteBaseUrl;
    const response = await fetch(
      `${baseUrl}/feature-flags?client=${client}&features=${featuresParam}`
    );

    if (!response.ok) {
      console.error("HTTP Error:", response.status, response.statusText);
      trackEvent(response.statusText, 'get_feature_flags', 'error');
      return {};
    }

    const data = await response.json();
    console.debug("featureFlags", client, features, data);
    return data;
  } catch (error) {
    console.error("Fetching feature flags failed:", error);
    trackEvent(serializeError(error), 'get_feature_flags', 'error');
    return {};
  }
}
```

- [ ] **Step 2: Update `src/apis/aiGenerateTitle.ts`**

Replace the file content with:

```typescript
import forgeGlobal from "@/model/globals/forgeGlobal";

export default async function (body: { dsl: string; type?: string }) {
  return fetch(`${forgeGlobal.zenumlRemoteBaseUrl}/ai-generate-title`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 3: Delete `src/apis/portalDomain.ts`**

```bash
rm src/apis/portalDomain.ts
```

- [ ] **Step 4: Run unit tests to confirm no broken imports**

```bash
pnpm test:unit
```

Expected: all existing tests PASS. If any test imports `portalDomain`, update it to mock `forgeGlobal.zenumlRemoteBaseUrl` instead.

- [ ] **Step 5: Commit**

```bash
git add src/apis/featureFlags.ts src/apis/aiGenerateTitle.ts
git rm src/apis/portalDomain.ts
git commit -m "refactor(portal): replace portalDomain with forgeGlobal.zenumlRemoteBaseUrl"
```

---

## Task 7: Verify CORS coverage in middleware

**Files:**
- Read: `functions/_middleware.ts`

- [ ] **Step 1: Confirm new endpoints are not blocked**

The `_middleware.ts` only applies authentication to paths matching `AUTHENTICATED_PATHS = ['/diagramly', '/metrics-cache', '/forge-custom-content']`. The new paths `/feature-flags` and `/ai-generate-title` are not in this list, so they pass through unauthenticated — which matches the original zenuml-portal behaviour (public, CORS-open endpoints).

Verify the existing middleware allows cross-origin requests on these paths by checking `functions/_middleware.ts`. If it adds CORS headers globally, no change needed. If it does not, add CORS headers in the two new functions:

In `functions/feature-flags.ts` and `functions/ai-generate-title.ts`, add at the top of the handler:

```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
```

And return `Response.json(result, { headers: corsHeaders })` / `new Response(title, { headers: corsHeaders })`.

Check `functions/api/features.ts` to see the pattern already in use for reference:

```bash
cat functions/api/features.ts
```

- [ ] **Step 2: Add CORS headers if needed and commit**

If CORS headers were added:

```bash
git add functions/feature-flags.ts functions/ai-generate-title.ts
git commit -m "fix(portal): add CORS headers to feature-flags and ai-generate-title endpoints"
```

If no change was needed, skip this step.

---

## Task 8: Build and smoke test on staging

- [ ] **Step 1: Build the lite variant**

```bash
pnpm build:lite
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 2: Deploy to staging**

Follow the existing deploy process for staging (CI or manual wrangler deploy with `wrangler-stg.toml`). Refer to the `/deploy-stg` skill or CI workflow.

- [ ] **Step 3: Smoke test feature-flags endpoint**

Once deployed, test the endpoint directly:

```bash
curl "https://conf-lite-stg.zenuml.com/feature-flags?client=example.atlassian.net&features=PERSONA_AWARE_PAYWALL,CUSTOMER_SUCCESS_SERVICE"
```

Expected response shape: `{}` or `{"PERSONA_AWARE_PAYWALL": true}` — valid JSON object, HTTP 200.

Also verify the old portal endpoint still works (it must during soak period):

```bash
curl "https://portal-stg.zenuml.com/feature-flags?client=example.atlassian.net&features=PERSONA_AWARE_PAYWALL"
```

Expected: same shape.

- [ ] **Step 4: Smoke test ai-generate-title endpoint**

```bash
curl -X POST "https://conf-lite-stg.zenuml.com/ai-generate-title" \
  -H "Content-Type: application/json" \
  -d '{"dsl":"A->B:hello","type":"ZenUML"}'
```

Expected: HTTP 200 with a plain-text title string, or HTTP 500 if the AI model is unavailable (acceptable — same behaviour as the original Worker).

---

## Task 9: Open PR and start 30-day soak period

- [ ] **Step 1: Push branch and open PR**

Use the `/submit-branch` skill or:

```bash
git push origin HEAD
gh pr create --title "feat(portal): merge zenuml-portal endpoints into conf-app" \
  --body "Ports /feature-flags and /ai-generate-title from the standalone zenuml-portal Worker into conf-app Pages Functions. Each variant serves these endpoints on its own backend domain. portalDomain.ts deleted. See docs/superpowers/specs/2026-04-27-merge-zenuml-portal-design.md for full design."
```

- [ ] **Step 2: Note decommission date**

The standalone `zenuml-portal` Worker stays live until **2026-05-27** (30 days after merge). Add a note in the PR description or a CHANGELOG entry so it doesn't get forgotten.

- [ ] **Step 3: Schedule decommission agent (optional)**

Use `/schedule` to create a one-time agent in 30 days to open a decommission PR that deletes `zenuml-portal-staging`, `zenuml-portal-production`, removes DNS records, and archives the repo.

---

## Success Criteria Checklist

- [ ] `pnpm test:unit` passes with all new and existing tests
- [ ] `pnpm build:lite` succeeds
- [ ] `GET /feature-flags` returns correct JSON on staging
- [ ] `POST /ai-generate-title` returns 200 on staging
- [ ] `src/apis/portalDomain.ts` no longer exists
- [ ] No import of `portalDomain` remains in the codebase (`grep -r portalDomain src/` returns nothing)
- [ ] `portal.zenuml.com` Worker still live (not touched until 2026-05-27)
