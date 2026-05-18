# Diagramly Demo Pages — Plumbing Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-18-diagramly-demo-pages-design.md`

**Goal:** Ship a manual admin button that creates a hardcoded demo page in a Confluence space via a Forge resolver running `asApp`, scoped to the diagramly build only, end-to-end tunnel-verified on `dia-dev.atlassian.net`.

**Architecture:** Single Forge resolver (`src/createDemoPage.ts`) does admin-check + spaceKey→spaceId resolution + idempotency (Forge KV marker) + `asApp` POST `/wiki/api/v2/pages` + structured log. Custom UI Vue page (`src/components/Admin/CreateDemoPage.vue`) mounted via `confluence:globalSettings` manifest module calls it via `@forge/bridge`'s `invoke()`. CI `yq` strip keeps the entry in diagramly builds and removes it from lite/full builds. No Cloudflare Worker code added.

**Tech Stack:** Forge (`@forge/api`, `@forge/bridge`), TypeScript, Vue 3 Composition API, Vitest, GitHub Actions / `yq`.

---

## File structure

**New files:**
- `src/createDemoPage.ts` — Forge resolver handler (admin check → space resolve → idempotency → POST → marker → log)
- `src/demoPageContent.ts` — exported ADF body constant + canonical title constant
- `src/components/Admin/CreateDemoPage.vue` — admin form: spaceKey input + submit button + result/error display
- `src/routes/createDemoPage.ts` — route handler that mounts the Vue component (mirrors `src/routes/getStarted.ts`)
- `tests/unit/demoPageContent.spec.ts` — ADF JSON validity, canonical title, four macro keys match manifest
- `tests/unit/createDemoPage.spec.ts` — behavior tests for the resolver

**Modified files:**
- `manifest.yml` — add `confluence:globalSettings` entry + `function:` entry
- `src/forgeIndex.ts` — branch on `extension.key` inside the `confluence:globalSettings` route block
- `.github/workflows/staging-deploy.yml` — replace type-wide `yq` strip with key-specific deletions
- `.github/workflows/release.yml` — same key-specific changes
- `.github/pull_request_template.md` (or equivalent) — add macro-rendering + admin-group validation checklist items

---

## Task 1: Demo page ADF content constant

**Files:**
- Create: `src/demoPageContent.ts`
- Create: `tests/unit/demoPageContent.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/demoPageContent.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEMO_PAGE_TITLE, DEMO_PAGE_ADF, MACRO_KEYS } from '../../src/demoPageContent';

describe('demoPageContent', () => {
  it('exports the canonical title', () => {
    expect(DEMO_PAGE_TITLE).toBe('Welcome to Diagramly — Try it out');
  });

  it('exports an ADF body whose top type is doc', () => {
    expect(DEMO_PAGE_ADF.type).toBe('doc');
    expect(DEMO_PAGE_ADF.version).toBe(1);
    expect(Array.isArray(DEMO_PAGE_ADF.content)).toBe(true);
  });

  it('parses cleanly when round-tripped through JSON', () => {
    const roundTrip = JSON.parse(JSON.stringify(DEMO_PAGE_ADF));
    expect(roundTrip).toEqual(DEMO_PAGE_ADF);
  });

  it('references all four macro keys', () => {
    const serialized = JSON.stringify(DEMO_PAGE_ADF);
    for (const key of MACRO_KEYS) {
      expect(serialized).toContain(key);
    }
  });

  it('macro keys match the diagramly-build manifest', () => {
    // The diagramly build is the lite-variant manifest with LITE_KEY_SUFFIX=''
    // and SEQUENCE_MACRO_KEY='gpt-diagram-macro' (see package.json forge:deploy:diagramly:*).
    // For the diagramly build the four extension keys are:
    expect(MACRO_KEYS).toEqual([
      'gpt-diagram-macro',         // ZenUML / Mermaid / PlantUML host macro
      'zenuml-graph-macro',        // DrawIO graph
      'zenuml-openapi-macro',      // OpenAPI / Swagger
      'zenuml-embed-macro',        // Embed
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- demoPageContent`
Expected: FAIL with "Cannot find module '../../src/demoPageContent'".

- [ ] **Step 3: Implement `src/demoPageContent.ts`**

```ts
export const DEMO_PAGE_TITLE = 'Welcome to Diagramly — Try it out';

export const MACRO_KEYS = [
  'gpt-diagram-macro',
  'zenuml-graph-macro',
  'zenuml-openapi-macro',
  'zenuml-embed-macro',
] as const;

const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

const heading = (level: 1 | 2, text: string) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});

const extension = (
  extensionKey: string,
  bodyType: 'sequence' | 'mermaid' | 'graph' | 'openapi' | 'embed',
  body: string,
) => ({
  type: 'extension',
  attrs: {
    extensionType: 'com.atlassian.confluence.macro.core',
    extensionKey,
    parameters: {
      macroParams: {
        bodyType: { value: bodyType },
      },
      macroMetadata: {
        title: extensionKey,
      },
    },
    text: body,
  },
});

const SEQUENCE_BODY = `A.method() {
  B.process()
  return result
}`;

const MERMAID_BODY = `flowchart LR
  Idea --> Draft
  Draft --> Review
  Review --> Ship`;

const GRAPH_BODY = `<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0" /><mxCell id="1" parent="0" />
  <mxCell id="2" value="Start" style="rounded=1" vertex="1" parent="1">
    <mxGeometry x="40" y="40" width="120" height="40" as="geometry"/>
  </mxCell>
</root></mxGraphModel></diagram></mxfile>`;

const OPENAPI_BODY = `openapi: 3.0.0
info:
  title: Demo API
  version: 0.1.0
paths:
  /hello:
    get:
      summary: Returns a greeting
      responses:
        '200':
          description: OK`;

export const DEMO_PAGE_ADF = {
  type: 'doc',
  version: 1,
  content: [
    heading(1, 'Welcome 👋'),
    paragraph(
      'This page was created by Diagramly so you can try the four diagram types we support. Edit any macro to play with the source.',
    ),

    heading(2, 'Sequence diagram (ZenUML)'),
    paragraph('Describe how components or actors talk to each other.'),
    extension('gpt-diagram-macro', 'sequence', SEQUENCE_BODY),
    paragraph('Tip: click ✨ Aide on this page to improve any diagram with AI.'),

    heading(2, 'Flowchart (Mermaid)'),
    paragraph('Map a process top-to-bottom or left-to-right.'),
    extension('gpt-diagram-macro', 'mermaid', MERMAID_BODY),

    heading(2, 'Graph (DrawIO)'),
    paragraph('Free-form diagrams powered by DrawIO.'),
    extension('zenuml-graph-macro', 'graph', GRAPH_BODY),

    heading(2, 'OpenAPI / Swagger'),
    paragraph('Render an API spec inline.'),
    extension('zenuml-openapi-macro', 'openapi', OPENAPI_BODY),

    heading(2, 'Not for you?'),
    paragraph('Delete this page if you would rather not see it — Diagramly will not recreate it.'),
  ],
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- demoPageContent`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/demoPageContent.ts tests/unit/demoPageContent.spec.ts
git commit -m "feat(diagramly): add demo page ADF content + unit tests"
```

---

## Task 2: createDemoPage resolver — admin authorization check (TDD)

**Files:**
- Create: `src/createDemoPage.ts`
- Create: `tests/unit/createDemoPage.spec.ts`

This is the first vertical slice of the resolver. We only implement the admin check and a 403 short-circuit. Later tasks add the other steps.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/createDemoPage.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { asAppRequest, asUserRequest, storageGet, storageSet } = vi.hoisted(() => ({
  asAppRequest: vi.fn(),
  asUserRequest: vi.fn(),
  storageGet: vi.fn(),
  storageSet: vi.fn(),
}));

vi.mock('@forge/api', () => ({
  default: {
    asUser: () => ({ requestConfluence: asUserRequest }),
    asApp: () => ({ requestConfluence: asAppRequest }),
  },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + String(values[i] ?? ''), ''),
  storage: { get: storageGet, set: storageSet },
}));

import { handler } from '../../src/createDemoPage';

function makeResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function callHandler(payload: { spaceKey: string }, accountId = 'user-1') {
  return handler({ payload, context: { accountId, cloudId: 'cloud-1' } } as any);
}

describe('createDemoPage — authorization', () => {
  beforeEach(() => {
    asUserRequest.mockReset();
    asAppRequest.mockReset();
    storageGet.mockReset();
    storageSet.mockReset();
  });

  it('rejects with 403 when the user is in no admin group', async () => {
    asUserRequest.mockResolvedValueOnce(
      makeResponse({ results: [{ name: 'confluence-users' }] }),
    );

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(result).toEqual({ ok: false, status: 403, error: 'not_authorized' });
    expect(asAppRequest).not.toHaveBeenCalled();
    expect(storageGet).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the memberof request itself fails', async () => {
    asUserRequest.mockResolvedValueOnce(makeResponse({}, 500));

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(result).toEqual({ ok: false, status: 403, error: 'not_authorized' });
    expect(asAppRequest).not.toHaveBeenCalled();
  });

  it('accepts site-admins group membership', async () => {
    asUserRequest.mockResolvedValueOnce(
      makeResponse({ results: [{ name: 'site-admins' }] }),
    );
    // The handler will short-circuit later in this task because nothing else
    // is implemented; we only assert that the admin check did NOT reject.
    storageGet.mockResolvedValueOnce(undefined);

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(result).not.toMatchObject({ status: 403 });
  });

  it('accepts confluence-admins-<site> regex-style group membership', async () => {
    asUserRequest.mockResolvedValueOnce(
      makeResponse({ results: [{ name: 'confluence-admins-acme' }] }),
    );
    storageGet.mockResolvedValueOnce(undefined);

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(result).not.toMatchObject({ status: 403 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- createDemoPage`
Expected: FAIL with "Cannot find module '../../src/createDemoPage'".

- [ ] **Step 3: Implement the minimal handler**

Create `src/createDemoPage.ts`:

```ts
import api, { route, storage } from '@forge/api';

type Payload = { spaceKey: string };
type Context = { accountId: string; cloudId: string };

const ADMIN_GROUP_RE = /^(site-admins|confluence-admins(-.+)?)$/;

async function isCallerSiteAdmin(accountId: string): Promise<boolean> {
  try {
    const res = await api
      .asUser()
      .requestConfluence(
        route`/wiki/rest/api/user/memberof?accountId=${accountId}&start=0&limit=200`,
      );
    if (!res.ok) return false;
    const body = (await res.json()) as { results?: Array<{ name?: string }> };
    const groups = body?.results ?? [];
    return groups.some(g => typeof g?.name === 'string' && ADMIN_GROUP_RE.test(g.name));
  } catch {
    return false;
  }
}

export const handler = async ({
  payload,
  context,
}: {
  payload: Payload;
  context: Context;
}) => {
  if (!(await isCallerSiteAdmin(context.accountId))) {
    return { ok: false, status: 403, error: 'not_authorized' };
  }

  // Subsequent tasks add: space resolve, idempotency, POST, marker write, log.
  return { ok: false, status: 501, error: 'not_implemented' };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- createDemoPage`
Expected: 4 tests pass. The two "accepts" tests pass because we assert "not 403", not "not_implemented" specifically.

- [ ] **Step 5: Commit**

```bash
git add src/createDemoPage.ts tests/unit/createDemoPage.spec.ts
git commit -m "feat(diagramly): add createDemoPage resolver admin check (TDD)"
```

---

## Task 3: createDemoPage resolver — spaceKey→spaceId resolution (TDD)

**Files:**
- Modify: `src/createDemoPage.ts`
- Modify: `tests/unit/createDemoPage.spec.ts`

- [ ] **Step 1: Add failing tests for space resolution**

Append the following `describe` block at the end of `tests/unit/createDemoPage.spec.ts`:

```ts
describe('createDemoPage — space resolution', () => {
  beforeEach(() => {
    asUserRequest.mockReset();
    asAppRequest.mockReset();
    storageGet.mockReset();
    storageSet.mockReset();
    // All space-resolution tests run as an admin.
    asUserRequest.mockImplementation((url: string) => {
      if (url.includes('/wiki/rest/api/user/memberof')) {
        return Promise.resolve(makeResponse({ results: [{ name: 'site-admins' }] }));
      }
      return Promise.resolve(makeResponse({ results: [] }, 500));
    });
  });

  it('returns 404 when the space key resolves to zero spaces', async () => {
    asUserRequest.mockImplementationOnce(() =>
      Promise.resolve(makeResponse({ results: [{ name: 'site-admins' }] })),
    );
    asUserRequest.mockImplementationOnce(() =>
      Promise.resolve(makeResponse({ results: [] })),
    );

    const result = await callHandler({ spaceKey: 'NOPE' });
    expect(result).toMatchObject({ ok: false, status: 404, error: 'space_not_found' });
  });

  it('returns 400 when the resolved space is archived or non-global', async () => {
    asUserRequest.mockImplementationOnce(() =>
      Promise.resolve(makeResponse({ results: [{ name: 'site-admins' }] })),
    );
    asUserRequest.mockImplementationOnce(() =>
      Promise.resolve(
        makeResponse({
          results: [{ id: '111', key: 'OLD', type: 'global', status: 'archived' }],
        }),
      ),
    );

    const result = await callHandler({ spaceKey: 'OLD' });
    expect(result).toMatchObject({ ok: false, status: 400, error: 'space_not_eligible' });
  });

  it('calls /wiki/api/v2/spaces?keys=<spaceKey> with the supplied key', async () => {
    asUserRequest.mockImplementationOnce(() =>
      Promise.resolve(makeResponse({ results: [{ name: 'site-admins' }] })),
    );
    asUserRequest.mockImplementationOnce(() =>
      Promise.resolve(
        makeResponse({
          results: [{ id: '222', key: 'DEMO', type: 'global', status: 'current' }],
        }),
      ),
    );
    storageGet.mockResolvedValueOnce(undefined);

    await callHandler({ spaceKey: 'DEMO' });

    const urls = asUserRequest.mock.calls.map(c => c[0] as string);
    expect(urls[1]).toContain('/wiki/api/v2/spaces');
    expect(urls[1]).toContain('keys=DEMO');
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm test:unit -- createDemoPage`
Expected: the 3 new tests fail (handler returns `501 not_implemented` instead of the expected 404/400/200).

- [ ] **Step 3: Implement space resolution**

Edit `src/createDemoPage.ts`. Add the helper above `handler` and call it inside:

```ts
type ResolvedSpace = { id: string; key: string };
type SpaceResolutionResult =
  | { ok: true; space: ResolvedSpace }
  | { ok: false; status: 404 | 400 | 500; error: string };

async function resolveSpace(spaceKey: string): Promise<SpaceResolutionResult> {
  try {
    const res = await api
      .asUser()
      .requestConfluence(route`/wiki/api/v2/spaces?keys=${spaceKey}`);
    if (!res.ok) return { ok: false, status: 500, error: 'space_lookup_failed' };
    const body = (await res.json()) as {
      results?: Array<{ id: string; key: string; type?: string; status?: string }>;
    };
    const hit = body.results?.[0];
    if (!hit) return { ok: false, status: 404, error: 'space_not_found' };
    if (hit.type !== 'global' || hit.status !== 'current') {
      return { ok: false, status: 400, error: 'space_not_eligible' };
    }
    return { ok: true, space: { id: hit.id, key: hit.key } };
  } catch {
    return { ok: false, status: 500, error: 'space_lookup_failed' };
  }
}
```

And inside `handler`, after the admin check, before the `501` return:

```ts
  const resolved = await resolveSpace(payload.spaceKey);
  if (!resolved.ok) {
    return { ok: false, status: resolved.status, error: resolved.error };
  }
  const { space } = resolved;

  // Subsequent tasks add: idempotency, POST, marker write, log.
  return { ok: false, status: 501, error: 'not_implemented', spaceId: space.id };
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `pnpm test:unit -- createDemoPage`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/createDemoPage.ts tests/unit/createDemoPage.spec.ts
git commit -m "feat(diagramly): add createDemoPage space resolution (TDD)"
```

---

## Task 4: createDemoPage resolver — idempotency marker (TDD)

**Files:**
- Modify: `src/createDemoPage.ts`
- Modify: `tests/unit/createDemoPage.spec.ts`

- [ ] **Step 1: Add failing idempotency tests**

Append at the end of `tests/unit/createDemoPage.spec.ts`:

```ts
describe('createDemoPage — idempotency', () => {
  beforeEach(() => {
    asUserRequest.mockReset();
    asAppRequest.mockReset();
    storageGet.mockReset();
    storageSet.mockReset();

    asUserRequest.mockImplementation((url: string) => {
      if (url.includes('/wiki/rest/api/user/memberof')) {
        return Promise.resolve(makeResponse({ results: [{ name: 'site-admins' }] }));
      }
      if (url.includes('/wiki/api/v2/spaces')) {
        return Promise.resolve(
          makeResponse({
            results: [{ id: '222', key: 'DEMO', type: 'global', status: 'current' }],
          }),
        );
      }
      return Promise.resolve(makeResponse({}, 500));
    });
  });

  it('returns the stored marker without POSTing when marker is present', async () => {
    storageGet.mockResolvedValueOnce({
      pageId: '999',
      createdAt: '2026-05-18T00:00:00.000Z',
      source: 'manual',
    });

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(result).toMatchObject({
      ok: true,
      alreadyExists: true,
      pageId: '999',
    });
    expect(asAppRequest).not.toHaveBeenCalled();
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('looks up the marker under the per-space key', async () => {
    storageGet.mockResolvedValueOnce({
      pageId: '999',
      createdAt: '2026-05-18T00:00:00.000Z',
      source: 'manual',
    });

    await callHandler({ spaceKey: 'DEMO' });

    expect(storageGet).toHaveBeenCalledWith('demo-page:DEMO');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- createDemoPage`
Expected: 2 new tests fail (handler still returns 501).

- [ ] **Step 3: Implement idempotency check**

Edit `src/createDemoPage.ts`. After the space-resolution block in `handler`, before the `501` return, insert:

```ts
  const markerKey = `demo-page:${space.key}`;
  const existing = (await storage.get(markerKey)) as
    | { pageId: string; createdAt: string; source: 'manual' }
    | undefined;
  if (existing) {
    return { ok: true, alreadyExists: true, pageId: existing.pageId, createdAt: existing.createdAt };
  }
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit -- createDemoPage`
Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/createDemoPage.ts tests/unit/createDemoPage.spec.ts
git commit -m "feat(diagramly): add createDemoPage idempotency marker (TDD)"
```

---

## Task 5: createDemoPage resolver — POST + marker write + structured log (TDD)

**Files:**
- Modify: `src/createDemoPage.ts`
- Modify: `tests/unit/createDemoPage.spec.ts`

- [ ] **Step 1: Add failing tests for the create flow**

Append at the end of `tests/unit/createDemoPage.spec.ts`:

```ts
describe('createDemoPage — page creation', () => {
  beforeEach(() => {
    asUserRequest.mockReset();
    asAppRequest.mockReset();
    storageGet.mockReset();
    storageSet.mockReset();

    asUserRequest.mockImplementation((url: string) => {
      if (url.includes('/wiki/rest/api/user/memberof')) {
        return Promise.resolve(makeResponse({ results: [{ name: 'site-admins' }] }));
      }
      if (url.includes('/wiki/api/v2/spaces')) {
        return Promise.resolve(
          makeResponse({
            results: [{ id: '222', key: 'DEMO', type: 'global', status: 'current' }],
          }),
        );
      }
      return Promise.resolve(makeResponse({}, 500));
    });

    storageGet.mockResolvedValue(undefined);
  });

  it('POSTs to /wiki/api/v2/pages with the resolved spaceId, canonical title, and ADF body', async () => {
    asAppRequest.mockResolvedValueOnce(makeResponse({ id: '5001' }, 200));

    await callHandler({ spaceKey: 'DEMO' });

    expect(asAppRequest).toHaveBeenCalledTimes(1);
    const [url, init] = asAppRequest.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/wiki/api/v2/pages');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body.spaceId).toBe('222');
    expect(body.status).toBe('current');
    expect(body.title).toBe('Welcome to Diagramly — Try it out');
    expect(body.body.representation).toBe('atlas_doc_format');
    expect(typeof body.body.value).toBe('string');
    const adf = JSON.parse(body.body.value);
    expect(adf.type).toBe('doc');
  });

  it('writes the marker on a successful create', async () => {
    asAppRequest.mockResolvedValueOnce(makeResponse({ id: '5001' }));

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(storageSet).toHaveBeenCalledWith(
      'demo-page:DEMO',
      expect.objectContaining({ pageId: '5001', source: 'manual' }),
    );
    expect(result).toMatchObject({ ok: true, pageId: '5001' });
  });

  it('does NOT write the marker when the create POST fails', async () => {
    asAppRequest.mockResolvedValueOnce(makeResponse({ message: 'rate limited' }, 429));

    const result = await callHandler({ spaceKey: 'DEMO' });

    expect(storageSet).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, status: 429 });
  });

  it('emits a structured success log line', async () => {
    asAppRequest.mockResolvedValueOnce(makeResponse({ id: '5001' }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await callHandler({ spaceKey: 'DEMO' });

    const logged = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged).toContain('"event":"demo_page_created"');
    expect(logged).toContain('"spaceKey":"DEMO"');
    expect(logged).toContain('"pageId":"5001"');
    expect(logged).toContain('"source":"manual"');
    expect(logged).toContain('"cloudId":"cloud-1"');

    logSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- createDemoPage`
Expected: 4 new tests fail.

- [ ] **Step 3: Implement the create flow**

Edit `src/createDemoPage.ts`. At the top, add the content import:

```ts
import { DEMO_PAGE_ADF, DEMO_PAGE_TITLE } from './demoPageContent';
```

Replace the trailing `501 not_implemented` block at the end of `handler` with:

```ts
  const res = await api.asApp().requestConfluence(route`/wiki/api/v2/pages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      spaceId: space.id,
      status: 'current',
      title: DEMO_PAGE_TITLE,
      body: {
        representation: 'atlas_doc_format',
        value: JSON.stringify(DEMO_PAGE_ADF),
      },
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    return { ok: false, status: res.status, error: 'create_failed', detail };
  }

  const created = (await res.json()) as { id: string };
  const createdAt = new Date().toISOString();
  await storage.set(markerKey, { pageId: created.id, createdAt, source: 'manual' });

  console.log(
    JSON.stringify({
      event: 'demo_page_created',
      cloudId: context.cloudId,
      spaceKey: space.key,
      pageId: created.id,
      source: 'manual',
      createdAt,
    }),
  );

  return { ok: true, pageId: created.id, createdAt };
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit -- createDemoPage`
Expected: 13 tests pass total. Re-run `pnpm test:unit` for the full suite to confirm no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/createDemoPage.ts tests/unit/createDemoPage.spec.ts
git commit -m "feat(diagramly): complete createDemoPage POST + marker + log (TDD)"
```

---

## Task 6: Manifest entries — globalSettings + function

**Files:**
- Modify: `manifest.yml`

The `confluence:globalSettings` section already contains `zenuml-get-started-settings` (ZenUML-only). The `function:` section already contains `exportMacro` and `pageCaptureFn`. We add one entry to each.

- [ ] **Step 1: Add the `confluence:globalSettings` entry**

In `manifest.yml`, locate the existing `confluence:globalSettings` block:

```yaml
  confluence:globalSettings: #Note: This module is applicable for "ZenUML for Confluence", not "Diagramly for Confluence"
    - key: zenuml-get-started-settings
      title: Get Started
      resource: main
      useAsGetStarted: true
```

Add a new entry below it:

```yaml
    - key: diagramly-admin-create-demo-page
      title: "Diagramly Admin — Create demo page"
      resource: main
      route: zenuml-admin-create-demo-page
```

- [ ] **Step 2: Add the function module**

In `manifest.yml`, locate the existing `function:` block:

```yaml
  function:
    - key: exportMacro
      handler: export.handler
    - key: pageCaptureFn
      handler: page-capture.handler
```

Add:

```yaml
    - key: createDemoPage
      handler: createDemoPage.handler
```

- [ ] **Step 3: Build the diagramly variant locally to confirm the manifest is valid**

Run: `pnpm build:full` (the build step also validates the manifest YAML).
Expected: build succeeds. If `forge lint` is available in this repo's workflow, run that too.

- [ ] **Step 4: Commit**

```bash
git add manifest.yml
git commit -m "feat(diagramly): add admin globalSettings + createDemoPage function module"
```

---

## Task 7: Route handler

**Files:**
- Create: `src/routes/createDemoPage.ts`

- [ ] **Step 1: Create the route handler**

Create `src/routes/createDemoPage.ts`:

```ts
import { createApp } from 'vue';
import CreateDemoPage from '@/components/Admin/CreateDemoPage.vue';

export async function handleCreateDemoPageRoute() {
  const app = createApp(CreateDemoPage);
  const container = document.getElementById('app');
  if (container) {
    app.mount(container);
  } else {
    console.error('App container not found for createDemoPage route');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/createDemoPage.ts
git commit -m "feat(diagramly): add createDemoPage route handler"
```

(The component this imports is created in Task 8; this commit leaves a temporary unresolved import, fixed in the very next task. The intermediate state is acceptable because no build runs between commits in subagent execution.)

---

## Task 8: Admin Vue component

**Files:**
- Create: `src/components/Admin/CreateDemoPage.vue`

- [ ] **Step 1: Create the component**

Create `src/components/Admin/CreateDemoPage.vue`:

```vue
<template>
  <div class="create-demo-page">
    <h1>Diagramly Admin — Create demo page</h1>
    <p>
      Creates a demo page in the chosen Confluence space, using the Diagramly app
      identity. Use this only on tenants where a demo page is expected.
    </p>

    <form @submit.prevent="onSubmit">
      <label for="spaceKey">Space key</label>
      <input
        id="spaceKey"
        v-model="spaceKey"
        type="text"
        placeholder="e.g. DEMO"
        required
        :disabled="busy"
      />
      <button type="submit" :disabled="busy || !spaceKey">
        {{ busy ? 'Creating…' : 'Create demo page' }}
      </button>
    </form>

    <div v-if="result" class="result" :class="{ ok: result.ok, err: !result.ok }">
      <p v-if="result.ok && result.alreadyExists">
        Demo page already exists for space <code>{{ spaceKey }}</code>. Page id:
        <code>{{ result.pageId }}</code>.
      </p>
      <p v-else-if="result.ok">
        Demo page created. Page id: <code>{{ result.pageId }}</code>.
      </p>
      <p v-else>
        Create failed (status {{ result.status }}, {{ result.error }}).
        <span v-if="result.detail">Detail: {{ result.detail }}</span>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { invoke } from '@forge/bridge';

type Success = { ok: true; pageId: string; alreadyExists?: boolean; createdAt?: string };
type Failure = { ok: false; status: number; error: string; detail?: string };
type InvokeResult = Success | Failure;

const spaceKey = ref('');
const busy = ref(false);
const result = ref<InvokeResult | null>(null);

async function onSubmit() {
  busy.value = true;
  result.value = null;
  try {
    const res = (await invoke('createDemoPage', { spaceKey: spaceKey.value })) as InvokeResult;
    result.value = res;
  } catch (e) {
    result.value = {
      ok: false,
      status: 0,
      error: 'invoke_failed',
      detail: e instanceof Error ? e.message : String(e),
    };
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.create-demo-page { max-width: 640px; margin: 24px auto; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
label { display: block; margin-top: 12px; font-weight: 600; }
input { width: 100%; padding: 8px; margin-top: 4px; box-sizing: border-box; }
button { margin-top: 12px; padding: 8px 16px; cursor: pointer; }
.result { margin-top: 16px; padding: 12px; border-radius: 4px; }
.result.ok { background: #e8f5ed; color: #0c4a2b; }
.result.err { background: #fdecea; color: #5c1916; }
code { background: #0001; padding: 0 4px; border-radius: 2px; }
</style>
```

- [ ] **Step 2: Run lint to verify the Vue file parses**

Run: `pnpm lint:vue`
Expected: no errors for the new file.

- [ ] **Step 3: Commit**

```bash
git add src/components/Admin/CreateDemoPage.vue
git commit -m "feat(diagramly): add admin Create-demo-page Vue component"
```

---

## Task 9: Wire the route into forgeIndex.ts

**Files:**
- Modify: `src/forgeIndex.ts`

The existing globalSettings branch unconditionally routes to `handleGetStartedRoute()`. We need to branch on the extension `key` so our new entry routes to `handleCreateDemoPageRoute()` and the existing Get Started entry continues to route to its handler.

- [ ] **Step 1: Add the import**

Near the top of `src/forgeIndex.ts`, alongside the other `import { handle... } from './routes/...';` lines, add:

```ts
import { handleCreateDemoPageRoute } from './routes/createDemoPage';
```

- [ ] **Step 2: Branch on extension.key in the globalSettings block**

Locate this block in `initializeCriticalPath`:

```ts
    // Check if this is a global settings route (get started page)
    const context = await initForgeContext();
    if (context.extension?.type === 'confluence:globalSettings') {
      await handleGetStartedRoute();
      return { macroData: null };
    }
```

Replace with:

```ts
    // Check if this is a global settings route
    const context = await initForgeContext();
    if (context.extension?.type === 'confluence:globalSettings') {
      if (context.extension?.key === 'diagramly-admin-create-demo-page') {
        await handleCreateDemoPageRoute();
      } else {
        await handleGetStartedRoute();
      }
      return { macroData: null };
    }
```

- [ ] **Step 3: Run the unit tests and a build to confirm no regression**

Run: `pnpm test:unit && pnpm build:full`
Expected: tests pass; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/forgeIndex.ts
git commit -m "feat(diagramly): route diagramly-admin-create-demo-page in forgeIndex"
```

---

## Task 10: CI workflow updates — key-specific `yq` strip

**Files:**
- Modify: `.github/workflows/staging-deploy.yml`
- Modify: `.github/workflows/release.yml`

Both workflows currently delete the entire `confluence:globalSettings` and `confluence:globalPage` blocks from the Diagramly build, which would remove our new entry. They also do not currently strip the new entry from Lite/Full builds.

- [ ] **Step 1: Update `staging-deploy.yml`**

Locate the line at `.github/workflows/staging-deploy.yml:70`:

```yaml
          cmd: yq eval 'del(.modules["confluence:globalSettings"]) | del(.modules["confluence:globalPage"])' -i manifest.yml
```

Replace with:

```yaml
          cmd: |
            yq eval '
              del(.modules."confluence:globalSettings"[] | select(.key == "zenuml-get-started-settings"))
              | del(.modules."confluence:globalPage"[]   | select(.key == "zenuml-dashboard-page"))
            ' -i manifest.yml
```

This block runs under the diagramly-build step. Result: our new `diagramly-admin-create-demo-page` entry survives in diagramly builds.

Now find the lite-build and full-build steps in the same file. After their existing strips (typically the `licensing` strip line), add a new step:

```yaml
      - name: Remove diagramly-only admin module
        # Run only for lite and full builds (i.e. NOT for diagramly).
        if: ${{ matrix.variant != 'diagramly' }}
        uses: mikefarah/yq@<existing pinned version in this workflow>
        with:
          cmd: |
            yq eval '
              del(.modules."confluence:globalSettings"[] | select(.key == "diagramly-admin-create-demo-page"))
              | del(.modules.function[] | select(.key == "createDemoPage"))
            ' -i manifest.yml
```

(Use whatever variant-selection mechanism this file already uses — `matrix.variant`, `inputs.variant`, env vars, etc. Inspect the surrounding lines to copy the existing convention exactly.)

- [ ] **Step 2: Update `release.yml`**

Apply the same two edits to `.github/workflows/release.yml`:

- Replace the line at `.github/workflows/release.yml:68` with the diagramly key-specific deletion form.
- Add a lite/full-only step that deletes the `diagramly-admin-create-demo-page` and `createDemoPage` entries.

- [ ] **Step 3: Verify locally by simulating each strip against the current `manifest.yml`**

Run, from the repo root:

```bash
# Diagramly path: should keep diagramly-admin-create-demo-page
cp manifest.yml manifest.test.yml
yq eval '
  del(.modules."confluence:globalSettings"[] | select(.key == "zenuml-get-started-settings"))
  | del(.modules."confluence:globalPage"[]   | select(.key == "zenuml-dashboard-page"))
' -i manifest.test.yml
grep -c 'diagramly-admin-create-demo-page' manifest.test.yml   # expect: 1 (still present)
grep -c 'createDemoPage' manifest.test.yml                     # expect: at least 1 (function entry still present)
grep -c 'zenuml-get-started-settings' manifest.test.yml        # expect: 0 (stripped)
grep -c 'zenuml-dashboard-page' manifest.test.yml              # expect: 0 (stripped)

# Lite/Full path: should remove diagramly entries
cp manifest.yml manifest.test.yml
yq eval '
  del(.modules."confluence:globalSettings"[] | select(.key == "diagramly-admin-create-demo-page"))
  | del(.modules.function[] | select(.key == "createDemoPage"))
' -i manifest.test.yml
grep -c 'diagramly-admin-create-demo-page' manifest.test.yml   # expect: 0
grep -c 'createDemoPage' manifest.test.yml                     # expect: 0

rm manifest.test.yml
```

Expected: every `grep -c` returns the expected value.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/staging-deploy.yml .github/workflows/release.yml
git commit -m "ci(diagramly): key-specific yq strip for demo-page admin module"
```

---

## Task 11: PR template additions

**Files:**
- Modify: `.github/pull_request_template.md` (or whichever PR template the repo uses; check `.github/` for the actual filename)

- [ ] **Step 1: Check if a PR template exists**

Run: `ls .github/`
If `pull_request_template.md` does not exist, create it. If a different name is used (e.g. `PULL_REQUEST_TEMPLATE.md`, or one inside `.github/PULL_REQUEST_TEMPLATE/`), modify that file.

- [ ] **Step 2: Append the demo-page-validation section**

Add at the end of the PR template:

```markdown
## Demo-page validation (Diagramly only — required for demo-page PRs)

- [ ] Created a demo page on `dia-dev.atlassian.net` via the tunneled admin entry.
- [ ] Attached the resulting page URL to this PR description.
- [ ] Attached one screenshot per macro showing it rendered (not in an error state):
  - [ ] Sequence (ZenUML)
  - [ ] Flowchart (Mermaid)
  - [ ] Graph (DrawIO)
  - [ ] OpenAPI / Swagger
- [ ] Attached the `results[].name` list returned by the `/wiki/rest/api/user/memberof` call for a known-admin user on `dia-dev`. Confirmed at least one group name matches the regex `^(site-admins|confluence-admins(-.+)?)$`. If not, the regex was broadened and this PR includes the update.
- [ ] Confirmed post-CI `manifest.yml` artifacts: diagramly build contains `diagramly-admin-create-demo-page` and `createDemoPage`; lite and full builds contain neither.
```

- [ ] **Step 3: Commit**

```bash
git add .github/pull_request_template.md   # or the actual filename
git commit -m "docs(diagramly): add demo-page validation checklist to PR template"
```

---

## Task 12: Live tunnel validation (manual, gating)

**Files:** none (manual verification step; produces artifacts attached to the PR description).

This is the macro-rendering gate from the spec. It is the actual product validation; the unit tests only cover behavior.

- [ ] **Step 1: Start the Forge tunnel for the diagramly variant**

Run (in one terminal):

```bash
pnpm forge:deploy:diagramly:staging   # one-time, if not already deployed at this revision
pnpm forge:install:diagramly:staging  # if not already installed
pnpm forge:tunnel
```

When prompted by `forge tunnel`, ensure the environment matches the diagramly staging deployment.

- [ ] **Step 2: Open the admin entry on the dev site**

Open `https://dia-dev.atlassian.net/wiki/` in a browser, signed in as a known site admin. Navigate to: app menu → "Manage apps" → find "Diagramly Admin — Create demo page" → click it.

If the entry does not appear, stop and diagnose (likely manifest or CI-strip issue). Do not proceed.

- [ ] **Step 3: Capture the admin group-name evidence**

Before clicking the button, temporarily add a `console.log(JSON.stringify(body))` line inside `isCallerSiteAdmin` after the `body = await res.json()` line in `src/createDemoPage.ts`. Submit the form once. Check the Forge logs:

```bash
forge logs --environment staging --product confluence
```

Copy the printed `results` array. Confirm at least one group name matches `^(site-admins|confluence-admins(-.+)?)$`. If not, broaden the regex in `src/createDemoPage.ts` and re-test before continuing.

Remove the temporary `console.log` line and commit:

```bash
git diff src/createDemoPage.ts   # verify only the log removal
git add src/createDemoPage.ts
git commit -m "chore(diagramly): remove temporary admin-group log"
```

Attach the (sanitized) group-name list to the PR description.

- [ ] **Step 4: Create the demo page and capture screenshots**

Submit the form with the key of any global current space in `dia-dev`. Open the resulting page. Take one screenshot per macro type (Sequence, Flowchart/Mermaid, Graph/DrawIO, OpenAPI) showing the macro rendered. Attach all four to the PR description.

If any macro fails to render, stop. Fix the ADF in `src/demoPageContent.ts`, re-test (delete the marker via `forge storage del demo-page:<spaceKey>` if needed to recreate), and only proceed when all four render.

- [ ] **Step 5: Verify idempotency and opt-out**

- Click the button again → confirm the result says "Demo page already exists" with the same `pageId`. No duplicate page in the space.
- Delete the page in Confluence → click the button again → confirm the result still says "already exists" (the marker is the source of truth; opt-out is honored).
- Run `forge storage del demo-page:<spaceKey>` → click the button → confirm a fresh demo page is created.

Note the outcomes in the PR description.

- [ ] **Step 6: No commit for this task**

This task is procedural and produces PR-description artifacts, not code commits. Subsequent code changes from any "if-fail" branches above already committed under Step 3.

---

## Self-Review

**Spec coverage check (each section → task):**

| Spec section | Covered by |
|---|---|
| Purpose / plumbing-spike framing | Plan header + Task 12 gating |
| Architecture (resolver flow) | Tasks 2–5 (TDD across the 5 steps of the flow) |
| Components table | Tasks 1, 5, 7, 8, 9, 6 |
| Page content (ADF + canonical title) | Task 1 |
| Idempotency contract | Task 4 |
| Variant gating + CI changes | Tasks 6, 10 |
| Authorization (memberof + regex + live-validate) | Task 2 + Task 12 step 3 |
| Error handling (POST failure → no marker, 4xx surface to UI) | Task 5 (POST-failure test); Task 8 (UI surfaces `result.status` and `result.error`) |
| Permissions (manifest scopes) | Already in `manifest.yml`; verified by reading manifest. No new scope add. |
| Forge-tunnel testing strategy | Task 12 |
| Unit tests (behavior boundary) | Tasks 1, 2, 3, 4, 5 |
| PR-checklist gate (macro screenshots + group-name evidence + post-CI artifacts) | Task 11 + Task 12 |
| Open question 1 (Mermaid macro payload) | Resolved by Task 1 + Task 12 step 4 (rendering gate) |
| Open question 2 (yq strip cleanliness) | Resolved by Task 10 step 3 (local simulation) |

No spec section is unaddressed.

**Placeholder scan:** all code blocks contain runnable code; all commands are exact; no "TBD" / "TODO" / "fill in" anywhere in the plan body. Two judgment-call references intentionally left:
- Task 10 mentions "whatever variant-selection mechanism this file already uses" — the implementer must read the surrounding workflow lines to match the existing convention (matrix vs. inputs vs. env). This is the smallest correct instruction; hardcoding either would risk being wrong.
- Task 11 says "or whichever PR template the repo uses; check `.github/`" — same reason.

**Type consistency:**
- `handler` payload type `{ spaceKey: string }` is used consistently across Tasks 2–5 and matches the Vue component's `invoke('createDemoPage', { spaceKey: spaceKey.value })`.
- The success/failure shape `{ ok, status, error, pageId, alreadyExists, createdAt }` defined in the Vue component (Task 8) matches what the resolver returns across Tasks 2–5.
- Storage key shape `demo-page:<spaceKey>` is identical in Tasks 4, 5, and 12.
- Marker value shape `{ pageId, createdAt, source }` is identical in Tasks 4 and 5.

---

## Execution Handoff

Plan complete and committed once you choose execution.

Executing subagent-driven by user-default (per CLAUDE.md "always pick the recommended one without asking"):
**REQUIRED SUB-SKILL:** `superpowers:subagent-driven-development` — fresh subagent per task with two-stage review between tasks.
