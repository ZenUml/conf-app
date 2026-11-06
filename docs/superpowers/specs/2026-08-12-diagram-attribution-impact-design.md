# Diagram attribution and creator impact

> **Superseded:** The audience identity portions of this design were replaced by
> [2026-08-13-remove-diagram-audience-hmac-design.md](2026-08-13-remove-diagram-audience-hmac-design.md).
> The original HMAC schema and secret requirements below are retained as historical context only.

**Status:** Approved in product design review on 2026-08-12
**Scope:** Phase 1 public attribution and audience count; Phase 2 private contributor impact
**Storage decision:** Existing Cloudflare D1 database and existing `DB` binding

## 1. Summary

Add a quiet metadata footer below every standard Confluence diagram viewer:

> Created by Peng · Last updated by Alice · 23 colleagues viewed

The feature has two product goals:

1. Give creators a meaningful sense that their work reached people.
2. Make the creator's contribution visible to colleagues and leaders on the page where the work is consumed.

The design borrows a game mechanic, not game aesthetics. It turns a diagram into something that accumulates visible progress. It deliberately avoids streaks, leaderboards, noisy badges, passive viewer identities, and another Like-style action.

Confluence remains the system of record for diagram content and attribution. D1 stores only anonymous audience metadata. D1 and the impact APIs must never become dependencies for rendering, editing, exporting, or recovering a diagram.

## 2. Product principles

### 2.1 The diagram has contributors, not an owner

A diagram normally belongs to a Confluence page. Adding a separate owner model would duplicate Confluence concepts and create reassignment and permission questions that the product does not need.

The public attribution vocabulary is therefore limited to:

- `Created by`: the author of version 1.
- `Last updated by`: the author of the latest version.

If both are the same user, only `Created by` is shown.

### 2.2 Passive attention is aggregate

- A qualifying view contributes only to a lifetime unique-colleague count.
- Raw passive viewer account IDs are never stored in the audience table.
- Passive viewer names are never returned or displayed, including to contributors.

### 2.3 Do not recreate Like as Kudos

The retired Like feature already provided a visible one-click button, count, active state, and unlike action in the viewer. A read-only production D1 check on 2026-08-12 found only 108 remaining active Likes across 89 users and 100 diagrams, spanning 2025-04-06 through 2026-05-06. Because unlike deletes a row, this is not a count of every historical click, but it is direct evidence of weak retained adoption over more than a year.

Renaming Like to Kudos, placing it beside attribution, or making it public does not remove the core friction: a reader must perform an extra workplace-social action with no direct benefit. Public identity may add friction. The new mechanic must therefore be the zero-effort audience count, not a repackaged Like interaction.

### 2.4 Failure must be quiet

Attribution comes from the Confluence custom-content response and does not depend on D1. If audience data cannot be loaded, the number disappears without an error panel. The diagram continues to work.

## 3. Delivery phases

### Phase 1: public footer

Phase 1 ships:

- `Created by` and, when different, `Last updated by`.
- Lifetime unique `colleagues viewed` count.
- Qualifying-view collection and required analytics.

### Phase 2: private contributor impact

Phase 2 is a separate implementation and release after Phase 1 produces a trustworthy baseline. It adds:

- A private impact panel available to any contributor represented in the diagram's stored version history.
- Lifetime unique colleagues reached.
- New colleagues reached in the last 7 and 30 days.
- One-time milestones at 10, 25, 50, and 100 unique colleagues.

Phase 2 still does not show passive viewer identities.

## 4. User experience

### 4.1 Placement

The standard `GenericViewer` currently uses its top edge for the title and primary actions and a hover-only bottom pill for diagram tools. Impact metadata is neither a title nor an action toolbar, so it belongs in a new lightweight footer below the canvas and inside the viewer frame.

The footer is:

- Persistently visible when at least one attribution field is available.
- Visually quieter than the title and toolbar.
- Allowed to wrap on narrow diagrams instead of widening or shrinking the canvas.
- Outside `.screen-capture-content`, so PNG and document exports do not unexpectedly acquire a social footer.
- Shown in the standard page viewer and fullscreen viewer.
- Omitted from editor, preview, export, and existing chrome-less `hideHeader` surfaces.

The footer should be a focused child component rather than adding networking, timers, and popovers directly to the already-large `GenericViewer.vue`.

### 4.2 Display rules

Examples:

```text
Created by Peng · Last updated by Alice · 23 colleagues viewed
Created by Peng · 23 colleagues viewed
Created by Peng
```

Rules:

- Hide `Last updated by` when it resolves to the same account as `Created by`.
- Hide an attribution field whose Confluence user cannot be resolved.
- Hide the audience item when the count is zero or cannot be loaded.
- The footer must remain usable with keyboard navigation and screen readers.

### 4.3 Impact panel

For a contributor, the audience text becomes an accessible control that opens the Phase 2 private panel. For a non-contributor it remains plain metadata. The panel contains aggregate totals and trends only.

The panel does not attempt to detect managers or claim that a particular leader saw the diagram. Its career value comes from public attribution and visible aggregate impact, not surveillance.

### 4.4 Milestones

When a contributor opens the Phase 2 panel after a diagram crosses a threshold, show a lightweight message such as:

> Your diagram reached 25 colleagues.

The threshold describes something the user can reasonably be proud of. It is not an app-open streak. A milestone is acknowledged once per contributor and diagram in local browser state; repeating it on a different browser is acceptable and avoids another identity-bearing server table.

## 5. Attribution source and semantics

The Confluence V2 custom-content shape already represented by `ICustomContentResponseBodyV2` contains:

- top-level `authorId`, used for `Created by`;
- `version.authorId`, used for `Last updated by`.

Names and avatars are resolved through Confluence using the existing `read:confluence-user` scope. No new Forge scope is required by this design.

Attribution rules:

- Version 1 creator is immutable even after later edits.
- Latest updater changes whenever a new diagram version is saved.
- Missing or inaccessible user profiles cause only the corresponding field to be hidden.
- Confluence, not D1, is authoritative for both fields.
- An embedded diagram uses the source custom content's attribution and audience identity. Views from all standard render locations of that source diagram contribute to the same count.
- A copied diagram with a new custom-content ID starts new attribution and impact records.

## 6. Qualifying-view definition

A render becomes a qualifying view only when all of the following are true:

1. It is a standard display viewer, not an editor, preview, export, or chrome-less host.
2. The diagram has loaded and rendered successfully.
3. The browser document is visible.
4. The diagram is intersecting the viewport.
5. Conditions 3 and 4 remain true continuously for at least three seconds.
6. The current user is not represented as a creator/editor in the available contributor history.

If the tab becomes hidden or the diagram leaves the viewport before three seconds, the timer resets to zero. Each iframe attempts registration at most once after qualifying.

The browser can avoid an obviously ineligible **registration** call for the created-by and last-updated-by users, but it still loads the summary so they can see the diagram's public impact. The server remains authoritative: it checks the verified current user against the created/current authors and the existing `CustomContentVersion` author history. The operational contributor set is therefore Confluence's created/current authors plus all authors present in the D1 version mirror; no historical analytics backfill is performed.

The public number is lifetime unique colleagues, not iframe loads, visits, or view days. Contributor views do not increment it.

## 7. Data flow

1. The diagram renders from Confluence as it does today.
2. The footer derives attribution from the already-loaded custom-content response.
3. Once the standard viewer enters the viewport, it requests the public impact summary asynchronously.
4. The backend verifies the Forge invocation token, derives `cloudId`, `forgeAppId`, and `accountId`, and verifies that the caller can read the referenced Confluence custom content using the injected Forge user token.
5. The footer displays the audience value when available. A summary failure leaves attribution visible and hides only the number.
6. The client starts the three-second continuous-visibility timer after successful diagram rendering.
7. On qualification, it calls the view-registration endpoint.
8. The backend repeats authentication and content-access checks, evaluates contributor exclusion, derives the passive viewer key, and performs an idempotent D1 upsert.
9. The registration response returns `new_unique`, `repeat`, or `excluded_contributor` plus the latest count. The footer can update, for example, from 22 to 23 without another request.

## 8. D1 design

### 8.1 Use the existing database

Use the existing `env.DB` binding and the current D1 database. Do not create a second D1 database, KV namespace, R2 bucket, Redis/Upstash database, or Durable Object for this feature.

The alternatives considered were:

- **Existing D1 — selected.** Indexed relational uniqueness, transactions, current binding, no new data processor, and sufficient measured capacity.
- **Separate D1.** Better blast-radius isolation but adds a binding, migrations, operational monitoring, and cross-database maintenance before load justifies it.
- **KV.** Good for cached counters but poor for exact uniqueness and atomic multi-key updates.
- **R2.** Good for objects and snapshots, not point updates and unique membership.
- **Redis/Upstash.** Natural sets and counters, but adds a third-party processor, network dependency, billing surface, and operational credentials.
- **Durable Objects.** Strong per-diagram serialization but excessive for the observed write rate and introduces a new stateful subsystem.

### 8.2 `DiagramAudience`

```sql
CREATE TABLE DiagramAudience (
  cloudId TEXT NOT NULL,
  forgeAppId TEXT NOT NULL,
  customContentId TEXT NOT NULL,
  viewerKey TEXT NOT NULL,
  firstViewedAt TEXT NOT NULL,
  lastViewedAt TEXT NOT NULL,
  viewDays INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (cloudId, forgeAppId, customContentId, viewerKey)
) WITHOUT ROWID;

CREATE INDEX idx_diagram_audience_viewer
  ON DiagramAudience (cloudId, viewerKey);
```

`viewerKey` is:

```text
hex(HMAC-SHA256(
  DIAGRAM_IMPACT_HMAC_SECRET,
  "diagram-audience-v1\0" + cloudId + "\0" + accountId
))
```

The HMAC secret is a stable Cloudflare secret shared by the backend deployments that use this D1 database. It is not committed to configuration files. It is a secret binding, not a new storage resource. Routine secret rotation is out of scope because the raw passive account ID is intentionally unavailable for an in-place re-key; any future rotation requires its own dual-key migration design.

Upsert behavior:

- First qualifying view inserts a row.
- Another view on the same UTC date performs no write.
- A view on a later UTC date updates `lastViewedAt` and increments `viewDays`.
- The public count is an indexed `COUNT(*)` over the primary-key prefix.

Phase 1 does not add a summary table. Phase 2 may add an index ending in `firstViewedAt` if query-plan evidence shows it is needed for 7/30-day new-audience queries; it must not add a precomputed counter without measured need.

### 8.3 Capacity evidence

Read-only production inspection on 2026-08-11 found:

- D1 size: 3,770,351,616 bytes, approximately 3.77 GB of the documented 10 GB paid-database limit.
- 147,925 read queries and 161,219 write queries in the preceding 24 hours.
- 25,729,876 rows read and 977,439 rows written in the preceding 24 hours.
- An indexed point query against the large analytics table read 10 rows in approximately 1.16 ms.

The last 30 days of external-user Mixpanel data contained 323,211 standard viewer `macro_viewed` events, 11,176 unique users, and 70,280 unique user/diagram pairs. An empirical local SQLite table with the proposed primary key and reverse-viewer index used approximately 271 bytes per audience row at 100,000 rows.

Treating every observed user/diagram pair as new gives a deliberately conservative estimate of roughly 19 MB per month or 0.23 GB per year. Repeated pairs make the real storage growth lower. The theoretical registration-request volume is about 10,800 per day, equal to 6.7% of the current daily D1 write-query count as a scale comparison; it does not translate one-for-one into writes because same-day repeats do not write. The observed unique-pair volume puts the upper bound on newly encountered rows at an average of 2,343 per day before contributor exclusions.

These measurements support the existing-D1 decision. Reconsider a split only if one of these conditions is observed:

- total D1 size exceeds approximately 7 GB and continues growing;
- diagram impact sustains more than 20% of database load;
- normal indexed impact queries contribute to overload;
- the feature expands into high-frequency feeds, notifications, or other social workloads.

Cloudflare references used for the capacity decision:

- <https://developers.cloudflare.com/d1/platform/limits/>
- <https://developers.cloudflare.com/d1/platform/pricing/>

## 9. API contract

All endpoints are added to `public/_routes.json` and use the existing Forge remote authentication middleware.

### 9.1 Public summary

```http
GET /api/diagram-impact?customContentId=<id>
```

Successful response:

```json
{
  "audienceCount": 23,
  "viewerRelation": "contributor"
}
```

### 9.2 Register a qualifying view

```http
POST /api/diagram-impact/view
Content-Type: application/json

{ "customContentId": "..." }
```

Successful response:

```json
{
  "result": "new_unique",
  "audienceCount": 23
}
```

Valid results are `new_unique`, `repeat`, and `excluded_contributor`. A request with no verified principal is not counted.

### 9.3 Private insights

Phase 2 adds:

```http
GET /api/diagram-impact/insights?customContentId=<id>
```

The backend returns aggregate insights only after confirming the current account is represented in the contributor history. It never returns passive viewer keys or identities.

### 9.4 Trust boundaries

The client supplies only the custom-content ID and requested operation. The backend derives these values from the verified Forge invocation:

- `cloudId`
- `forgeAppId`
- current `accountId`
- Atlassian API base URL

Before returning or mutating impact data, the backend verifies the caller can read the custom content using the injected `x-forge-oauth-user` token. It does not trust client-supplied tenant, domain, app, user, page, or space identifiers. Tokens and passive identity inputs must not be logged.

## 10. Analytics plan

The analytics contract is the first implementation commit, before schema, backend, or UI code. It adds `diagram_impact` to `FeatureArea`, registers the events in `src/utils/analytics/catalog.ts`, and adds typed properties in `src/utils/analytics/types.ts`.

### 10.1 Phase 1 events

| Event | Trigger | Key properties |
|---|---|---|
| `diagram_attribution_shown` | Footer renders with at least one attribution field | `feature_area`, `surface`, `macro_type`, `custom_content_id`, `viewer_relation`, `has_last_updated_by`, `has_audience_count` |
| `diagram_audience_view_qualified` | Diagram completes three continuous visible seconds | `feature_area`, `surface`, `macro_type`, `custom_content_id`, `viewer_relation`, `visibility_duration_ms` |
| `diagram_audience_registration_succeeded` | View API returns a valid result | Above context plus `result`, `audience_count` |
| `diagram_audience_registration_failed` | View API or response validation fails | Above context plus `failure_reason` |

`viewer_relation` uses deterministic precedence: `creator`, then `updater`, then `contributor`, then `viewer`.

Analytics never receives a viewer key, attribution name, or other user's account ID. The tracker may continue its existing automatic enrichment for the current user.

### 10.2 Phase 2 events

The first Phase 2 implementation commit registers:

- `diagram_impact_panel_opened`: current relation, audience count, and 7/30-day new-audience counts.
- `diagram_impact_milestone_shown`: current relation and numeric milestone threshold.

## 11. Error handling and performance

The feature is best-effort and off the critical path:

- Attribution is derived from the already-loaded Confluence object.
- Impact requests begin only after the diagram has rendered and entered the viewport.
- No impact network request blocks rendering, editing, fullscreen, or export.
- A summary read failure hides the audience value.
- A registration failure leaves the visible count unchanged.
- A missing HMAC secret causes the view endpoint to fail closed without storing a raw account ID.
- Malformed responses are treated as failures, never as zero.

The existing render-gate behavior remains authoritative. The impact observer must not introduce a second mechanism that delays rendering.

## 12. Release strategy: no feature flag

This feature does not add a Forge or application feature flag. It is additive, asynchronous, and fail-soft, and the repository already carries many feature flags. Deployment sequencing provides the needed safety:

1. Deploy the additive D1 migration and authenticated backend endpoints while no released client calls them.
2. Validate the endpoints and migrations on staging.
3. Release the Phase 1 frontend footer.
4. If the frontend causes trouble, roll it back; unused D1 tables and endpoints are harmless.
5. Ship Phase 2 later as a separate release rather than hiding unfinished panel code behind another flag.

The same shared implementation applies to lite, full, diagramly, and asyncapi. `forgeAppId` keeps each app identity's records distinct.

## 13. Testing and acceptance

### 13.1 Frontend unit tests

- Three continuous visible seconds qualify exactly once.
- Leaving the viewport or hiding the document resets the timer.
- Editor, preview, export, failed-render, and chrome-less surfaces do not qualify.
- Same creator/updater renders only `Created by`.
- Missing user profiles hide only their own fields.
- Zero or failed audience count is hidden.
- Dynamic API failures do not affect the diagram slot.

### 13.2 Backend tests

- Missing, invalid, wrong-app, and wrong-tenant Forge tokens are rejected.
- Client-supplied identity and tenant fields are ignored or rejected.
- Content-read authorization is required.
- Passive account ID never appears in `DiagramAudience`, responses, or logs.
- HMAC output is deterministic and tenant-scoped.
- First view inserts; repeat same-day view does not write; later-day view increments `viewDays`.
- Concurrent registrations preserve one unique row.
- Contributor registration returns `excluded_contributor`.
- Count queries use the primary-key prefix.
- Cross-tenant and cross-app records cannot be read or modified.
- Missing D1 or HMAC configuration fails without substituting raw identity.

### 13.3 Integration and UI evidence

- Migrations apply to empty and existing D1 databases.
- New function paths are present in `_routes.json`.
- Version 1 and latest author mapping works against representative V2 custom-content responses.
- Playwright observes the real footer inside the Forge iframe.
- Playwright or a network intercept proves that a three-second qualifying view updates the count.
- A forced backend failure proves the diagram remains rendered while dynamic metadata disappears.

Any assertion about visible footer behavior requires actual UI evidence. Unit tests alone cannot mark those assertions passed.

## 14. Success signals

Phase 1 establishes the baseline. Monitor:

- qualifying-view registration success and failure reasons;
- new-unique versus repeat-view distribution;
- `viewer_load_failed` and render-duration trends before and after release;
- D1 query, row-write, storage, and overload trends.

Phase 2 additionally measures contributor impact-panel opens and milestone displays. The product must not infer that a manager saw a diagram, because it intentionally does not collect viewer identity for that purpose.

## 15. Explicitly out of scope

- Diagram Owner or ownership transfer.
- Passive viewer names or a “who viewed” list.
- Manager or leader detection.
- Space or company leaderboards.
- Streaks and daily-open rewards.
- Notifications, digests, or activity feeds.
- Likes, Kudos, reactions, or named recognition actions.
- Historical audience backfill from Mixpanel.
- Migrating or reviving legacy `DiagramLikes` rows.
- Exporting the attribution footer into PNG, PDF, or Word output.
- A new database, third-party data processor, or runtime feature flag.
