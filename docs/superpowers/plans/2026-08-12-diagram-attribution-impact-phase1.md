# Diagram attribution and audience impact — Phase 1 implementation plan

> **Historical plan:** The audience identity implementation in this plan was
> superseded by [2026-08-13-remove-diagram-audience-hmac-design.md](../specs/2026-08-13-remove-diagram-audience-hmac-design.md),
> which stores the trusted account ID directly and removes the HMAC secret.

> **Scope:** Implement only the approved Phase 1 public footer and lifetime unique-colleague count. Phase 2 private insights, trends, milestones, and every reaction/Like/Kudos mechanic remain out of scope.

**Goal:** Add a quiet footer to every standard diagram viewer:

> Created by Peng · Last updated by Alice · 23 colleagues viewed

The creator/updater fields come from Confluence. The count comes from the existing D1 database and includes only lifetime-unique, non-contributor colleagues whose successfully rendered diagram remained visible and intersecting for three continuous seconds.

**Architecture:** Carry creator/updater account IDs from the already-loaded V2 custom-content wrapper into an ephemeral Vuex control-plane field; resolve at most two visible names with Confluence's user bulk endpoint; load and register aggregate impact through two authenticated Cloudflare Pages functions; store only an HMAC-derived passive viewer key in the existing `DB` binding. A dedicated footer component and injected, testable qualification controller own all asynchronous behavior. Diagram render/edit/export never waits on impact data.

**Tech stack:** Vue 3 + Vuex + TypeScript, Forge Custom UI (`requestConfluence`, `invokeRemote`), Cloudflare Pages Functions, D1, Web Crypto HMAC-SHA256, Vitest, Storybook, Playwright.

**Approved design:** `docs/superpowers/specs/2026-08-12-diagram-attribution-impact-design.md`

## Frozen decisions

- No Owner model. Use V2 `authorId` for `Created by` and `version.authorId` for `Last updated by`.
- Hide `Last updated by` when it is the same account as the creator.
- Hide zero/failed audience counts and independently unresolvable people.
- No passive viewer names, no raw passive account IDs in D1, APIs, or logs.
- Contributors may view the count but do not increment it. The authoritative set is created/current authors plus authors already mirrored in `CustomContentVersion`; no history backfill.
- A qualifying view requires successful render + visible document + viewport intersection continuously for 3,000 ms. Leaving either state resets the timer. One iframe attempts registration at most once.
- Use the existing `env.DB`; no new D1 database, binding, KV, R2, Redis/Upstash, Durable Object, or third-party processor.
- No summary table in Phase 1.
- No feature flag. Safety comes from backend-first deployment and fail-soft frontend behavior.
- The footer is outside `.screen-capture-content`, present in page and fullscreen viewers, and absent from editors, previews, exports, failed renders, and `hideHeader` hosts.
- Likes/Kudos/reactions are not part of this feature.

## Repository facts the implementation must preserve

- The next D1 migration number is `0018`; `0015`–`0017` already exist. Re-check immediately before implementation and renumber if another migration lands first.
- CI applies `functions/migrations` to the shared staging/production D1 before publishing Pages (`.github/actions/wrangler-publish/action.yml`).
- Both Pages variants use the same D1 in an environment, but they are separate Pages projects. The HMAC secret must be identical on `conf-stg-lite` and `conf-stg-full`, and identical on `conf-lite` and `conf-full`.
- Diagramly and AsyncAPI use the Lite backend project; `forgeAppId` still separates app identities in the table.
- `public/_routes.json` is an allowlist. Missing entries return SPA HTML instead of executing a function.
- `functions/_middleware.ts` populates authenticated `cloudId`, `accountId`, `apiBaseUrl`, and `forgeAppId`; the user OAuth token arrives only in `x-forge-oauth-user`.
- `Diagram` is persisted. Impact/attribution state must remain outside it, matching the existing `publishBlock` control-plane precedent in `RootState`.
- Sequence-family loading lives in `src/forgeIndex.ts`; Graph and Embed use `bootstrapForgeViewer`; OpenAPI uses `openDocument` plus `bootstrapForgeViewer`; page-rendered AsyncAPI has a separate direct mount path.
- SWR cache hits may paint before the live custom-content wrapper arrives. Attribution may appear when revalidation completes; it must never block the cached render.
- The official Confluence V1 user API supports `GET /wiki/rest/api/user/bulk?accountId=...`, returns display names/profile data subject to profile visibility, accepts up to 100 IDs, and requires the already-present `read:confluence-user` scope: <https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-users/#api-wiki-rest-api-user-bulk-get>.

## Planned file structure

### Analytics

- Modify `src/utils/analytics/catalog.ts`
- Modify `src/utils/analytics/types.ts`

### Backend

- Create `functions/migrations/0018_add_diagram_audience.sql`
- Create `functions/diagram-impact/domain.ts`
- Create `functions/diagram-impact/domain.spec.ts`
- Create `functions/diagram-impact/repository.ts`
- Create `functions/diagram-impact/repository.spec.ts`
- Create `functions/diagram-impact/service.ts`
- Create `functions/diagram-impact/service.spec.ts`
- Create `functions/api/diagram-impact/index.ts`
- Create `functions/api/diagram-impact/index.spec.ts`
- Create `functions/api/diagram-impact/view.ts`
- Create `functions/api/diagram-impact/view.spec.ts`
- Modify `functions/_middleware.ts`
- Modify `functions/_middleware.spec.ts`
- Modify `public/_routes.json`

### Attribution control plane

- Create `src/model/DiagramAttribution.ts`
- Create `src/model/DiagramAttribution.spec.ts`
- Modify `src/model/store2/types.ts`
- Modify `src/model/store2/ExtendedStore.ts`
- Modify `src/mount-root.ts`
- Modify `src/utils/viewerLoadOutcome.ts`
- Modify `src/utils/viewerBootstrap.ts`
- Modify `src/utils/viewerBootstrap.spec.ts`
- Modify `src/utils/documentOpening/types.ts`
- Modify `src/utils/documentOpening/openDocument.ts`
- Modify `src/utils/documentOpening/openDocument.spec.ts`
- Modify `src/forgeIndex.ts`
- Modify `src/forge-graph-viewer.ts`
- Modify `src/forge-graph-viewer.spec.ts` if present; otherwise extend the nearest loader spec
- Modify `src/forge-embed-viewer.ts`
- Modify `src/forge-embed-viewer.spec.ts`
- Modify `src/forge-swagger-ui.ts`
- Modify `src/forge-asyncapi-viewer.ts`

### Frontend impact behavior

- Create `src/services/DiagramImpact.ts`
- Create `src/services/DiagramImpact.spec.ts`
- Create `src/services/ConfluenceUserProfiles.ts`
- Create `src/services/ConfluenceUserProfiles.spec.ts`
- Create `src/composables/diagramImpact/useDiagramAudience.ts`
- Create `src/composables/diagramImpact/useDiagramAudience.spec.ts`
- Create `src/components/Viewer/DiagramImpactFooter.vue`
- Create `src/components/Viewer/DiagramImpactFooter.spec.ts`
- Create `src/components/Viewer/DiagramImpactFooter.stories.ts`
- Modify `src/components/Viewer/GenericViewer.vue`
- Modify `src/components/Viewer/GenericViewer.spec.ts`
- Modify `src/components/Viewer/GenericViewer.stories.ts` only if shared store reset is needed
- Modify `tests/e2e-tests/tests/render/sequence.spec.ts`

## Execution setup

The approved spec and this plan should land before feature work. Then create a fresh implementation branch so the analytics vocabulary is literally the first implementation commit:

```bash
git fetch origin
git worktree add ../conf-app-diagram-impact-phase1 \
  -b feat/diagram-impact-phase1 origin/main
cd ../conf-app-diagram-impact-phase1
```

Never implement from a dirty shared worktree. Do not add a feature flag.

---

## Task 1: Declare the analytics contract first

**Files:**

- Modify `src/utils/analytics/catalog.ts`
- Modify `src/utils/analytics/types.ts`
- Test the type surface through the normal build/typecheck path

**Contract:**

```typescript
export type ViewerRelation = 'creator' | 'updater' | 'contributor' | 'viewer';

// FeatureArea
| 'diagram_impact'

// AnalyticsEventName
| 'diagram_attribution_shown'
| 'diagram_audience_view_qualified'
| 'diagram_audience_registration_succeeded'
| 'diagram_audience_registration_failed'

// AnalyticsProperties
viewer_relation?: ViewerRelation;
has_last_updated_by?: boolean;
has_audience_count?: boolean;
visibility_duration_ms?: number;
audience_count?: number;
```

- [ ] Add `ViewerRelation` to `catalog.ts` and import it into `types.ts`.
- [ ] Add `diagram_impact` to `FeatureArea`.
- [ ] Register the four Phase 1 event names with comments identifying their exact trigger.
- [ ] Add the five typed properties above. Reuse existing `result`, `failure_reason`, `macro_type`, and `custom_content_id`.
- [ ] Do **not** add Phase 2 events yet.
- [ ] Do **not** pass viewer keys, attribution names, or another person's account ID. Existing tracker enrichment of the current user stays unchanged.
- [ ] Run:

```bash
pnpm test:unit src/utils/analytics/trackAnalyticsEvent.spec.ts
npx vue-tsc --noEmit
```

If the repository typecheck baseline is already red, compare the output with `origin/main` and require no new error attributable to these files.

- [ ] Commit this before any other feature code:

```bash
git add src/utils/analytics/catalog.ts src/utils/analytics/types.ts
git commit -m "feat(analytics): declare diagram impact events"
```

---

## Task 2: Add the D1 schema and identity-free audience repository

**Files:**

- Create `functions/migrations/0018_add_diagram_audience.sql`
- Create `functions/diagram-impact/domain.ts`
- Create `functions/diagram-impact/domain.spec.ts`
- Create `functions/diagram-impact/repository.ts`
- Create `functions/diagram-impact/repository.spec.ts`

### 2.1 Migration

- [ ] Add exactly the approved table and reverse-viewer index:

```sql
-- Migration number: 0018  2026-08-12T00:00:00.000Z

CREATE TABLE IF NOT EXISTS DiagramAudience (
  cloudId TEXT NOT NULL,
  forgeAppId TEXT NOT NULL,
  customContentId TEXT NOT NULL,
  viewerKey TEXT NOT NULL,
  firstViewedAt TEXT NOT NULL,
  lastViewedAt TEXT NOT NULL,
  viewDays INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (cloudId, forgeAppId, customContentId, viewerKey)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_diagram_audience_viewer
  ON DiagramAudience (cloudId, viewerKey);
```

Do not alter or revive `DiagramLikes`.

### 2.2 Pure domain functions

Expose these interfaces from `domain.ts`:

```typescript
export type ViewerRelation = 'creator' | 'updater' | 'contributor' | 'viewer';
export type RegistrationResult = 'new_unique' | 'repeat' | 'excluded_contributor';

export function classifyViewerRelation(input: {
  accountId: string;
  createdByAccountId?: string;
  updatedByAccountId?: string;
  isHistoricalContributor: boolean;
}): ViewerRelation;

export async function deriveViewerKey(input: {
  secret: string;
  cloudId: string;
  accountId: string;
}): Promise<string>;

export function utcDayStart(now: Date): string;
```

- [ ] Write failing tests first for precedence: creator → updater → historical contributor → viewer.
- [ ] Test HMAC determinism, different-tenant separation, different-account separation, 64-character lowercase hex output, and the exact domain-separated input:

```text
diagram-audience-v1\0<cloudId>\0<accountId>
```

- [ ] Use Worker-compatible Web Crypto only (`crypto.subtle.importKey` + `crypto.subtle.sign`). Do not add a hashing package and never fall back to raw account ID.
- [ ] Test UTC day boundaries, including just before and after midnight UTC.

### 2.3 Repository

Expose a small D1-only repository:

```typescript
export interface DiagramAudienceScope {
  cloudId: string;
  forgeAppId: string;
  customContentId: string;
}

export async function countAudience(db: D1Database, scope: DiagramAudienceScope): Promise<number>;

export async function isHistoricalContributor(
  db: D1Database,
  input: DiagramAudienceScope & { accountId: string },
): Promise<boolean>;

export async function registerAudienceView(
  db: D1Database,
  input: DiagramAudienceScope & { viewerKey: string; now: Date },
): Promise<'new_unique' | 'repeat'>;
```

- [ ] `countAudience` must use all three scope columns in the primary-key prefix.
- [ ] Historical contributor lookup must bind `contentId`, `forgeAppId`, and `authorId` against `CustomContentVersion`. SQLite's dynamic typing permits the existing UUID app IDs despite that legacy column's `INTEGER` declaration.
- [ ] Registration algorithm:

  1. Read the exact primary-key row.
  2. If absent, `INSERT OR IGNORE` with both timestamps and `viewDays=1`.
  3. Treat `meta.changes === 1` as `new_unique`; a concurrent loser is `repeat`.
  4. If the row exists on the same UTC day (or has a future timestamp), return `repeat` without running any write statement.
  5. For a later UTC day, conditionally update `lastViewedAt` and `viewDays=viewDays+1` with `lastViewedAt < <day-start>` so concurrent repeats cannot increment twice.

- [ ] D1 mock tests must assert SQL text and calls, not merely returned values:

  - first view performs insert;
  - concurrent insert loser returns repeat;
  - same-day repeat performs no `.run()` write;
  - later-day repeat performs one guarded update;
  - count and contributor queries include app and tenant scope.

- [ ] Run:

```bash
pnpm test:unit functions/diagram-impact/domain.spec.ts functions/diagram-impact/repository.spec.ts
pnpm db:migrate:local
pnpm exec wrangler d1 execute conf-zenuml-dev --local \
  --command "SELECT name, type FROM sqlite_master WHERE name IN ('DiagramAudience','idx_diagram_audience_viewer') ORDER BY name"
```

- [ ] Commit:

```bash
git add functions/migrations/0018_add_diagram_audience.sql functions/diagram-impact
git commit -m "feat(impact): add anonymous diagram audience storage"
```

---

## Task 3: Add authenticated summary and registration APIs

**Files:**

- Create `functions/diagram-impact/service.ts`
- Create `functions/diagram-impact/service.spec.ts`
- Create `functions/api/diagram-impact/index.ts`
- Create `functions/api/diagram-impact/index.spec.ts`
- Create `functions/api/diagram-impact/view.ts`
- Create `functions/api/diagram-impact/view.spec.ts`
- Modify `functions/_middleware.ts`
- Modify `functions/_middleware.spec.ts`
- Modify `public/_routes.json`

### 3.1 Shared authorization/service layer

Define an environment shape with only existing bindings plus the secret:

```typescript
export interface DiagramImpactEnv {
  DB: D1Database;
  DIAGRAM_IMPACT_HMAC_SECRET?: string;
}
```

Create one shared request resolver that:

1. Requires middleware-populated `cloudId`, `forgeAppId`, `accountId`, and `apiBaseUrl`.
2. Requires `x-forge-oauth-user`.
3. Accepts only a non-empty, bounded custom-content ID; rejects body/query identity fields such as `cloudId`, `forgeAppId`, `accountId`, `tenant`, `clientDomain`, `pageId`, and `spaceKey`.
4. Fetches `${apiBaseUrl}/api/v2/custom-content/<encoded-id>?body-format=raw` with the injected bearer token.
5. Treats any non-2xx Confluence response as an authorization/content-read failure and returns a parseable JSON 4xx/5xx without revealing the upstream body.
6. Verifies the returned content ID matches the requested ID.
7. Extracts `authorId` and `version.authorId`.
8. Queries D1 only after Confluence read access succeeds.

Do not reuse the current `getCustomContentFromConfluenceForForge` logging path unchanged: it logs the full content URL. The new service must log only stable operation labels/status classes, never tokens, account IDs, viewer keys, content IDs, tenant IDs, or raw upstream bodies.

### 3.2 GET summary

Implement:

```http
GET /api/diagram-impact?customContentId=<id>
```

Response:

```typescript
interface DiagramImpactSummary {
  audienceCount: number;
  viewerRelation: 'creator' | 'updater' | 'contributor' | 'viewer';
}
```

- [ ] Reject non-GET methods with JSON `405`.
- [ ] Require access before count/relation queries.
- [ ] Determine relation with the approved precedence and existing `CustomContentVersion` history.
- [ ] Return `audienceCount` from the scoped indexed count.

### 3.3 POST registration

Implement:

```http
POST /api/diagram-impact/view
Content-Type: application/json

{ "customContentId": "..." }
```

Response:

```typescript
interface DiagramImpactRegistrationResponse {
  result: 'new_unique' | 'repeat' | 'excluded_contributor';
  audienceCount: number;
}
```

- [ ] Reject non-POST methods and malformed JSON with parseable JSON.
- [ ] Repeat the content-read authorization; never trust that the client called GET first.
- [ ] If relation is creator/updater/contributor, skip HMAC and audience mutation and return `excluded_contributor` plus current count.
- [ ] Require a non-empty `DIAGRAM_IMPACT_HMAC_SECRET` only for an eligible viewer. Missing configuration returns JSON `503` and writes nothing.
- [ ] Derive the key, register it, then count using the same verified scope.
- [ ] Never return relation, key, passive account ID, or row timestamps from this endpoint.

### 3.4 Routing/auth wiring

- [ ] Add `'/api/diagram-impact'` to `AUTHENTICATED_PATHS`; the prefix covers `/view`.
- [ ] Extend `_middleware.spec.ts` to prove both paths invoke FIT authentication.
- [ ] Add both `/api/diagram-impact` and `/api/diagram-impact/*` to `public/_routes.json`.

### 3.5 Backend test matrix

- [ ] Handler tests cover:

  - absent Forge context/principal;
  - absent user OAuth header;
  - invalid content ID;
  - client-supplied identity fields rejected;
  - upstream 401/403/404/5xx;
  - returned ID mismatch;
  - cross-tenant/app rows invisible because all repository calls use the verified scope;
  - creator, updater, historical contributor exclusion;
  - viewer new/repeat responses;
  - missing D1/secret fails closed;
  - every response has `application/json`.

- [ ] Keep the existing token-validation tests as the proof for wrong-app/wrong-tenant FIT rejection; add only the new middleware path cases, not duplicate JOSE tests.
- [ ] Run:

```bash
pnpm test:unit \
  functions/diagram-impact/service.spec.ts \
  functions/api/diagram-impact/index.spec.ts \
  functions/api/diagram-impact/view.spec.ts \
  functions/_middleware.spec.ts \
  functions/utils/authenticate.spec.ts
```

- [ ] Commit:

```bash
git add functions/diagram-impact functions/api/diagram-impact functions/_middleware.ts functions/_middleware.spec.ts public/_routes.json
git commit -m "feat(impact): expose authenticated audience APIs"
```

---

## Task 4: Add an ephemeral attribution control plane

**Files:**

- Create `src/model/DiagramAttribution.ts`
- Create `src/model/DiagramAttribution.spec.ts`
- Modify `src/model/store2/types.ts`
- Modify `src/model/store2/ExtendedStore.ts`
- Modify `src/mount-root.ts`
- Modify `src/utils/viewerLoadOutcome.ts`
- Modify `src/utils/viewerBootstrap.ts`
- Modify `src/utils/viewerBootstrap.spec.ts`
- Modify `src/utils/documentOpening/types.ts`
- Modify `src/utils/documentOpening/openDocument.ts`
- Modify `src/utils/documentOpening/openDocument.spec.ts`

### 4.1 Data type and extraction

```typescript
export interface DiagramAttribution {
  customContentId: string;
  createdByAccountId?: string;
  lastUpdatedByAccountId?: string;
}

export function attributionFromCustomContent(
  content: Pick<ICustomContentV2, 'id' | 'authorId' | 'version'> | undefined,
): DiagramAttribution | null;
```

- [ ] Coerce the ID to string.
- [ ] Trim/omit blank author IDs.
- [ ] Preserve both account IDs even if equal; the view layer owns the hide rule.
- [ ] Return `null` when no valid custom-content ID exists.

### 4.2 Vuex state

- [ ] Add `diagramAttribution: DiagramAttribution | null` to `RootState` and initialize it to `null`.
- [ ] Add a typed `setDiagramAttribution` mutation.
- [ ] Add a small `publishDiagramAttribution` helper beside `publishLoadedDiagram`; do not attach fields to `Diagram`.
- [ ] Reset `diagramAttribution` to `null` at the start of `mountRoot` so one remount cannot leak a previous document's author into a new one.

### 4.3 Bootstrap/open-document propagation

Extend the structured viewer load result:

```typescript
{
  doc?: Diagram;
  loadError?: DiagramLoadError | null;
  attribution?: DiagramAttribution | null;
}
```

- [ ] Preserve attribution in `normalizeViewerLoadResult`.
- [ ] Publish it after the shell mount and when a live load resolves.
- [ ] Publish it again on SWR background revalidation.
- [ ] On an SWR cache hit, leave attribution null until the live wrapper arrives; never move the custom-content fetch back onto the critical render path.
- [ ] Add optional attribution to `OpenedDocument`, deriving it from `loaded.customContent` inside `openDocument`.
- [ ] Tests prove attribution is published on a normal load and revalidation, cleared on a new mount, and remains absent on a failed/legacy-only load.

- [ ] Run:

```bash
pnpm test:unit \
  src/model/DiagramAttribution.spec.ts \
  src/utils/viewerBootstrap.spec.ts \
  src/utils/documentOpening/openDocument.spec.ts
```

- [ ] Commit:

```bash
git add src/model/DiagramAttribution* src/model/store2 src/mount-root.ts src/utils/viewerLoadOutcome.ts src/utils/viewerBootstrap* src/utils/documentOpening
git commit -m "feat(impact): carry diagram attribution outside content"
```

---

## Task 5: Wire attribution through every standard viewer

**Files:**

- Modify `src/forgeIndex.ts`
- Modify `src/forge-graph-viewer.ts`
- Modify relevant Graph loader spec
- Modify `src/forge-embed-viewer.ts`
- Modify `src/forge-embed-viewer.spec.ts`
- Modify `src/forge-swagger-ui.ts`
- Modify `src/forge-asyncapi-viewer.ts`

### 5.1 Sequence/Mermaid/PlantUML

- [ ] Derive attribution whenever `loadCustomContentWithOrphanRecovery` returns `loaded.customContent`.
- [ ] After the final `mountRoot`/`applyViewerLoadOutcome` sequence, publish attribution so `mountRoot`'s reset cannot erase it.
- [ ] In `revalidateSequenceViewer`, publish the live attribution after a cached render and republish after any re-mount of changed content.
- [ ] For orphan sibling recovery, use `loaded.customContent.id`, not the stale configured ID.
- [ ] Leave attribution null for pure legacy content-property and source-snapshot fallbacks.

### 5.2 Graph and Embed

- [ ] Return attribution in each structured `ViewerLoadDiagramResult` when the custom-content wrapper exists.
- [ ] Keep legacy fallback results unattributed unless they resolve an actual `ICustomContentV2` wrapper.
- [ ] Embed must use the source document's actual custom-content ID so every render location shares one audience count.

### 5.3 OpenAPI

- [ ] Return `outcome.document.attribution` from `forge-swagger-ui.ts`; do not add another fetch.

### 5.4 AsyncAPI

- [ ] Derive attribution from the existing `getCustomContentByIdV2` response.
- [ ] On the page-rendered Vue macro path only, publish a real viewer outcome (`ready` or failure) plus attribution after `mountRoot`.
- [ ] Do not mount the footer or qualify views in dashboard/modal React paths.
- [ ] Preserve the existing AsyncAPI embed `hideEdit` behavior; attribution still refers to the source document.

### 5.5 Tests

- [ ] Extend loader/bootstrap tests to assert exact source ID and author IDs for normal and orphan-recovered wrappers.
- [ ] Assert no attribution is invented for legacy fallbacks.
- [ ] Assert page-rendered AsyncAPI reaches `viewerLoadState='ready'`; otherwise the qualification controller would never start.

- [ ] Run the focused loader tests plus:

```bash
pnpm test:unit src/forge-embed-viewer.spec.ts src/utils/viewerBootstrap.spec.ts
```

- [ ] Commit:

```bash
git add src/forgeIndex.ts src/forge-graph-viewer* src/forge-embed-viewer* src/forge-swagger-ui.ts src/forge-asyncapi-viewer.ts
git commit -m "feat(impact): publish attribution from all viewers"
```

---

## Task 6: Add typed frontend services for names and impact

**Files:**

- Create `src/services/DiagramImpact.ts`
- Create `src/services/DiagramImpact.spec.ts`
- Create `src/services/ConfluenceUserProfiles.ts`
- Create `src/services/ConfluenceUserProfiles.spec.ts`

### 6.1 Impact remote client

Expose:

```typescript
export type ViewerRelation = 'creator' | 'updater' | 'contributor' | 'viewer';
export type RegistrationResult = 'new_unique' | 'repeat' | 'excluded_contributor';

export async function getDiagramImpact(customContentId: string): Promise<{
  audienceCount: number;
  viewerRelation: ViewerRelation;
}>;

export async function registerDiagramView(customContentId: string): Promise<{
  result: RegistrationResult;
  audienceCount: number;
}>;
```

- [ ] Use `callRemote('/api/diagram-impact?...')` and `callRemote('/api/diagram-impact/view', 'POST', ...)`.
- [ ] Validate response shapes and non-negative integer counts. Malformed success bodies throw and must never become zero.
- [ ] Centralize the relation/result allowlists rather than casting remote strings.
- [ ] Never send app, tenant, current account, page, space, name, or count from the client.

### 6.2 Confluence profile resolver

Expose:

```typescript
export interface AttributionProfile {
  accountId: string;
  displayName: string;
}

export async function resolveAttributionProfiles(
  accountIds: string[],
): Promise<Map<string, AttributionProfile>>;
```

- [ ] Deduplicate and discard blank IDs; maximum input here is two.
- [ ] Build repeated `accountId` query parameters with `URLSearchParams` and call `/wiki/rest/api/user/bulk` via `requestConfluence`.
- [ ] Return only `accountId` plus `displayName` (fall back to non-empty `publicName` if needed). Do not request or return email.
- [ ] Treat an HTTP failure, malformed body, missing user, or profile-visibility omission as absence for that field; do not throw into the viewer.
- [ ] Cache only within the iframe/module lifetime. Do not create another persistent user-profile store.

### 6.3 Tests

- [ ] Test URL encoding/repeated IDs, deduplication, same-account input, partial results, 403, malformed results, and display-name fallback.
- [ ] Test impact client happy paths, every invalid enum/count shape, and encoded custom-content IDs.

- [ ] Run:

```bash
pnpm test:unit src/services/DiagramImpact.spec.ts src/services/ConfluenceUserProfiles.spec.ts
```

- [ ] Commit:

```bash
git add src/services/DiagramImpact* src/services/ConfluenceUserProfiles*
git commit -m "feat(impact): add attribution and audience clients"
```

---

## Task 7: Implement the continuous-visibility qualification controller

**Files:**

- Create `src/composables/diagramImpact/useDiagramAudience.ts`
- Create `src/composables/diagramImpact/useDiagramAudience.spec.ts`

Keep time, DOM APIs, and network calls injected so unit tests never wait three real seconds:

```typescript
export interface DiagramAudienceDeps {
  getSummary: typeof getDiagramImpact;
  registerView: typeof registerDiagramView;
  IntersectionObserverCtor?: typeof IntersectionObserver;
  documentRef?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  now: () => number;
  setTimeoutFn: typeof setTimeout;
  clearTimeoutFn: typeof clearTimeout;
  track: typeof trackAnalyticsEvent;
}
```

The composable/controller receives:

- actual viewer-surface element;
- custom-content ID;
- macro type;
- reactive render-ready state;
- creator/updater account IDs;
- current account ID when locally available.

It exposes reactive `audienceCount`, `viewerRelation`, `summarySettled`, and cleanup.

### State machine

- [ ] Start only when mounted in the standard `GenericViewer` display branch with a valid content ID.
- [ ] Observe the nearest `.viewer-surface` using an implicit-root `IntersectionObserver` with strict intersection (`isIntersecting` and positive ratio), not the existing prefetch margin.
- [ ] If `IntersectionObserver` is unavailable or throws, fail closed for registration. Do not invent viewport visibility.
- [ ] Fetch summary once after the diagram first becomes intersecting and the document is visible. A failure settles the summary with no count.
- [ ] Start the 3,000 ms timer only when all are true: render state ready, visible document, and intersecting surface.
- [ ] On hidden document, non-intersection, failed render, target/content change, or unmount, cancel and reset elapsed visibility to zero.
- [ ] When the timer completes, synchronously mark the iframe as `qualificationAttempted` before any async call so repeated observer callbacks cannot race a second attempt.
- [ ] Fire `diagram_audience_view_qualified` once with `visibility_duration_ms: 3000` (or measured elapsed clamped to at least 3000).
- [ ] If the local account is creator/updater, or the settled summary says contributor, stop after qualification without POST. The server still handles every exclusion race authoritatively.
- [ ] Otherwise POST exactly once. On a valid response, replace the displayed count and fire `diagram_audience_registration_succeeded` with `result` and `audience_count`; on any error, preserve the old count and fire `diagram_audience_registration_failed` with a bounded failure class.
- [ ] Never retry automatically in the same iframe.
- [ ] Cleanup observer, visibility listener, and timer on unmount.

### Required fake-clock tests

- [ ] Three uninterrupted seconds qualifies exactly once.
- [ ] 2.9 seconds + leave + 2.9 seconds does not qualify.
- [ ] Tab hidden resets even while intersecting.
- [ ] Render becomes ready after intersection: timer begins only at ready.
- [ ] Render failure cancels a running timer.
- [ ] Summary starts once on first visible intersection.
- [ ] Summary failure hides count but registration can still be attempted for an eligible viewer.
- [ ] Creator/updater and known contributor do not POST.
- [ ] Server `excluded_contributor` is accepted without changing the unique count incorrectly.
- [ ] POST failure leaves count unchanged and does not retry.
- [ ] Unavailable/throwing observer never qualifies.
- [ ] Unmount clears everything.

- [ ] Run:

```bash
pnpm test:unit src/composables/diagramImpact/useDiagramAudience.spec.ts
```

- [ ] Commit:

```bash
git add src/composables/diagramImpact
git commit -m "feat(impact): qualify continuous diagram views"
```

---

## Task 8: Build and integrate the footer UI

**Files:**

- Create `src/components/Viewer/DiagramImpactFooter.vue`
- Create `src/components/Viewer/DiagramImpactFooter.spec.ts`
- Create `src/components/Viewer/DiagramImpactFooter.stories.ts`
- Modify `src/components/Viewer/GenericViewer.vue`
- Modify `src/components/Viewer/GenericViewer.spec.ts`
- Modify `src/components/Viewer/GenericViewer.stories.ts` only for shared-state reset if required

### 8.1 Component behavior

- [ ] The component always owns a stable root element so it can locate the closest `.viewer-surface`, but uses `v-show`/CSS to take no space when no attribution profile resolves.
- [ ] Resolve creator/updater profiles in parallel through the bulk resolver.
- [ ] Hide latest updater when its account ID equals the creator before profile lookup and rendering.
- [ ] Render separators only between visible items.
- [ ] Render singular/plural correctly: `1 colleague viewed`, `2 colleagues viewed`.
- [ ] Audience count is plain metadata in Phase 1, not a button or popover.
- [ ] Use semantic markup such as `<footer aria-label="Diagram attribution and impact">`; keep separators `aria-hidden` so screen readers hear a natural sequence.
- [ ] Fire `diagram_attribution_shown` once when at least one attribution field is actually visible. Delay the event until the first summary attempt settles when the footer enters the viewport so `viewer_relation` and `has_audience_count` reflect the best available state; attribution rendering itself must not wait.
- [ ] Analytics caller properties:

```typescript
{
  feature_area: 'diagram_impact',
  surface: 'viewer',
  macro_type,
  custom_content_id: attribution.customContentId,
  viewer_relation,
  has_last_updated_by,
  has_audience_count,
}
```

No names or other-user IDs.

### 8.2 GenericViewer integration

- [ ] Insert `<DiagramImpactFooter>` below `.viewer-canvas` and inside `.viewer-surface`/viewer frame.
- [ ] Keep it outside both `.screen-capture-content` nodes.
- [ ] Mount only when:

  - standard display branch (`isDisplayMode && !hideHeader`);
  - `viewerLoadState === 'ready'`;
  - `diagram.source === DataSource.CustomContent`;
  - `diagramAttribution` is present;
  - load has not failed.

- [ ] Map `diagramAttribution` from Vuex; pass current diagram type and render-ready state.
- [ ] Fullscreen remains included because it uses the same standard branch.
- [ ] Do not change the bottom action pill or make impact hover-dependent.

### 8.3 Styling

- [ ] Use quiet neutral text, 12–13 px, a subtle top divider, and normal wrapping.
- [ ] Do not add badges, celebration colors, icons, avatars, animation, streaks, or leaderboard cues.
- [ ] Ensure a long display name wraps without widening a fit-content diagram canvas.
- [ ] Add stable `data-testid` values for footer and individual items.

### 8.4 Component tests and stories

- [ ] Component tests cover:

  - same creator/updater;
  - distinct creator/updater;
  - creator missing but updater present;
  - updater missing but creator present;
  - both missing (no visual footprint);
  - zero/failed count hidden;
  - positive count and singular/plural;
  - service failure leaves diagram slot untouched;
  - no names/other-user IDs in analytics payload.

- [ ] `GenericViewer.spec.ts` proves footer is absent in editor, `hideHeader`, failed render, and non-custom-content paths; present in normal and fullscreen ready paths.
- [ ] Add Storybook states for creator only, creator+updater+count, long wrapping names, zero count, and partial profile failure. Use the real presentational component and controlled dependency injection, not a duplicated HTML facsimile.
- [ ] Verify the capture node remains diagram-only by asserting the footer is not a descendant of `.screen-capture-content`.

- [ ] Run:

```bash
pnpm test:unit \
  src/components/Viewer/DiagramImpactFooter.spec.ts \
  src/components/Viewer/GenericViewer.spec.ts
pnpm build-storybook
```

- [ ] Commit:

```bash
git add src/components/Viewer/DiagramImpactFooter* src/components/Viewer/GenericViewer*
git commit -m "feat(impact): show diagram attribution and audience"
```

---

## Task 9: Add real UI evidence and cross-variant validation

**Files:**

- Modify `tests/e2e-tests/tests/render/sequence.spec.ts`
- Reuse `tests/e2e-tests/fixtures/macro-test.ts` and existing frame helpers; do not create a parallel Playwright harness

### 9.1 Checked-in Forge iframe assertion

- [ ] Extend the standard Sequence render test to enter the actual macro frame and assert:

  - footer visible;
  - non-empty `Created by` text;
  - footer outside `.screen-capture-content`;
  - diagram content remains visible.

Do not assert a hard-coded real person's name or tenant/page title in the public test.

### 9.2 Browser evidence for dynamic behavior

- [ ] Use the real `DiagramImpactFooter` Storybook story with controlled network dependencies and Playwright/browser automation to capture UI evidence that:

  - count starts at 22;
  - continuous intersection/visibility reaches three seconds;
  - registration resolves `new_unique` with 23;
  - visible text updates to `23 colleagues viewed` without remounting the diagram.

- [ ] Capture a second state where summary/registration fail and the diagram plus attribution remain visible while the count disappears.

This is a UI assertion: a unit test alone cannot mark it passed. Save only non-sensitive screenshots or snapshots.

### 9.3 Focused tests and builds

- [ ] Run all new focused tests, then the relevant existing suites:

```bash
pnpm test:unit \
  functions/diagram-impact/domain.spec.ts \
  functions/diagram-impact/repository.spec.ts \
  functions/diagram-impact/service.spec.ts \
  functions/api/diagram-impact/index.spec.ts \
  functions/api/diagram-impact/view.spec.ts \
  src/model/DiagramAttribution.spec.ts \
  src/services/DiagramImpact.spec.ts \
  src/services/ConfluenceUserProfiles.spec.ts \
  src/composables/diagramImpact/useDiagramAudience.spec.ts \
  src/components/Viewer/DiagramImpactFooter.spec.ts \
  src/components/Viewer/GenericViewer.spec.ts \
  src/utils/viewerBootstrap.spec.ts \
  src/utils/documentOpening/openDocument.spec.ts

pnpm build:lite
pnpm build:full
pnpm build:diagramly
pnpm build:asyncapi
git diff --check
```

- [ ] Run the targeted staging E2E after deployment:

```bash
cd tests/e2e-tests
APP=zenuml-lite@stg pnpm playwright test tests/render/sequence.spec.ts --project=render
```

The current Playwright project is `render`; the `APP` environment variable selects Lite staging. Do not claim pass without the frame screenshot/snapshot.

- [ ] Commit the E2E assertion:

```bash
git add tests/e2e-tests/tests/render/sequence.spec.ts
git commit -m "test(impact): verify attribution in Forge viewer"
```

---

## Task 10: Backend-first rollout without a feature flag

No code should be added in this task unless validation finds a defect.

### 10.1 Secret setup

Generate one staging secret and one production secret. Each value must be identical across the two Pages projects that share that environment's D1. Pipe values through stdin so they do not appear in shell history or process arguments:

```bash
pnpm exec wrangler pages secret put DIAGRAM_IMPACT_HMAC_SECRET --project-name=conf-stg-lite
pnpm exec wrangler pages secret put DIAGRAM_IMPACT_HMAC_SECRET --project-name=conf-stg-full

pnpm exec wrangler pages secret put DIAGRAM_IMPACT_HMAC_SECRET --project-name=conf-lite
pnpm exec wrangler pages secret put DIAGRAM_IMPACT_HMAC_SECRET --project-name=conf-full
```

Do not paste secret values into docs, tickets, logs, command arguments, or the repository.

### 10.2 Deploy backend/schema first

- [ ] Publish a revision containing Tasks 1–3 but no frontend caller, or otherwise use a two-commit/two-deployment sequence from the same branch.
- [ ] Confirm CI's migration step reports `0018_add_diagram_audience.sql` applied against staging D1.
- [ ] Verify with read-only D1 inspection that the table/index exist.
- [ ] Call both endpoints from a staging Forge viewer context and verify JSON content types, authorization, contributor exclusion, and no raw identity in the row.
- [ ] Confirm an unauthenticated direct request is rejected.

### 10.3 Release frontend

- [ ] After backend staging validation, ship the remaining frontend commits through the normal branch pipeline.
- [ ] Use the `spot-check` skill on staging for real Forge iframe UI evidence.
- [ ] Verify page view and fullscreen; editor/preview/`hideHeader` absence; zero-count hiding; diagram continues rendering with backend intentionally failed.
- [ ] If a second non-contributor staging account is available, prove the three-second registration and visible increment end to end. If not, mark that assertion **SKIPPED with the missing-account blocker**; do not convert unit evidence into a UI PASS.

### 10.4 Observe and rollback criteria

- [ ] Monitor the four new Mixpanel events, `viewer_load_failed`, render-duration distributions, D1 queries/writes, and error logs after release.
- [ ] Verify success events split into `new_unique`, `repeat`, and defensive `excluded_contributor` outcomes.
- [ ] Verify failures carry bounded classes and no tokens/IDs.
- [ ] Roll back the frontend if it affects rendering/layout. Leave the additive table/endpoints in place; no destructive migration rollback is needed.
- [ ] Reconsider storage only at the approved thresholds (~7 GB sustained growth, >20% D1 load, indexed-query overload, or high-frequency social expansion).

## Definition of done

- [ ] Analytics vocabulary is the first implementation commit.
- [ ] Existing D1 and existing `DB` binding are the only storage resource.
- [ ] HMAC secret is configured consistently across shared-backend projects.
- [ ] Confluence remains authoritative for creator/updater attribution.
- [ ] No persisted `Diagram` field contains attribution or impact state.
- [ ] No raw passive account ID is stored, returned, or logged.
- [ ] Backend verifies FIT identity and live user-context content access on every request.
- [ ] Contributor views never increment the count.
- [ ] Same-day repeats perform no D1 write.
- [ ] Three continuous visible seconds qualify exactly once per iframe.
- [ ] Footer is quiet, accessible, non-hover, outside exports, and fail-soft.
- [ ] All supported product variants build.
- [ ] Real UI evidence exists for the footer; unavailable assertions are marked SKIPPED, never PASS.
- [ ] No Phase 2, feature flag, reaction, new database, or third-party processor was added.
