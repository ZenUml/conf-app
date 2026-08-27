# Architecture Tokens Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reader of a Mermaid sequence diagram sees, after render and without any blocking, that a participant "also appears in N diagrams you can access", with a per-lifeline popover listing those pages.

**Architecture:** A local pipeline (already in `tools/architecture-tokens/`) extracts participants from the D1 mirror and uploads a rebuildable reverse index to a new D1 table. One authenticated Cloudflare Pages route joins by lexical key and filters pages **as the requesting user** with a CQL `id in (…)` call. A viewer footer component, gated by the Forge feature flag `architecture-tokens-enabled`, calls that route after render and maps popovers onto mermaid's `name="<actorId>"` actor elements.

**Tech Stack:** Vue 3 (`<script setup>` + Options API in `GenericViewer.vue`), TypeScript, vitest + jsdom, Cloudflare Pages Functions + D1, `@forge/bridge` (`invokeRemote`, `FeatureFlags`), mermaid 11.12.2, Node 22 (`--experimental-strip-types` for `.mjs` → `.ts` imports).

**Spec:** `docs/superpowers/specs/2026-08-27-architecture-tokens-phase1-design.md`

## Global Constraints

- Customer content (corpus, labels, model outputs, tenant ids, cloudId) is never committed to any repository, `private/` included. Local artifacts go to `$ARCHTOK_DIR` = `private/local-data/architecture-tokens/<pilot>/` (git-ignored). The public repo refers to the tenant only as *the pilot tenant*.
- No Forge function, no scheduled trigger, no `manifest.yml` change.
- The diagram render never waits on this feature. Every failure path is silent to the user and recorded as an analytics event.
- Nothing about an inaccessible page (id, title, label, count) may reach the browser. The permission filter runs in the backend as the requesting user.
- Copy: "also appears in", "Possibly related by name". Never "is the same as", never "Confirmed" (Phase 2).
- The lexical key is computed only by `tools/architecture-tokens/pilot/participant-normalization.mjs`; the frontend never normalizes.
- Feature flag default is `false`; every read is `client.checkFlag('architecture-tokens-enabled', false)`.
- Analytics events carry no label text, page id, or tenant vocabulary.
- Commits: one-line subject, `Co-Authored-By` + `Claude-Session` trailers, never `--no-verify`.
- Branch: `feat/architecture-tokens-local-pilot` (worktree `/Users/pengxiao/workspaces/zenuml/conf-app-architecture-tokens`).

---

## File map

| file | responsibility |
|---|---|
| `src/utils/analytics/catalog.ts`, `src/utils/analytics/types.ts` | new `FeatureArea`, five event names, their properties (Task 1) |
| `functions/migrations/0021_add_architecture_token_occurrence.sql` | the D1 table (Task 2) |
| `tools/architecture-tokens/read-corpus.mjs` | `--client-domain` mode: tenant-wide corpus via the `AtlassianInstance` → `DiagramAudience` → `CustomContent` join (Task 3) |
| `tools/architecture-tokens/upload-index.mjs`, `upload-index.spec.ts` | occurrence artifact → SQL batch → `wrangler d1 execute` (Task 4) |
| `functions/architecture-tokens/repository.ts`, `service.ts` + specs | D1 reads, key join, as-user CQL filter, response shaping (Task 5) |
| `functions/api/architecture-tokens/related.ts` + spec, `functions/_middleware.ts`, `public/_routes.json` | the route and its registration (Task 6) |
| `src/services/ArchitectureTokens.ts`, `src/apis/aiTitleFeatureFlag.ts` | `callRemote` client + flag read (Task 7) |
| `src/components/Viewer/RelatedDiagramsFooter.vue` + spec | footer line, lifeline popover, events (Task 8) |
| `src/components/Viewer/GenericViewer.vue` | mount (Task 9) |
| `tools/architecture-tokens/README.md`, `docs/analytics/events-catalog.md` | docs (Task 10) |

Test commands: `pnpm vitest --run <path>`; lint `pnpm exec eslint <paths>`; typecheck `pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep <path>` (baseline has ~150 pre-existing errors; only new-file errors count).

---

### Task 1: Analytics catalog first

**Files:**
- Modify: `src/utils/analytics/catalog.ts:22` (end of `FeatureArea`), `catalog.ts:571` (after `diagram_audience_registration_failed`)
- Modify: `src/utils/analytics/types.ts:222` (after `space_admin_count?: number;`)
- Test: `src/utils/analytics/catalog.architectureTokens.spec.ts`

**Interfaces:**
- Produces: `FeatureArea` includes `"architecture_tokens"`; `AnalyticsEventName` includes `related_diagrams_lookup_succeeded`, `related_diagrams_lookup_failed`, `related_diagrams_shown`, `related_diagram_popover_opened`, `related_diagram_link_clicked`; `AnalyticsProperties` gains the optional fields below.

- [ ] **Step 1: Write the failing test** (a compile-time check that the names exist, executed by vitest)

```ts
// src/utils/analytics/catalog.architectureTokens.spec.ts
import { describe, expect, it } from 'vitest';
import type { AnalyticsEventName, FeatureArea } from './catalog';
import type { AnalyticsProperties } from './types';

describe('architecture_tokens analytics contract', () => {
  it('declares the five events and the feature area', () => {
    const names: AnalyticsEventName[] = [
      'related_diagrams_lookup_succeeded',
      'related_diagrams_lookup_failed',
      'related_diagrams_shown',
      'related_diagram_popover_opened',
      'related_diagram_link_clicked',
    ];
    const area: FeatureArea = 'architecture_tokens';
    const props: AnalyticsProperties = {
      feature_area: area, surface: 'viewer', macro_type: 'mermaid',
      participant_count: 7, participants_with_related: 5, related_pages_total: 12,
      index_age_days: 3, related_count: 3, popover_trigger: 'hover',
      label_variant_count: 2, same_space: false, error_kind: 'timeout',
    };
    expect(names).toHaveLength(5);
    expect(props.feature_area).toBe('architecture_tokens');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest --run src/utils/analytics/catalog.architectureTokens.spec.ts`
Expected: FAIL — vitest's esbuild transform does not type-check, so add a type-check run: `pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep catalog.architectureTokens` → errors `Type '"related_diagrams_lookup_succeeded"' is not assignable to type 'AnalyticsEventName'` and `'"architecture_tokens"' is not assignable to type 'FeatureArea'`.

- [ ] **Step 3: Add the union members and properties**

`catalog.ts` — replace the last `FeatureArea` line:

```ts
  | "diagram_impact"
  // Architecture Tokens: "also appears in other diagrams" context for Mermaid
  // sequence participants. Read-only in Phase 1; index built offline.
  | "architecture_tokens";
```

`catalog.ts` — after `| "diagram_audience_registration_failed"`:

```ts
  // Architecture Tokens Phase 1 (viewer footer + lifeline popover). No label
  // text, page id, or tenant vocabulary on any of these.
  | "related_diagrams_lookup_succeeded"
  | "related_diagrams_lookup_failed"
  | "related_diagrams_shown"
  | "related_diagram_popover_opened"
  | "related_diagram_link_clicked"
```

`types.ts` — after `space_admin_count?: number;`:

```ts
  // Architecture Tokens Phase 1. Counts only.
  participant_count?: number;          // participants declared in this diagram
  participants_with_related?: number;  // of which have >=1 accessible related page
  related_pages_total?: number;        // sum of accessible related pages
  index_age_days?: number;             // now - indexedAt, whole days
  related_count?: number;              // for one participant (popover / click)
  popover_trigger?: 'hover' | 'click';
  label_variant_count?: number;        // distinct rawLabel values among related
  same_space?: boolean;                // clicked page in the same space as the viewer's page
  error_kind?: string;                 // 'timeout' | 'network' | 'http_<status>' | body error_kind
```

- [ ] **Step 4: Verify green**

Run: `pnpm vitest --run src/utils/analytics/catalog.architectureTokens.spec.ts && pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -c catalog.architectureTokens`
Expected: PASS and `0`.

- [ ] **Step 5: Commit**

```bash
git add src/utils/analytics/catalog.ts src/utils/analytics/types.ts src/utils/analytics/catalog.architectureTokens.spec.ts
git commit -m "analytics(architecture-tokens): plan the five viewer events before any feature code"
```

---

### Task 2: D1 migration for the occurrence index

**Files:**
- Create: `functions/migrations/0021_add_architecture_token_occurrence.sql`
- Test: `functions/migrations/0021.spec.ts` (applies the SQL to an in-memory sqlite via `better-sqlite3`? — NOT available; use `node:sqlite` from Node 22.5+: `import { DatabaseSync } from 'node:sqlite'`)

**Interfaces:**
- Produces: table `ArchitectureTokenOccurrence` (columns in the spec §4); indexes `ArchitectureTokenOccurrence_key (cloudId, comparisonKey)` and `ArchitectureTokenOccurrence_content (cloudId, contentId)`.

- [ ] **Step 1: Write the failing test**

```ts
// functions/migrations/0021.spec.ts
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('0021_add_architecture_token_occurrence', () => {
  it('creates the table with the composite primary key and both indexes', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(new URL('./0021_add_architecture_token_occurrence.sql', import.meta.url), 'utf8'));
    const cols = db.prepare("PRAGMA table_info('ArchitectureTokenOccurrence')").all().map((c: any) => c.name);
    expect(cols).toEqual(['cloudId','spaceId','contentId','pageId','contentVersion','actorId','rawLabel','comparisonKey','declKind','lineNumber','runId','indexedAt']);
    const idx = db.prepare("PRAGMA index_list('ArchitectureTokenOccurrence')").all().map((i: any) => i.name);
    expect(idx).toEqual(expect.arrayContaining(['ArchitectureTokenOccurrence_key', 'ArchitectureTokenOccurrence_content']));
    // duplicate anchor + line is rejected; same anchor on another line is allowed
    const ins = db.prepare("INSERT INTO ArchitectureTokenOccurrence VALUES ('c','s','1','p',1,'PA','Partner App','partner.app','participant',?, 'r','2026-08-27T00:00:00Z')");
    ins.run(2);
    ins.run(9);
    expect(() => ins.run(2)).toThrow(/UNIQUE|PRIMARY KEY/);
    expect(() => db.exec("INSERT INTO ArchitectureTokenOccurrence VALUES ('c','s','1','p',1,'X','X','x','box',3,'r','t')")).toThrow(/CHECK/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest --run functions/migrations/0021.spec.ts`
Expected: FAIL — `ENOENT … 0021_add_architecture_token_occurrence.sql`. (If `node:sqlite` is missing under the vitest Node, run vitest with `NODE_OPTIONS=--experimental-sqlite`; Node ≥22.13 ships it unflagged.)

- [ ] **Step 3: Write the migration**

```sql
-- Architecture Tokens Phase 1: rebuildable reverse index of explicit Mermaid
-- sequence participants, uploaded by the local pipeline
-- (tools/architecture-tokens/upload-index.mjs), replaced per tenant per run.
-- Confluence custom content stays the system of record; rendering never
-- depends on this table. `rawLabel` adds no new data class: CustomContent.body
-- already holds the whole diagram. Decisions (Phase 2) anchor on
-- (contentId, actorId) and therefore survive a replace.

CREATE TABLE IF NOT EXISTS ArchitectureTokenOccurrence (
  cloudId        TEXT    NOT NULL,
  spaceId        TEXT    NOT NULL,
  contentId      TEXT    NOT NULL,
  pageId         TEXT    NOT NULL,
  contentVersion INTEGER NOT NULL,
  actorId        TEXT    NOT NULL,
  rawLabel       TEXT    NOT NULL,
  comparisonKey  TEXT    NOT NULL,
  declKind       TEXT    NOT NULL CHECK (declKind IN ('participant', 'actor')),
  lineNumber     INTEGER NOT NULL,
  runId          TEXT    NOT NULL,
  indexedAt      TEXT    NOT NULL,
  PRIMARY KEY (cloudId, contentId, actorId, lineNumber)
);

CREATE INDEX IF NOT EXISTS ArchitectureTokenOccurrence_key
  ON ArchitectureTokenOccurrence (cloudId, comparisonKey);

CREATE INDEX IF NOT EXISTS ArchitectureTokenOccurrence_content
  ON ArchitectureTokenOccurrence (cloudId, contentId);
```

- [ ] **Step 4: Verify green, then apply locally**

Run: `pnpm vitest --run functions/migrations/0021.spec.ts` → PASS.
Run: `pnpm run db:migrate:local` (needs a local `wrangler.toml` copied from `wrangler-dev.toml`) → output lists `0021_add_architecture_token_occurrence.sql` as applied. CI applies it to staging on merge and to production on release (`.github/actions/wrangler-publish/action.yml`, step *Run D1 Migrations*).

- [ ] **Step 5: Commit**

```bash
git add functions/migrations/0021_add_architecture_token_occurrence.sql functions/migrations/0021.spec.ts
git commit -m "db: ArchitectureTokenOccurrence — rebuildable reverse index for the viewer's related-diagrams lookup"
```

---

### Task 3: Tenant-wide corpus read

**Files:**
- Modify: `tools/architecture-tokens/read-corpus.mjs` (add `--client-domain`; keep `--space-id --app-id`)
- Test: `tools/architecture-tokens/read-corpus.spec.ts`

**Interfaces:**
- Produces: `export function tenantSpacesSql(clientDomain: string): string` and `export function corpusSql(scope: {spaceIds: string[], appId?: string}): string` (pure), and `readCorpus({ clientDomain, runWrangler })` / `readCorpus({ spaceId, appId, runWrangler })` returning `{ schemaVersion: 1, cloudId, spaceIds, mermaidRows, notSequence, sources: [{ sourceId, sourceRevision, sourceHash, mermaidCode, spaceId, pageId }] }`.
- Note: the tenant's `cloudId` is stored in `AtlassianInstance` with `clientDomain = '<domain>.atlassian.net'`; `ForgeInstallation` rows for the bare domain have `cloudId NULL`. Spaces come from `DiagramAudience(cloudId) → CustomContent.contentId → spaceId`.

- [ ] **Step 1: Write the failing test**

```ts
// tools/architecture-tokens/read-corpus.spec.ts
import { describe, expect, it } from 'vitest';
import { corpusSql, readCorpus, tenantSpacesSql } from './read-corpus.mjs';

describe('tenantSpacesSql', () => {
  it('resolves cloudId from AtlassianInstance by <domain>.atlassian.net and spaces via DiagramAudience', () => {
    const sql = tenantSpacesSql('example-tenant');
    expect(sql).toMatch(/AtlassianInstance/);
    expect(sql).toContain("'example-tenant.atlassian.net'");
    expect(sql).toMatch(/DiagramAudience/);
    expect(sql).toMatch(/DISTINCT c\.spaceId/);
  });
  it('escapes single quotes', () => {
    expect(tenantSpacesSql("o'k")).toContain("'o''k.atlassian.net'");
  });
});

describe('corpusSql', () => {
  it('selects current mermaid rows for the given spaces with pageId and spaceId', () => {
    const sql = corpusSql({ spaceIds: ['1', '2'] });
    expect(sql).toContain("spaceId IN ('1','2')");
    expect(sql).toMatch(/status = 'current'/);
    expect(sql).toMatch(/diagramType'\) = 'mermaid'/);
    expect(sql).toMatch(/pageId/);
  });
});

describe('readCorpus (client-domain mode)', () => {
  it('keeps only sequence diagrams and records cloudId + spaces', async () => {
    const calls: string[] = [];
    const runWrangler = async (sql: string) => {
      calls.push(sql);
      if (sql.includes('AtlassianInstance')) return [{ results: [{ cloudId: 'cid', spaceId: '7' }, { cloudId: 'cid', spaceId: '8' }] }];
      return [{ results: [
        { sourceId: '10', sourceRevision: 2, spaceId: '7', pageId: '100', rawValue: JSON.stringify({ diagramType: 'mermaid', mermaidCode: 'sequenceDiagram\n participant A' }) },
        { sourceId: '11', sourceRevision: 1, spaceId: '8', pageId: '101', rawValue: JSON.stringify({ diagramType: 'mermaid', mermaidCode: 'flowchart TD\n A-->B' }) },
      ] }];
    };
    const corpus = await readCorpus({ clientDomain: 'example-tenant', runWrangler });
    expect(corpus.cloudId).toBe('cid');
    expect(corpus.spaceIds).toEqual(['7', '8']);
    expect(corpus.sources.map((s) => s.sourceId)).toEqual(['10']);
    expect(corpus.sources[0]).toMatchObject({ spaceId: '7', pageId: '100', sourceRevision: 2 });
    expect(corpus.notSequence).toBe(1);
    expect(calls).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest --run tools/architecture-tokens/read-corpus.spec.ts`
Expected: FAIL — `tenantSpacesSql is not a function` / `corpusSql is not a function`.

- [ ] **Step 3: Implement**

Replace the body of `read-corpus.mjs` (keep the header comment, `sqlString`, `runWrangler`, `arg`) with:

```js
export function tenantSpacesSql(clientDomain) {
  const host = sqlString(`${clientDomain}.atlassian.net`);
  return `SELECT DISTINCT t.cloudId AS cloudId, c.spaceId AS spaceId
    FROM AtlassianInstance t
    JOIN DiagramAudience a ON a.cloudId = t.cloudId
    JOIN CustomContent c ON c.contentId = a.customContentId
    WHERE t.clientDomain = ${host}`;
}

export function corpusSql({ spaceIds, appId }) {
  const ids = spaceIds.map(sqlString).join(',');
  const appFilter = appId ? ` AND appId = ${sqlString(appId)}` : '';
  return `SELECT contentId AS sourceId, latestVersionNumber AS sourceRevision, spaceId, pageId,
      json_extract(body, '$.raw.value') AS rawValue
    FROM CustomContent
    WHERE spaceId IN (${ids})${appFilter} AND status = 'current'
      AND json_extract(json_extract(body, '$.raw.value'), '$.diagramType') = 'mermaid'`;
}

function toSources(rows) {
  const sources = [];
  let notSequence = 0;
  for (const row of rows) {
    let parsed;
    try { parsed = JSON.parse(row.rawValue); } catch { notSequence += 1; continue; }
    const mermaidCode = typeof parsed?.mermaidCode === 'string' ? parsed.mermaidCode : '';
    if (!isSequenceDiagram(mermaidCode)) { notSequence += 1; continue; }
    sources.push({
      sourceId: String(row.sourceId),
      sourceRevision: Number(row.sourceRevision),
      sourceHash: createHash('sha256').update(row.rawValue).digest('hex'),
      spaceId: String(row.spaceId),
      pageId: String(row.pageId ?? ''),
      mermaidCode,
    });
  }
  sources.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  return { sources, notSequence };
}

export async function readCorpus({ clientDomain, spaceId, appId, runWrangler: run = runWrangler }) {
  let cloudId = null;
  let spaceIds;
  if (clientDomain) {
    const rows = (await run(tenantSpacesSql(clientDomain)))[0]?.results ?? [];
    if (rows.length === 0) throw new Error('tenant not found in AtlassianInstance/DiagramAudience');
    cloudId = rows[0].cloudId;
    spaceIds = [...new Set(rows.map((r) => String(r.spaceId)))].sort();
  } else {
    if (!spaceId) throw new Error('need --client-domain or --space-id');
    spaceIds = [String(spaceId)];
  }
  const rows = (await run(corpusSql({ spaceIds, appId })))[0]?.results ?? [];
  const { sources, notSequence } = toSources(rows);
  return { schemaVersion: 1, cloudId, spaceIds, appId: appId ?? null, mermaidRows: rows.length, notSequence, sources };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const clientDomain = arg('client-domain');
  const spaceId = arg('space-id');
  const appId = arg('app-id');
  const out = arg('out');
  if ((!clientDomain && !spaceId) || !out) {
    console.error('usage: read-corpus.mjs (--client-domain <d> | --space-id <id> [--app-id <uuid>]) --out <file>');
    process.exit(2);
  }
  const corpus = await readCorpus({ clientDomain, spaceId, appId });
  await writeFile(out, JSON.stringify(corpus), { mode: 0o600 });
  console.log(JSON.stringify({ spaces: corpus.spaceIds.length, mermaidRows: corpus.mermaidRows, sequenceSources: corpus.sources.length, notSequence: corpus.notSequence, out }));
}
```

- [ ] **Step 4: Verify green, lint, then run for real**

Run: `pnpm vitest --run tools/architecture-tokens/read-corpus.spec.ts && pnpm exec eslint tools/architecture-tokens` → PASS, clean.
Run (real D1, read-only; `$ARCHTOK_DIR` is the git-ignored pilot folder; the domain comes from the operator, never from a file in the repo):
`node --experimental-strip-types tools/architecture-tokens/read-corpus.mjs --client-domain <pilot-domain> --out $ARCHTOK_DIR/raw/corpus-tenant-$(date +%F).json`
Expected: `spaces` ≈ 36, `sequenceSources` ≈ 2,300 (numbers observed 2026-08-27 from the same join).

- [ ] **Step 5: Commit** (the corpus file is outside the repo; only code is committed)

```bash
git add tools/architecture-tokens/read-corpus.mjs tools/architecture-tokens/read-corpus.spec.ts
git commit -m "tools(architecture-tokens): read a whole tenant's sequence corpus from D1 via the DiagramAudience space join"
```

---

### Task 4: Upload the index to D1

**Files:**
- Create: `tools/architecture-tokens/upload-index.mjs`
- Test: `tools/architecture-tokens/upload-index.spec.ts`

**Interfaces:**
- Consumes: the occurrence artifact from `extract-corpus.mjs` (`sources[].participants[]` with `actorId, rawLabel, comparisonKey, declKind, lineNumber`; `sources[]` with `sourceId, sourceRevision, spaceId, pageId`) — **Task 4 also adds `spaceId`/`pageId`/`cloudId` pass-through to `extract-corpus.mjs`** (three lines: copy `spaceId`, `pageId` from each source; copy `cloudId` from the corpus root).
- Produces: `export function buildUploadStatements(artifact, { cloudId, runId, indexedAt, chunkSize = 400 }): string[]` — first statement `DELETE FROM ArchitectureTokenOccurrence WHERE cloudId = '<cloudId>'`, then `INSERT INTO ArchitectureTokenOccurrence (...) VALUES (...),(...)` chunks; and `uploadIndex({ artifact, cloudId, runId, indexedAt, runWrangler })` executing them inside `BEGIN; … COMMIT;` via `wrangler d1 execute conf-zenuml-prod --remote --file <tmp.sql>`.

- [ ] **Step 1: Write the failing test**

```ts
// tools/architecture-tokens/upload-index.spec.ts
import { describe, expect, it } from 'vitest';
import { buildUploadStatements } from './upload-index.mjs';

const artifact = {
  cloudId: 'cid',
  sources: [
    { sourceId: '10', sourceRevision: 2, spaceId: '7', pageId: '100', participants: [
      { actorId: 'PA', rawLabel: "Partner's App", comparisonKey: 'partner.s.app', declKind: 'participant', lineNumber: 2 },
      { actorId: 'U', rawLabel: 'User', comparisonKey: 'user', declKind: 'actor', lineNumber: 3 },
    ] },
    { sourceId: '11', sourceRevision: 1, spaceId: '8', pageId: '101', participants: [
      { actorId: 'PA', rawLabel: 'PartnerApp', comparisonKey: 'partner.app', declKind: 'participant', lineNumber: 4 },
    ] },
  ],
};

describe('buildUploadStatements', () => {
  it('deletes the tenant first, then inserts every occurrence in chunks', () => {
    const stmts = buildUploadStatements(artifact, { cloudId: 'cid', runId: 'r1', indexedAt: '2026-08-27T05:00:00Z', chunkSize: 2 });
    expect(stmts[0]).toBe("DELETE FROM ArchitectureTokenOccurrence WHERE cloudId = 'cid'");
    expect(stmts).toHaveLength(3); // delete + 2 chunks (2 rows + 1 row)
    expect(stmts[1]).toMatch(/^INSERT INTO ArchitectureTokenOccurrence \(cloudId, spaceId, contentId, pageId, contentVersion, actorId, rawLabel, comparisonKey, declKind, lineNumber, runId, indexedAt\) VALUES/);
    expect(stmts[1]).toContain("('cid','7','10','100',2,'PA','Partner''s App','partner.s.app','participant',2,'r1','2026-08-27T05:00:00Z')");
    expect(stmts[2]).toContain("('cid','8','11','101',1,'PA','PartnerApp','partner.app','participant',4,'r1','2026-08-27T05:00:00Z')");
  });
  it('refuses an artifact whose cloudId differs from the requested one', () => {
    expect(() => buildUploadStatements(artifact, { cloudId: 'other', runId: 'r', indexedAt: 't' })).toThrow(/cloudId mismatch/);
  });
  it('refuses a source without pageId', () => {
    const bad = { ...artifact, sources: [{ ...artifact.sources[0], pageId: '' }] };
    expect(() => buildUploadStatements(bad, { cloudId: 'cid', runId: 'r', indexedAt: 't' })).toThrow(/pageId/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest --run tools/architecture-tokens/upload-index.spec.ts` → FAIL `buildUploadStatements is not a function`.

- [ ] **Step 3: Implement**

`extract-corpus.mjs` — in `buildArtifact`, add to each draft source `spaceId: source.spaceId, pageId: source.pageId,` and to the returned object `cloudId: corpus.cloudId ?? null,`.

`upload-index.mjs`:

```js
#!/usr/bin/env node
/**
 * Occurrence artifact -> D1 ArchitectureTokenOccurrence. Replace per tenant
 * per run: DELETE the tenant's rows, then batched INSERTs, one transaction.
 *
 *   node --experimental-strip-types tools/architecture-tokens/upload-index.mjs \
 *     --artifact $ARCHTOK_DIR/participant-occurrences.json --cloud-id-file $ARCHTOK_DIR/cloud-id
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const D1_DATABASE = 'conf-zenuml-prod';
const COLUMNS = ['cloudId', 'spaceId', 'contentId', 'pageId', 'contentVersion', 'actorId', 'rawLabel', 'comparisonKey', 'declKind', 'lineNumber', 'runId', 'indexedAt'];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const q = (v) => `'${String(v).replaceAll("'", "''")}'`;

export function buildUploadStatements(artifact, { cloudId, runId, indexedAt, chunkSize = 400 }) {
  if (artifact.cloudId && artifact.cloudId !== cloudId) throw new Error('cloudId mismatch between artifact and request');
  const rows = [];
  for (const s of artifact.sources) {
    if (!s.pageId) throw new Error(`source ${s.sourceId} has no pageId`);
    for (const p of s.participants) {
      rows.push([q(cloudId), q(s.spaceId), q(s.sourceId), q(s.pageId), Number(s.sourceRevision), q(p.actorId), q(p.rawLabel), q(p.comparisonKey), q(p.declKind), Number(p.lineNumber), q(runId), q(indexedAt)]);
    }
  }
  const statements = [`DELETE FROM ArchitectureTokenOccurrence WHERE cloudId = ${q(cloudId)}`];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const values = rows.slice(i, i + chunkSize).map((r) => `(${r.join(',')})`).join(',');
    statements.push(`INSERT INTO ArchitectureTokenOccurrence (${COLUMNS.join(', ')}) VALUES ${values}`);
  }
  return statements;
}

function runWranglerFile(file) {
  const child = spawn('pnpm', ['exec', 'wrangler', 'd1', 'execute', D1_DATABASE, '--remote', '--json', '--file', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { err += c; });
  return new Promise((resolve, reject) => child.on('close', (code) => {
    if (code !== 0) return reject(new Error(`wrangler exited ${code}: ${err.slice(-400)}`));
    resolve(out);
  }));
}

export async function uploadIndex({ artifact, cloudId, runId, indexedAt, run = runWranglerFile }) {
  const statements = buildUploadStatements(artifact, { cloudId, runId, indexedAt });
  const dir = await mkdtemp(join(tmpdir(), 'archtok-upload-'));
  const file = join(dir, 'upload.sql');
  try {
    await writeFile(file, ['BEGIN;', ...statements.map((s) => `${s};`), 'COMMIT;'].join('\n'), { mode: 0o600 });
    await run(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { statements: statements.length, rows: artifact.sources.reduce((n, s) => n + s.participants.length, 0) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const artifactPath = arg('artifact');
  const cloudIdFile = arg('cloud-id-file');
  if (!artifactPath || !cloudIdFile) { console.error('usage: upload-index.mjs --artifact <json> --cloud-id-file <file>'); process.exit(2); }
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
  const cloudId = (await readFile(cloudIdFile, 'utf8')).trim();
  const indexedAt = new Date().toISOString();
  const runId = indexedAt.slice(0, 10);
  const result = await uploadIndex({ artifact, cloudId, runId, indexedAt });
  console.log(JSON.stringify({ ...result, runId, indexedAt }));
}
```

- [ ] **Step 4: Verify green, lint, then upload for real and count**

Run: `pnpm vitest --run tools/architecture-tokens && pnpm exec eslint tools/architecture-tokens` → all PASS, clean.
Run the pipeline end to end on the tenant corpus from Task 3, then verify in D1:

```bash
node --experimental-strip-types tools/architecture-tokens/extract-corpus.mjs --corpus $ARCHTOK_DIR/raw/corpus-tenant-<date>.json --out $ARCHTOK_DIR/participant-occurrences-tenant-<date>.json
node --experimental-strip-types tools/architecture-tokens/upload-index.mjs --artifact $ARCHTOK_DIR/participant-occurrences-tenant-<date>.json --cloud-id-file $ARCHTOK_DIR/cloud-id
npx wrangler d1 execute conf-zenuml-prod --remote --json --command "SELECT COUNT(*) n, COUNT(DISTINCT contentId) diagrams, COUNT(DISTINCT comparisonKey) keys, MAX(indexedAt) asOf FROM ArchitectureTokenOccurrence"
```
Expected: `n` equals `occurrenceCount` printed by `extract-corpus.mjs`; `diagrams` equals `cohortSourceCount`. **This step runs only after migration 0021 is on production D1 (CI on release) — until then, run the same against the local dev DB (`--local` after `db:migrate:local`) to prove the SQL.**

- [ ] **Step 5: Commit**

```bash
git add tools/architecture-tokens/upload-index.mjs tools/architecture-tokens/upload-index.spec.ts tools/architecture-tokens/extract-corpus.mjs
git commit -m "tools(architecture-tokens): upload the occurrence index to D1, replace-per-tenant-per-run"
```

---

### Task 5: Backend repository + service (join, as-user permission filter)

**Files:**
- Create: `functions/architecture-tokens/repository.ts`, `functions/architecture-tokens/service.ts`
- Test: `functions/architecture-tokens/repository.spec.ts`, `functions/architecture-tokens/service.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // repository.ts
  export interface OccurrenceRow { contentId: string; pageId: string; spaceId: string; contentVersion: number; actorId: string; rawLabel: string; comparisonKey: string; lineNumber: number; indexedAt: string }
  export async function occurrencesForContent(db: D1Database, cloudId: string, contentId: string): Promise<OccurrenceRow[]>
  export async function occurrencesForKeys(db: D1Database, cloudId: string, keys: string[]): Promise<OccurrenceRow[]>
  // service.ts
  export interface RelatedPage { contentId: string; pageId: string; pageTitle: string; spaceKey: string; rawLabelThere: string }
  export interface RelatedParticipant { actorId: string; rawLabel: string; related: RelatedPage[] }
  export interface RelatedResponse { indexedAt: string | null; contentVersion: number | null; participants: RelatedParticipant[]; error_kind?: string }
  export interface ConfluencePageInfo { id: string; title: string; spaceKey: string }
  export type PageResolver = (pageIds: string[]) => Promise<ConfluencePageInfo[]>   // as-user CQL, batched
  export function confluencePageResolver(apiBaseUrl: string, forgeOAuthUser: string, fetchImpl?: typeof fetch): PageResolver
  export async function relatedDiagrams(db: D1Database, cloudId: string, contentId: string, resolve: PageResolver): Promise<RelatedResponse>
  ```

- [ ] **Step 1: Write the failing repository test**

```ts
// functions/architecture-tokens/repository.spec.ts
import { describe, expect, it } from 'vitest';
import { occurrencesForContent, occurrencesForKeys } from './repository';

function fakeDb(rows: unknown[]) {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const db = { prepare(sql: string) { return { bind(...binds: unknown[]) { calls.push({ sql, binds }); return { all: async () => ({ results: rows }) }; } }; } } as unknown as D1Database;
  return { db, calls };
}

describe('repository', () => {
  it('occurrencesForContent scopes by cloudId and contentId', async () => {
    const { db, calls } = fakeDb([{ contentId: '10' }]);
    await occurrencesForContent(db, 'cid', '10');
    expect(calls[0].sql).toMatch(/WHERE cloudId = \?1 AND contentId = \?2/);
    expect(calls[0].binds).toEqual(['cid', '10']);
  });
  it('occurrencesForKeys binds every key and scopes by cloudId', async () => {
    const { db, calls } = fakeDb([]);
    await occurrencesForKeys(db, 'cid', ['a.b', 'c']);
    expect(calls[0].sql).toMatch(/comparisonKey IN \(\?2, \?3\)/);
    expect(calls[0].binds).toEqual(['cid', 'a.b', 'c']);
  });
  it('occurrencesForKeys with no keys makes no query', async () => {
    const { db, calls } = fakeDb([]);
    expect(await occurrencesForKeys(db, 'cid', [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`Cannot find module './repository'`).

- [ ] **Step 3: Implement the repository**

```ts
// functions/architecture-tokens/repository.ts
export interface OccurrenceRow {
  contentId: string; pageId: string; spaceId: string; contentVersion: number;
  actorId: string; rawLabel: string; comparisonKey: string; lineNumber: number; indexedAt: string;
}

const COLS = 'contentId, pageId, spaceId, contentVersion, actorId, rawLabel, comparisonKey, lineNumber, indexedAt';

export async function occurrencesForContent(db: D1Database, cloudId: string, contentId: string): Promise<OccurrenceRow[]> {
  const { results } = await db.prepare(`SELECT ${COLS} FROM ArchitectureTokenOccurrence WHERE cloudId = ?1 AND contentId = ?2`)
    .bind(cloudId, contentId).all<OccurrenceRow>();
  return results ?? [];
}

export async function occurrencesForKeys(db: D1Database, cloudId: string, keys: string[]): Promise<OccurrenceRow[]> {
  if (keys.length === 0) return [];
  const placeholders = keys.map((_, i) => `?${i + 2}`).join(', ');
  const { results } = await db.prepare(`SELECT ${COLS} FROM ArchitectureTokenOccurrence WHERE cloudId = ?1 AND comparisonKey IN (${placeholders})`)
    .bind(cloudId, ...keys).all<OccurrenceRow>();
  return results ?? [];
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Write the failing service test**

```ts
// functions/architecture-tokens/service.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { confluencePageResolver, relatedDiagrams } from './service';

const row = (o: Partial<any>) => ({ contentId: '1', pageId: '100', spaceId: '7', contentVersion: 1, actorId: 'PA', rawLabel: 'Partner App', comparisonKey: 'partner.app', lineNumber: 2, indexedAt: '2026-08-27T05:00:00Z', ...o });

function dbWith(byContent: any[], byKeys: any[]) {
  return { prepare(sql: string) { return { bind: () => ({ all: async () => ({ results: sql.includes('contentId = ?2') ? byContent : byKeys }) }) }; } } as unknown as D1Database;
}

describe('relatedDiagrams', () => {
  it('returns only pages the resolver (as-user) confirmed, excludes self, keeps the label used there', async () => {
    const db = dbWith(
      [row({}), row({ actorId: 'U', rawLabel: 'User', comparisonKey: 'user', lineNumber: 3 })],
      [row({}), row({ contentId: '2', pageId: '200', rawLabel: 'PartnerApp' }), row({ contentId: '3', pageId: '300', rawLabel: 'partner-app' }), row({ contentId: '4', pageId: '400', actorId: 'U', rawLabel: 'User', comparisonKey: 'user' })],
    );
    const resolve = vi.fn(async (ids: string[]) => ids.filter((id) => id !== '300').map((id) => ({ id, title: `Page ${id}`, spaceKey: id === '200' ? 'VPAY' : 'OP' })));
    const out = await relatedDiagrams(db, 'cid', '1', resolve);
    expect(resolve).toHaveBeenCalledWith(['200', '300', '400']);   // never the requesting page
    expect(out.indexedAt).toBe('2026-08-27T05:00:00Z');
    expect(out.contentVersion).toBe(1);
    expect(out.participants).toEqual([
      { actorId: 'PA', rawLabel: 'Partner App', related: [{ contentId: '2', pageId: '200', pageTitle: 'Page 200', spaceKey: 'VPAY', rawLabelThere: 'PartnerApp' }] },
      { actorId: 'U', rawLabel: 'User', related: [{ contentId: '4', pageId: '400', pageTitle: 'Page 400', spaceKey: 'OP', rawLabelThere: 'User' }] },
    ]);
  });
  it('unindexed diagram → empty participants, null indexedAt, no resolver call', async () => {
    const resolve = vi.fn();
    const out = await relatedDiagrams(dbWith([], []), 'cid', '9', resolve);
    expect(out).toEqual({ indexedAt: null, contentVersion: null, participants: [] });
    expect(resolve).not.toHaveBeenCalled();
  });
  it('resolver failure → participants empty with error_kind, never throws', async () => {
    const out = await relatedDiagrams(dbWith([row({})], [row({ contentId: '2', pageId: '200' })]), 'cid', '1', async () => { throw new Error('boom'); });
    expect(out.participants).toEqual([]);
    expect(out.error_kind).toBe('confluence_unavailable');
  });
});

describe('confluencePageResolver', () => {
  it('runs one CQL id-in search per 100 ids as the user and maps title + space key', async () => {
    const fetchImpl = vi.fn(async (url: string, init: any) => ({
      ok: true, status: 200,
      json: async () => ({ results: [{ content: { id: '200', title: 'T200', space: { key: 'VPAY' } } }] }),
    })) as unknown as typeof fetch;
    const resolve = confluencePageResolver('https://api.atlassian.com/ex/confluence/cid', 'user-token', fetchImpl);
    const pages = await resolve(Array.from({ length: 150 }, (_, i) => String(i)));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toMatch(/\/rest\/api\/search\?cql=/);
    expect(decodeURIComponent(url)).toContain('type = page AND id in (0,1,');
    expect(url).toContain('expand=content.space');
    expect(init.headers.Authorization).toBe('Bearer user-token');
    expect(pages).toEqual([{ id: '200', title: 'T200', spaceKey: 'VPAY' }, { id: '200', title: 'T200', spaceKey: 'VPAY' }]);
  });
  it('a non-2xx response throws', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, text: async () => 'no' })) as unknown as typeof fetch;
    await expect(confluencePageResolver('https://x', 't', fetchImpl)(['1'])).rejects.toThrow(/403/);
  });
});
```

- [ ] **Step 6: Run → FAIL** (`Cannot find module './service'`).

- [ ] **Step 7: Implement the service**

```ts
// functions/architecture-tokens/service.ts
import { occurrencesForContent, occurrencesForKeys, type OccurrenceRow } from './repository';

export interface RelatedPage { contentId: string; pageId: string; pageTitle: string; spaceKey: string; rawLabelThere: string }
export interface RelatedParticipant { actorId: string; rawLabel: string; related: RelatedPage[] }
export interface RelatedResponse { indexedAt: string | null; contentVersion: number | null; participants: RelatedParticipant[]; error_kind?: string }
export interface ConfluencePageInfo { id: string; title: string; spaceKey: string }
export type PageResolver = (pageIds: string[]) => Promise<ConfluencePageInfo[]>;

const CQL_BATCH = 100;

/**
 * Permission filter, as the requesting user: one CQL `id in (…)` per 100 ids.
 * Confluence returns only pages the bearer can read, with titles — nothing
 * about the others reaches the caller.
 */
export function confluencePageResolver(apiBaseUrl: string, forgeOAuthUser: string, fetchImpl: typeof fetch = fetch): PageResolver {
  return async (pageIds) => {
    const out: ConfluencePageInfo[] = [];
    for (let i = 0; i < pageIds.length; i += CQL_BATCH) {
      const ids = pageIds.slice(i, i + CQL_BATCH).map((id) => id.replace(/\D/g, '')).filter(Boolean);
      if (ids.length === 0) continue;
      const cql = `type = page AND id in (${ids.join(',')})`;
      const url = `${apiBaseUrl}/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${CQL_BATCH}&expand=content.space`;
      const res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${forgeOAuthUser}` } });
      if (!res.ok) throw new Error(`confluence search ${res.status}`);
      const body = await res.json() as { results?: Array<{ content?: { id?: string; title?: string; space?: { key?: string } } }> };
      for (const r of body.results ?? []) {
        if (r.content?.id) out.push({ id: String(r.content.id), title: r.content.title ?? '', spaceKey: r.content.space?.key ?? '' });
      }
    }
    return out;
  };
}

function byActor(rows: OccurrenceRow[]): Map<string, OccurrenceRow> {
  const m = new Map<string, OccurrenceRow>();
  for (const r of rows) if (!m.has(r.actorId)) m.set(r.actorId, r);   // first declaration wins
  return m;
}

export async function relatedDiagrams(db: D1Database, cloudId: string, contentId: string, resolve: PageResolver): Promise<RelatedResponse> {
  const own = await occurrencesForContent(db, cloudId, contentId);
  if (own.length === 0) return { indexedAt: null, contentVersion: null, participants: [] };
  const indexedAt = own[0].indexedAt;
  const contentVersion = own[0].contentVersion;
  const keys = [...new Set(own.map((o) => o.comparisonKey))];
  const candidates = (await occurrencesForKeys(db, cloudId, keys)).filter((c) => c.contentId !== contentId);
  const pageIds = [...new Set(candidates.map((c) => c.pageId))];
  let pages: Map<string, ConfluencePageInfo>;
  try {
    pages = new Map((await resolve(pageIds)).map((p) => [p.id, p]));
  } catch {
    return { indexedAt, contentVersion, participants: [], error_kind: 'confluence_unavailable' };
  }
  const participants: RelatedParticipant[] = [];
  for (const [actorId, o] of byActor(own)) {
    const seen = new Set<string>();
    const related: RelatedPage[] = [];
    for (const c of candidates) {
      if (c.comparisonKey !== o.comparisonKey || seen.has(c.contentId)) continue;
      const page = pages.get(c.pageId);
      if (!page) continue;          // not accessible to this user → not on the wire
      seen.add(c.contentId);
      related.push({ contentId: c.contentId, pageId: c.pageId, pageTitle: page.title, spaceKey: page.spaceKey, rawLabelThere: c.rawLabel });
    }
    participants.push({ actorId, rawLabel: o.rawLabel, related });
  }
  return { indexedAt, contentVersion, participants };
}
```

- [ ] **Step 8: Run → PASS**, then `pnpm exec eslint functions/architecture-tokens` clean, `tsc` shows no errors under `functions/architecture-tokens`.

- [ ] **Step 9: Commit**

```bash
git add functions/architecture-tokens
git commit -m "backend(architecture-tokens): related-diagrams join with the permission filter run as the requesting user"
```

---

### Task 6: The route, middleware entry, allowlist

**Files:**
- Create: `functions/api/architecture-tokens/related.ts`
- Modify: `functions/_middleware.ts:17` (add `'/api/architecture-tokens'` after `'/api/diagram-impact'`), `public/_routes.json:15` (add `"/api/architecture-tokens/*"` after `"/api/diagram-impact/*"`)
- Test: `functions/api/architecture-tokens/related.spec.ts`

**Interfaces:**
- Consumes: `relatedDiagrams`, `confluencePageResolver` (Task 5); `ForgeRequestData` (`functions/utils/authenticate.ts:213`); `OkResponse`, `response` (`functions/OkResponse.ts`).
- Produces: `GET /api/architecture-tokens/related?customContentId=<id>` → 200 `RelatedResponse` always (error cases carry `error_kind`); 405 on other methods; 400 on a missing/invalid id.

- [ ] **Step 1: Write the failing test**

```ts
// functions/api/architecture-tokens/related.spec.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../architecture-tokens/service', () => ({
  relatedDiagrams: vi.fn(async () => ({ indexedAt: 't', contentVersion: 1, participants: [] })),
  confluencePageResolver: vi.fn(() => async () => []),
}));
import { onRequest } from './related';
import { confluencePageResolver, relatedDiagrams } from '../../architecture-tokens/service';

const ctx = (url: string, extra: Partial<any> = {}) => ({
  request: new Request(url, { method: extra.method ?? 'GET', headers: { 'x-forge-oauth-user': 'tok' } }),
  env: { DB: {} },
  data: { forgeContext: { cloudId: 'cid', apiBaseUrl: 'https://api.atlassian.com/ex/confluence/cid' } },
} as any);

describe('GET /api/architecture-tokens/related', () => {
  it('scopes by the authenticated cloudId and resolves pages as the user', async () => {
    const res = await onRequest(ctx('https://x/api/architecture-tokens/related?customContentId=42'));
    expect(res.status).toBe(200);
    expect(relatedDiagrams).toHaveBeenCalledWith({}, 'cid', '42', expect.any(Function));
    expect(confluencePageResolver).toHaveBeenCalledWith('https://api.atlassian.com/ex/confluence/cid', 'tok');
    expect(await res.json()).toEqual({ indexedAt: 't', contentVersion: 1, participants: [] });
  });
  it('rejects a non-numeric id', async () => {
    const res = await onRequest(ctx('https://x/api/architecture-tokens/related?customContentId=abc'));
    expect(res.status).toBe(400);
  });
  it('405 on POST', async () => {
    const res = await onRequest(ctx('https://x/api/architecture-tokens/related?customContentId=1', { method: 'POST' }));
    expect(res.status).toBe(405);
  });
  it('missing forge context → 401', async () => {
    const c = ctx('https://x/api/architecture-tokens/related?customContentId=1'); c.data = {};
    expect((await onRequest(c)).status).toBe(401);
  });
  it('service throw → 200 with error_kind, never 500', async () => {
    (relatedDiagrams as any).mockRejectedValueOnce(new Error('d1 down'));
    const res = await onRequest(ctx('https://x/api/architecture-tokens/related?customContentId=1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ indexedAt: null, contentVersion: null, participants: [], error_kind: 'lookup_failed' });
  });
});
```

- [ ] **Step 2: Run → FAIL** (`Cannot find module './related'`).

- [ ] **Step 3: Implement the route and register it**

```ts
// functions/api/architecture-tokens/related.ts
import { OkResponse, response } from '../../OkResponse';
import type { ForgeRequestData } from '../../utils/authenticate';
import { confluencePageResolver, relatedDiagrams } from '../../architecture-tokens/service';

interface Env { DB: D1Database }

// Always 2xx for lookup failures: the viewer stays silent and records
// error_kind; a 5xx would surface as a console error on every render.
export const onRequest = async ({ request, env, data }: { request: Request; env: Env; data: ForgeRequestData }): Promise<Response> => {
  if (request.method !== 'GET') return response(405, 'method_not_allowed');
  const cloudId = data.forgeContext?.cloudId;
  const apiBaseUrl = data.forgeContext?.apiBaseUrl;
  const user = request.headers.get('x-forge-oauth-user');
  if (!cloudId || !apiBaseUrl || !user) return response(401, 'forge_context_missing');
  const id = new URL(request.url).searchParams.get('customContentId') ?? '';
  if (!/^\d{1,20}$/.test(id)) return response(400, 'invalid_custom_content_id');
  try {
    return OkResponse(await relatedDiagrams(env.DB, cloudId, id, confluencePageResolver(apiBaseUrl, user)));
  } catch (e) {
    console.error('architecture-tokens related lookup failed', e);
    return OkResponse({ indexedAt: null, contentVersion: null, participants: [], error_kind: 'lookup_failed' });
  }
};
```

`functions/_middleware.ts` — add `'/api/architecture-tokens',` on the line after `'/api/diagram-impact',`.
`public/_routes.json` — add `"/api/architecture-tokens/*",` on the line after `"/api/diagram-impact/*",`.

- [ ] **Step 4: Run → PASS**; `pnpm vitest --run functions/_middleware.spec.ts` still passes; eslint clean.

- [ ] **Step 5: Commit**

```bash
git add functions/api/architecture-tokens functions/_middleware.ts public/_routes.json
git commit -m "backend(architecture-tokens): GET /api/architecture-tokens/related — authenticated, tenant-scoped, silent on failure"
```

---

### Task 7: Frontend service + flag read

**Files:**
- Create: `src/services/ArchitectureTokens.ts`
- Modify: `src/apis/aiTitleFeatureFlag.ts:77` (add `isArchitectureTokensEnabled` next to `isAgentLinkEnabled`)
- Test: `src/services/ArchitectureTokens.spec.ts`, `src/apis/aiTitleFeatureFlag.spec.ts` (add one case)

**Interfaces:**
- Produces:
  ```ts
  export interface RelatedPage { contentId: string; pageId: string; pageTitle: string; spaceKey: string; rawLabelThere: string }
  export interface RelatedParticipant { actorId: string; rawLabel: string; related: RelatedPage[] }
  export interface RelatedResponse { indexedAt: string | null; contentVersion: number | null; participants: RelatedParticipant[]; error_kind?: string }
  export async function getRelatedDiagrams(customContentId: string, timeoutMs = 8000): Promise<RelatedResponse>
  export async function isArchitectureTokensEnabled(): Promise<boolean>   // in aiTitleFeatureFlag.ts
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/ArchitectureTokens.spec.ts
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }));
import { callRemote } from '@/utils/requestUtil';
import { getRelatedDiagrams } from './ArchitectureTokens';

describe('getRelatedDiagrams', () => {
  it('GETs the related route with the encoded id', async () => {
    (callRemote as any).mockResolvedValueOnce({ indexedAt: null, contentVersion: null, participants: [] });
    await getRelatedDiagrams('42');
    expect(callRemote).toHaveBeenCalledWith('/api/architecture-tokens/related?customContentId=42', 'GET');
  });
  it('times out into a rejected promise tagged timeout', async () => {
    (callRemote as any).mockImplementationOnce(() => new Promise(() => {}));
    await expect(getRelatedDiagrams('42', 10)).rejects.toMatchObject({ kind: 'timeout' });
  });
});
```

Add to `src/apis/aiTitleFeatureFlag.spec.ts` (follow the file's existing mocking of `@forge/bridge`; the existing tests show the pattern):

```ts
it('isArchitectureTokensEnabled checks the flag with default false', async () => {
  checkFlag.mockResolvedValueOnce(true);
  await expect(isArchitectureTokensEnabled()).resolves.toBe(true);
  expect(checkFlag).toHaveBeenCalledWith('architecture-tokens-enabled', false);
});
```

- [ ] **Step 2: Run → FAIL** (module missing / export missing).

- [ ] **Step 3: Implement**

```ts
// src/services/ArchitectureTokens.ts
import { callRemote } from '@/utils/requestUtil';

export interface RelatedPage { contentId: string; pageId: string; pageTitle: string; spaceKey: string; rawLabelThere: string }
export interface RelatedParticipant { actorId: string; rawLabel: string; related: RelatedPage[] }
export interface RelatedResponse { indexedAt: string | null; contentVersion: number | null; participants: RelatedParticipant[]; error_kind?: string }

export class RelatedLookupError extends Error {
  constructor(public readonly kind: 'timeout' | 'network') { super(kind); }
}

export async function getRelatedDiagrams(customContentId: string, timeoutMs = 8000): Promise<RelatedResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new RelatedLookupError('timeout')), timeoutMs); });
  try {
    return await Promise.race([
      callRemote(`/api/architecture-tokens/related?customContentId=${encodeURIComponent(customContentId)}`, 'GET'),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
```

`src/apis/aiTitleFeatureFlag.ts` — after `isAgentLinkEnabled`:

```ts
const ARCHITECTURE_TOKENS_FLAG_ID = 'architecture-tokens-enabled'

/** Viewer "also appears in other diagrams" context. Pilot-tenant rule in prod; default false. */
export async function isArchitectureTokensEnabled(): Promise<boolean> {
  if (!forgeGlobal.isForge) return false
  const client = await getFeatureFlagsClient()
  return client.checkFlag(ARCHITECTURE_TOKENS_FLAG_ID, false)
}
```

- [ ] **Step 4: Run both specs → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/services/ArchitectureTokens.ts src/services/ArchitectureTokens.spec.ts src/apis/aiTitleFeatureFlag.ts src/apis/aiTitleFeatureFlag.spec.ts
git commit -m "viewer(architecture-tokens): related-diagrams client with timeout, and the architecture-tokens-enabled flag read"
```

---

### Task 8: `RelatedDiagramsFooter.vue` — footer line, lifeline popover, events

**Files:**
- Create: `src/components/Viewer/RelatedDiagramsFooter.vue`
- Test: `src/components/Viewer/RelatedDiagramsFooter.spec.ts`

**Interfaces:**
- Consumes: `getRelatedDiagrams`, `RelatedResponse` (Task 7); `trackAnalyticsEvent` (`@/utils/analytics/trackAnalyticsEvent`); `openUrl` (`@/model/globals/forgeGlobal`); the rendered SVG container element passed as a prop.
- Props: `{ customContentId: string; ready: boolean; surface: 'viewer' | 'fullscreen'; svgHost: () => HTMLElement | null; enabled: boolean; pageId?: string }`.
- Behaviour: when `ready && enabled` becomes true, call once; on ≥1 participant with related, render the footer; attach delegated `mouseover`/`click` on `svgHost()` for `[name]` actor elements; popover with title *Possibly related by name*.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/Viewer/RelatedDiagramsFooter.spec.ts
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const related = { value: null as any };
vi.mock('@/services/ArchitectureTokens', () => ({
  getRelatedDiagrams: vi.fn(async () => related.value),
  RelatedLookupError: class extends Error { constructor(public kind: string) { super(kind); } },
}));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));
vi.mock('@/model/globals/forgeGlobal', () => ({ openUrl: vi.fn(), default: { forgeContext: { siteUrl: 'https://example.atlassian.net' } } }));
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { openUrl } from '@/model/globals/forgeGlobal';
import RelatedDiagramsFooter from './RelatedDiagramsFooter.vue';

function host(): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = '<svg><g class="actor" name="PA"><rect class="actor" name="PA"></rect><text name="PA">Partner App</text></g><g class="actor" name="U"><rect name="U"></rect></g></svg>';
  document.body.appendChild(div);
  return div;
}

const twoParticipants = {
  indexedAt: new Date(Date.now() - 3 * 864e5).toISOString(), contentVersion: 1,
  participants: [
    { actorId: 'PA', rawLabel: 'Partner App', related: [
      { contentId: '2', pageId: '200', pageTitle: 'Checkout', spaceKey: 'VPAY', rawLabelThere: 'PartnerApp' },
      { contentId: '3', pageId: '300', pageTitle: 'Refunds', spaceKey: 'VPAY', rawLabelThere: 'Partner App' },
    ] },
    { actorId: 'U', rawLabel: 'User', related: [] },
  ],
};

function mountFooter(props: Partial<any> = {}) {
  const h = host();
  return { h, w: mount(RelatedDiagramsFooter, { props: { customContentId: '1', ready: true, enabled: true, surface: 'viewer', svgHost: () => h, ...props } }) };
}

beforeEach(() => { vi.clearAllMocks(); document.body.innerHTML = ''; });

describe('RelatedDiagramsFooter', () => {
  it('renders the footer line with counts and "as of" when at least one participant has related pages', async () => {
    related.value = twoParticipants;
    const { w } = mountFooter();
    await flushPromises();
    expect(w.text()).toContain('1 of 2 participants also appear in other diagrams you can access');
    expect(w.text()).toMatch(/as of \d{1,2} \w{3}/);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('related_diagrams_lookup_succeeded', expect.objectContaining({ feature_area: 'architecture_tokens', surface: 'viewer', macro_type: 'mermaid', participant_count: 2, participants_with_related: 1, related_pages_total: 2, index_age_days: 3 }));
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('related_diagrams_shown', expect.objectContaining({ participants_with_related: 1 }));
  });

  it('renders nothing and fires only lookup_succeeded when no participant has related pages', async () => {
    related.value = { ...twoParticipants, participants: [{ actorId: 'PA', rawLabel: 'Partner App', related: [] }] };
    const { w } = mountFooter();
    await flushPromises();
    expect(w.find('[data-testid="related-diagrams-footer"]').exists()).toBe(false);
    expect(trackAnalyticsEvent).toHaveBeenCalledTimes(1);
  });

  it('does not call the service when disabled or not ready', async () => {
    related.value = twoParticipants;
    const { getRelatedDiagrams } = await import('@/services/ArchitectureTokens');
    mountFooter({ enabled: false }); await flushPromises();
    mountFooter({ ready: false }); await flushPromises();
    expect(getRelatedDiagrams).not.toHaveBeenCalled();
  });

  it('opens the popover on hover of a lifeline with related pages, lists title, space, and the variant label', async () => {
    related.value = twoParticipants;
    const { w, h } = mountFooter();
    await flushPromises();
    h.querySelector('rect[name="PA"]')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await flushPromises();
    const pop = w.find('[data-testid="related-diagrams-popover"]');
    expect(pop.exists()).toBe(true);
    expect(pop.text()).toContain('Possibly related by name');
    expect(pop.text()).toContain('Checkout');
    expect(pop.text()).toContain('VPAY');
    expect(pop.text()).toContain('as PartnerApp');
    expect(pop.text()).not.toContain('as Partner App');   // same label → no variant note
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('related_diagram_popover_opened', expect.objectContaining({ related_count: 2, popover_trigger: 'hover', label_variant_count: 2 }));
  });

  it('ignores lifelines without related pages', async () => {
    related.value = twoParticipants;
    const { w, h } = mountFooter();
    await flushPromises();
    h.querySelector('rect[name="U"]')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await flushPromises();
    expect(w.find('[data-testid="related-diagrams-popover"]').exists()).toBe(false);
  });

  it('link click opens the page through openUrl and records same_space', async () => {
    related.value = twoParticipants;
    const { w, h } = mountFooter({ pageId: '999' });
    await flushPromises();
    h.querySelector('rect[name="PA"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    await w.find('[data-testid="related-diagram-link"]').trigger('click');
    expect(openUrl).toHaveBeenCalledWith('https://example.atlassian.net/wiki/pages/viewpage.action?pageId=200');
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('related_diagram_link_clicked', expect.objectContaining({ related_count: 2, same_space: false }));
  });

  it('service failure → nothing rendered, lookup_failed with error_kind', async () => {
    const { getRelatedDiagrams, RelatedLookupError } = await import('@/services/ArchitectureTokens');
    (getRelatedDiagrams as any).mockRejectedValueOnce(new (RelatedLookupError as any)('timeout'));
    const { w } = mountFooter();
    await flushPromises();
    expect(w.find('[data-testid="related-diagrams-footer"]').exists()).toBe(false);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('related_diagrams_lookup_failed', expect.objectContaining({ error_kind: 'timeout' }));
  });

  it('body error_kind → lookup_failed, nothing rendered', async () => {
    related.value = { indexedAt: null, contentVersion: null, participants: [], error_kind: 'confluence_unavailable' };
    mountFooter(); await flushPromises();
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('related_diagrams_lookup_failed', expect.objectContaining({ error_kind: 'confluence_unavailable' }));
  });
});
```

- [ ] **Step 2: Run → FAIL** (`Cannot find module './RelatedDiagramsFooter.vue'`).

- [ ] **Step 3: Implement the component**

```vue
<template>
  <footer v-if="withRelated.length" ref="root" class="related-diagrams" data-testid="related-diagrams-footer">
    <span>{{ withRelated.length }} of {{ participants.length }} participants also appear in other diagrams you can access</span>
    <span v-if="asOf"> · as of {{ asOf }}</span>
    <div v-if="open" class="related-diagrams-popover" data-testid="related-diagrams-popover" role="dialog" aria-label="Possibly related by name" @mouseleave="close">
      <div class="related-diagrams-popover-title">Possibly related by name</div>
      <div class="related-diagrams-popover-label">{{ open.rawLabel }}</div>
      <ul>
        <li v-for="r in open.related" :key="r.contentId">
          <a href="#" data-testid="related-diagram-link" @click.prevent="follow(open, r)">{{ r.pageTitle }}</a>
          <span class="related-diagrams-space"> ({{ r.spaceKey }})</span>
          <span v-if="r.rawLabelThere !== open.rawLabel" class="related-diagrams-variant"> · as <code>{{ r.rawLabelThere }}</code></span>
        </li>
      </ul>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import forgeGlobal, { openUrl } from '@/model/globals/forgeGlobal';
import { getRelatedDiagrams, RelatedLookupError, type RelatedParticipant, type RelatedResponse } from '@/services/ArchitectureTokens';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

const props = defineProps<{
  customContentId: string;
  ready: boolean;
  enabled: boolean;
  surface: 'viewer' | 'fullscreen';
  svgHost: () => HTMLElement | null;
  pageId?: string;
}>();

const participants = ref<RelatedParticipant[]>([]);
const indexedAt = ref<string | null>(null);
const open = ref<RelatedParticipant | null>(null);
const root = ref<HTMLElement>();
let requested = false;
let host: HTMLElement | null = null;

const withRelated = computed(() => participants.value.filter((p) => p.related.length > 0));
const byActor = computed(() => new Map(withRelated.value.map((p) => [p.actorId, p])));
const asOf = computed(() => indexedAt.value ? new Date(indexedAt.value).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '');

const base = () => ({ feature_area: 'architecture_tokens' as const, surface: props.surface, macro_type: 'mermaid' as const });
const counts = () => ({
  participant_count: participants.value.length,
  participants_with_related: withRelated.value.length,
  related_pages_total: withRelated.value.reduce((n, p) => n + p.related.length, 0),
  index_age_days: indexedAt.value ? Math.floor((Date.now() - new Date(indexedAt.value).getTime()) / 864e5) : undefined,
});

async function load() {
  if (requested || !props.enabled || !props.ready) return;
  requested = true;
  const started = performance.now();
  let res: RelatedResponse;
  try {
    res = await getRelatedDiagrams(props.customContentId);
  } catch (e) {
    trackAnalyticsEvent('related_diagrams_lookup_failed', { ...base(), error_kind: e instanceof RelatedLookupError ? e.kind : 'network', duration_ms: Math.round(performance.now() - started) });
    return;
  }
  if (res.error_kind) {
    trackAnalyticsEvent('related_diagrams_lookup_failed', { ...base(), error_kind: res.error_kind, duration_ms: Math.round(performance.now() - started) });
    return;
  }
  // Drop participants that no longer exist in the rendered SVG (renamed since indexing).
  host = props.svgHost();
  const present = new Set([...(host?.querySelectorAll('[name]') ?? [])].map((el) => el.getAttribute('name')));
  participants.value = res.participants.filter((p) => present.size === 0 || present.has(p.actorId));
  indexedAt.value = res.indexedAt;
  trackAnalyticsEvent('related_diagrams_lookup_succeeded', { ...base(), ...counts(), duration_ms: Math.round(performance.now() - started) });
  if (withRelated.value.length) {
    trackAnalyticsEvent('related_diagrams_shown', { ...base(), ...counts() });
    attach();
  }
}

function actorFromEvent(e: Event): RelatedParticipant | null {
  const el = (e.target as Element | null)?.closest?.('[name]');
  const id = el?.getAttribute('name');
  return id ? byActor.value.get(id) ?? null : null;
}

function show(p: RelatedParticipant, trigger: 'hover' | 'click') {
  if (open.value === p) return;
  open.value = p;
  trackAnalyticsEvent('related_diagram_popover_opened', {
    ...base(), related_count: p.related.length, popover_trigger: trigger,
    label_variant_count: new Set(p.related.map((r) => r.rawLabelThere)).size,
  });
}
const onOver = (e: Event) => { const p = actorFromEvent(e); if (p) show(p, 'hover'); };
const onClick = (e: Event) => { const p = actorFromEvent(e); if (p) show(p, 'click'); };
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
function close() { open.value = null; }

function attach() {
  if (!host) return;
  host.addEventListener('mouseover', onOver);
  host.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
}
function detach() {
  host?.removeEventListener('mouseover', onOver);
  host?.removeEventListener('click', onClick);
  document.removeEventListener('keydown', onKey);
}

function follow(p: RelatedParticipant, r: { pageId: string; spaceKey: string }) {
  trackAnalyticsEvent('related_diagram_link_clicked', { ...base(), related_count: p.related.length, same_space: props.pageId ? r.spaceKey === currentSpaceKey() : false });
  const site = (forgeGlobal as any)?.forgeContext?.siteUrl ?? '';
  void openUrl(`${site}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(r.pageId)}`);
}
function currentSpaceKey(): string { return (forgeGlobal as any)?.forgeContext?.extension?.space?.key ?? ''; }

onMounted(load);
watch(() => [props.ready, props.enabled], load);
onBeforeUnmount(detach);
</script>

<style scoped>
.related-diagrams { position: relative; margin-top: 4px; font-size: 12px; color: var(--ds-text-subtlest, #626f86); }
.related-diagrams-popover { position: absolute; left: 0; bottom: 100%; z-index: 20; min-width: 260px; max-width: 420px; padding: 8px 10px; background: var(--ds-surface-overlay, #fff); border-radius: 3px; box-shadow: var(--ds-shadow-overlay, 0 4px 8px rgba(9,30,66,.25)); color: var(--ds-text, #172b4d); }
.related-diagrams-popover-title { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--ds-text-subtlest, #626f86); }
.related-diagrams-popover-label { font-weight: 600; margin: 2px 0 6px; }
.related-diagrams-popover ul { list-style: none; margin: 0; padding: 0; }
.related-diagrams-popover li { margin: 2px 0; }
.related-diagrams-space, .related-diagrams-variant { color: var(--ds-text-subtlest, #626f86); }
</style>
```

Note on `siteUrl`: confirm the property name in `src/model/globals/forgeGlobal.ts` (grep `siteUrl`); if the context exposes it under another name (e.g. `forgeContext.siteUrl` vs `forgeGlobal.siteUrl`), use that one and update the test mock accordingly.

- [ ] **Step 4: Run → PASS**; eslint clean; `tsc` shows no new errors under `src/components/Viewer/RelatedDiagramsFooter*`.

- [ ] **Step 5: Commit**

```bash
git add src/components/Viewer/RelatedDiagramsFooter.vue src/components/Viewer/RelatedDiagramsFooter.spec.ts
git commit -m "viewer(architecture-tokens): footer line + lifeline popover — 'also appears in other diagrams you can access'"
```

---

### Task 9: Mount in `GenericViewer.vue`

**Files:**
- Modify: `src/components/Viewer/GenericViewer.vue:262-267` (after `<DiagramAttributionFooter …/>`), `:390-460` (import + component registration), `data()` (add `architectureTokensEnabled: false`), `mounted()` / `created()` (flag read)
- Test: `src/components/Viewer/GenericViewer.spec.ts` (add one case)

**Interfaces:**
- Consumes: `RelatedDiagramsFooter` (Task 8), `isArchitectureTokensEnabled` (Task 7), `getForgeCustomContentId` (`@/utils/viewerLoadOutcome`), existing `diagramType`, `diagram`, `viewerLoadState`, `isFullscreenMode`, `getCaptureNode()`.

- [ ] **Step 1: Write the failing test** (add to `GenericViewer.spec.ts`, following its existing store/mount setup)

```ts
it('mounts RelatedDiagramsFooter only for a Mermaid sequence diagram when the flag is on', async () => {
  vi.mocked(isArchitectureTokensEnabled).mockResolvedValue(true);
  const wrapper = mountViewer({ diagramType: 'mermaid', mermaidCode: 'sequenceDiagram\n participant A', viewerLoadState: 'ready' });
  await flushPromises();
  expect(wrapper.findComponent({ name: 'RelatedDiagramsFooter' }).exists()).toBe(true);
  const flow = mountViewer({ diagramType: 'mermaid', mermaidCode: 'flowchart TD\n A-->B', viewerLoadState: 'ready' });
  await flushPromises();
  expect(flow.findComponent({ name: 'RelatedDiagramsFooter' }).exists()).toBe(false);
});
```
(`mountViewer` is whatever helper the spec already uses to mount with a Vuex store; mock `@/apis/aiTitleFeatureFlag` at the top of the file alongside its existing mocks.)

- [ ] **Step 2: Run → FAIL** (component not found).

- [ ] **Step 3: Implement**

Template, after `<DiagramAttributionFooter … />`:

```html
<RelatedDiagramsFooter
  v-if="!isLoadFailed && showRelatedDiagrams"
  :custom-content-id="relatedCustomContentId"
  :ready="viewerLoadState === 'ready'"
  :enabled="architectureTokensEnabled"
  :surface="isFullscreenMode ? 'fullscreen' : 'viewer'"
  :svg-host="getCaptureNode"
  :page-id="currentPageId"
/>
```

Script additions:

```ts
import RelatedDiagramsFooter from '@/components/Viewer/RelatedDiagramsFooter.vue'
import { isArchitectureTokensEnabled } from '@/apis/aiTitleFeatureFlag'
// components: { …, RelatedDiagramsFooter },
// data(): architectureTokensEnabled: false,
// computed:
showRelatedDiagrams() {
  return this.diagramType === 'mermaid'
    && /^\s*(?:---[\s\S]*?---\s*)?(?:%%[^\n]*\n\s*)*sequenceDiagram(?:\s|$)/.test(this.diagram?.mermaidCode ?? '')
    && !!this.relatedCustomContentId;
},
relatedCustomContentId() { return getForgeCustomContentId() ?? this.diagramAttribution?.customContentId ?? ''; },
currentPageId() { return window.forgeGlobal?.forgeContext?.extension?.content?.id ?? undefined; },
// created():
isArchitectureTokensEnabled().then((on) => { this.architectureTokensEnabled = on; }).catch(() => { /* default off */ });
```

- [ ] **Step 4: Run the GenericViewer spec → PASS**; run `pnpm vitest --run src/components/Viewer` → all green; eslint clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/Viewer/GenericViewer.vue src/components/Viewer/GenericViewer.spec.ts
git commit -m "viewer(architecture-tokens): mount the related-diagrams footer for Mermaid sequence diagrams behind the flag"
```

---

### Task 10: Docs, local end-to-end proof, PR

**Files:**
- Modify: `tools/architecture-tokens/README.md` (tenant-wide + upload steps), `docs/analytics/events-catalog.md` (five events)
- Verification artifacts: screenshots + captured events saved under `$ARCHTOK_DIR/verification/` (outside the repo)

- [ ] **Step 1: README — replace the *Run* section**

```bash
# 0. ARCHTOK_DIR = private/local-data/architecture-tokens/<pilot>  (git-ignored; holds cloud-id)
# 1. corpus, tenant-wide
node --experimental-strip-types tools/architecture-tokens/read-corpus.mjs --client-domain <domain> --out $ARCHTOK_DIR/raw/corpus-$(date +%F).json
# 2. occurrences
node --experimental-strip-types tools/architecture-tokens/extract-corpus.mjs --corpus $ARCHTOK_DIR/raw/corpus-$(date +%F).json --out $ARCHTOK_DIR/participant-occurrences-$(date +%F).json
# 3. upload (replaces the tenant's rows in D1)
node --experimental-strip-types tools/architecture-tokens/upload-index.mjs --artifact $ARCHTOK_DIR/participant-occurrences-$(date +%F).json --cloud-id-file $ARCHTOK_DIR/cloud-id
# 4. tests
pnpm vitest --run tools/architecture-tokens functions/architecture-tokens functions/api/architecture-tokens src/components/Viewer/RelatedDiagramsFooter.spec.ts
```
Cadence line: "Manual: weekly (Monday morning AEST) and on demand. The viewer shows 'as of <date>'."

- [ ] **Step 2: events-catalog.md — add a section** listing the five events with trigger and properties exactly as in the spec §8.

- [ ] **Step 3: Local end-to-end on lite-dev** (flag rule 1 covers development; the dev site's own diagrams form the corpus)

```bash
# corpus from the dev site's space(s): use --space-id with the dev space's numeric id and the Lite app id
node --experimental-strip-types tools/architecture-tokens/read-corpus.mjs --space-id <dev-space-id> --app-id 8ad26115-211f-4216-971b-0540f606303d --out $ARCHTOK_DIR/raw/corpus-litedev.json
# … extract, then upload to the LOCAL D1 (wrangler --local) used by `pnpm start:sit`, or to conf-zenuml-dev with --remote if the tunnel backend points there
```
Then, with the forge-tunnel skill (`--profile "Profile 8"`), open a lite-dev page holding two sequence diagrams that share a participant label, and capture:
1. screenshot of the footer line under the diagram;
2. screenshot of the popover after hovering the shared lifeline;
3. the five events from the iframe's Mixpanel `/track/` POSTs (pattern in `.claude/skills/forge-feature-flag/SKILL.md`, *Runtime verification*): `related_diagrams_lookup_succeeded`, `related_diagrams_shown`, `related_diagram_popover_opened`, `related_diagram_link_clicked`, and `related_diagrams_lookup_failed` (force it once by pointing `customContentId` at a non-numeric id in DevTools).
Save all under `$ARCHTOK_DIR/verification/`. A page with a `flowchart` must show nothing.

- [ ] **Step 4: Commit docs, then open the PR**

```bash
git add tools/architecture-tokens/README.md docs/analytics/events-catalog.md
git commit -m "docs(architecture-tokens): tenant-wide pipeline, upload, cadence, and the five viewer events"
```
Then `/submit-branch`. PR title: `feat(viewer): "also appears in other diagrams" context for Mermaid sequence participants — pilot tenant, flag-gated`. The PR body states: no manifest change, no Forge function, flag default false, production rule targets one site, migration 0021 applied by CI.

- [ ] **Step 5: After merge → release → verify in production**

Release Lite (`/release-app lite`), then: upload the tenant index to `conf-zenuml-prod` (Task 4 step 4, real run), then confirm from Mixpanel within a day: `related_diagrams_lookup_succeeded` events with the released `app_version` and the pilot tenant's `client_domain`; `related_diagrams_shown` > 0. No page on the pilot site can be opened by us — Mixpanel is the runtime evidence.

---

## Self-review

- **Spec coverage:** §1 UI → Tasks 8–9; §2 layers → normalizer unchanged, `actorId` never a key (service joins on `comparisonKey` only); §3 pipeline → Tasks 3–4; §4 table → Task 2; §5 route + backend filter → Tasks 5–6; §6 flag → Task 7 + 9; §7 UI details (name attribute, drop renamed, openUrl, Escape) → Task 8; §8 events → Tasks 1, 8; §9 privacy → global constraints, `$ARCHTOK_DIR` everywhere; §10 out of scope → nothing planned for editor/discovery/decisions; §11 verification → Task 10.
- **Placeholder scan:** none of "TBD/TODO/handle edge cases/similar to Task N". One explicit verification instruction (`siteUrl` property name) is a check, not a placeholder.
- **Type consistency:** `RelatedPage/RelatedParticipant/RelatedResponse` identical in `functions/architecture-tokens/service.ts` and `src/services/ArchitectureTokens.ts`; `isArchitectureTokensEnabled` name used in Tasks 7 and 9; `getCaptureNode` (existing method) passed as `svgHost`; `surface` values `'viewer' | 'fullscreen'` match the `Surface` union; property names in Task 1 match those emitted in Task 8 (`popover_trigger`, `label_variant_count`, `same_space`, `index_age_days`, `error_kind`).
