# Architecture Tokens — Phase 1 design (viewer "also appears in" context)

**Date:** 2026-08-27
**Status:** Converged (grill session, all branches resolved)
**Supersedes:** `2026-08-27-sequence-token-preprocessing-mvp0-design.md` (LLM-first, backend-only; its D1 tables and production secrets were removed the same day). The deterministic pipeline replaces it; model output is at most an optional overlay column, never the index.
**Pilot tenant:** one Lite tenant, referred to here as *the pilot tenant*. Its identity and every artifact derived from its content live in the git-ignored `private/local-data/architecture-tokens/` folder, never in any repository.

## 1. What a person sees

A reader opens a page with a Mermaid `sequenceDiagram`. After the diagram renders, a footer line appears under it, next to the existing attribution line:

> 5 of 7 participants also appear in other diagrams you can access · as of 27 Aug

Hovering or clicking a lifeline (an actor) opens a small popover:

> **Possibly related by name**
> Checkout — order flow (VPay) · as `PartnerApp`
> Refund handling (VPay) · as `Partner App`
> Partner onboarding (OP) · as `partner-app`

Nothing is rendered when the diagram is not a sequence diagram, the feature flag is off, the lookup fails, or no participant has an accessible related page. The diagram never waits for this: render completes first; the lookup runs afterwards and fails silently.

No "confirm" or "not the same" control exists in Phase 1. Copy is limited to the cautious forms in the product spec: *also appears in*, *Possibly related by name*. "Confirmed same Token" does not exist until Canonical Token IDs exist (Phase 2).

## 2. Three layers, kept distinct

| layer | field | example | meaning |
|---|---|---|---|
| raw diagram label | `rawLabel` | `Partner App` | Mermaid `Actor.description` — what the author wrote |
| lexical candidate key | `comparisonKey` | `partner.app` | non-binding grouping aid, recomputed on every run |
| canonical Token ID | — | `commerce.payments.api` | Phase 2; the only level that can mean "same enterprise object" |

`actorId` (Mermaid `Actor.name`, e.g. `PA` in `participant PA as Partner App`) is stored as the durable anchor `(contentId, actorId)` for Phase-2 decisions. It is never used as a grouping key: on the pilot corpus 248 of 379 aliased occurrences use ids of ≤3 characters (`DB`×24, `API`×17, `Svc`×13) that recur across unrelated diagrams.

The key is derived from the description only, case-folded, camel-case split, separators → `.`, emoji removed, **diacritics preserved** (`toán` ≠ `toan`). No stopword removal, no stemming, no version-suffix stripping: each of those is a semantic claim, and only a Token ID may make one. The grouping is **non-binding**: raw labels stay stored, the grouping is recomputed on every rebuild, and no decision derives from it.

## 3. Pipeline (local, phase 1)

Runs on a laptop. No Forge function, no scheduled trigger, no manifest change.

1. `tools/architecture-tokens/read-corpus.mjs` — reads the tenant's current Mermaid sequence diagrams from the D1 mirror (`CustomContent.body` → `$.raw.value` → `mermaidCode`). Tenant-wide: the tenant's `cloudId` comes from `AtlassianInstance` (`clientDomain = <domain>.atlassian.net`), its spaces from the `DiagramAudience(cloudId → customContentId) → CustomContent(spaceId)` join. That join lists spaces with at least one viewed diagram since 2026-08-12; it is a lower bound.
2. `tools/architecture-tokens/extract.ts` — every explicit `participant` / `actor` / `create …` declaration, `X as Label`, `box … end`, `;` separators, `%%` comments, YAML frontmatter. Verified against mermaid's own `sequenceDb.getActors()` under jsdom: 540/540 declarations on the pilot space, 0 mismatches. The retired regex dropped 42 of them (`actor`, `create`, bare multi-word labels).
3. `tools/architecture-tokens/pilot/participant-normalization.mjs` — the key (§2).
4. `tools/architecture-tokens/upload-index.mjs` — writes the current index to D1: `DELETE … WHERE cloudId = ?` then batched `INSERT`, one transaction. **Replace per tenant per run**; no history in D1 (run artifacts stay in `private/local-data/`). The table is created by migration `functions/migrations/0021_add_architecture_token_occurrence.sql`, applied by CI (`.github/actions/wrangler-publish/action.yml`, *Run D1 Migrations*) on staging deploy and on release — no hand-applied migration.

Cadence: manual, weekly (Monday morning AEST) and on demand. Freshness is shown as "as of <date>".

## 4. Storage — D1 (rebuildable)

```sql
CREATE TABLE ArchitectureTokenOccurrence (
  cloudId        TEXT    NOT NULL,
  spaceId        TEXT    NOT NULL,
  contentId      TEXT    NOT NULL,
  pageId         TEXT    NOT NULL,
  contentVersion INTEGER NOT NULL,
  actorId        TEXT    NOT NULL,
  rawLabel       TEXT    NOT NULL,
  comparisonKey  TEXT    NOT NULL,
  declKind       TEXT    NOT NULL CHECK (declKind IN ('participant','actor')),
  lineNumber     INTEGER NOT NULL,
  runId          TEXT    NOT NULL,
  indexedAt      TEXT    NOT NULL,
  PRIMARY KEY (cloudId, contentId, actorId, lineNumber)
);
CREATE INDEX ArchitectureTokenOccurrence_key     ON ArchitectureTokenOccurrence (cloudId, comparisonKey);
CREATE INDEX ArchitectureTokenOccurrence_content ON ArchitectureTokenOccurrence (cloudId, contentId);
```

`rawLabel` in D1 adds no new data class: `CustomContent.body` already holds the whole diagram. Confluence stays the system of record; this table is derived and rebuildable; rendering never depends on it.

## 5. Read path — one authenticated route

`GET /api/architecture-tokens/related?customContentId=<id>` (Cloudflare Pages Function; path added to `public/_routes.json` and to `AUTHENTICATED_PATHS` in `functions/_middleware.ts`), called from the viewer through `callRemote` (`invokeRemote`, Forge-authenticated), the same pattern as `src/services/DiagramImpact.ts`.

Server:

1. `cloudId` from the authenticated Forge context (`functions/utils/authenticate.ts`), never from the client.
2. Occurrences of `customContentId` for that `cloudId` → their `comparisonKey`s → all other occurrences with those keys in the same `cloudId`.
3. **Permission filter in the backend:** one Confluence call **as the requesting user** (`x-forge-oauth-user` bearer, as in `functions/utils/confluenceUtils.ts`): CQL `id in (<pageIds>)` batched at 100 ids. Only pages that call returns — with their titles — go into the response. No `pageId`, title, or label of an inaccessible page is ever on the wire.
4. Response:

```json
{
  "indexedAt": "2026-08-27T05:00:00Z",
  "contentVersion": 7,
  "participants": [
    { "actorId": "PA", "rawLabel": "Partner App",
      "related": [ { "contentId": "…", "pageId": "…", "pageTitle": "Checkout — order flow", "spaceKey": "VPay", "rawLabelThere": "PartnerApp" } ] }
  ]
}
```

`related` excludes the requesting diagram itself and is empty for participants with no accessible match. Any failure returns a 2xx with `participants: []` plus an `error_kind` so the client stays silent and the event still records the failure.

## 6. Gate — Forge feature flag

`architecture-tokens-enabled` on the Lite app (created 2026-08-27, ID type `installContext`): rule 1 `everyone` → development + staging; rule 2 `installContext is any of [<pilot site ARI>]` → **production only**, pass 100%; default `false`. Read through the `@forge/bridge` `FeatureFlags` SDK exactly as `src/apis/aiTitleFeatureFlag.ts` does. When the flag is false the viewer makes no call: fleet cost is zero.

Three retired flags (`renderer-prefetch-banner`, `renderer-prefetch`, `viewport-gated-render`) were deleted to free the slot, after confirming their code gates were removed at `origin/main` and present in every Lite production build serving traffic.

## 7. Viewer UI

- Component `RelatedDiagramsFooter.vue`, mounted next to `DiagramAttributionFooter` in `GenericViewer.vue`, only when `macroType === 'mermaid'`, the source starts with `sequenceDiagram`, and the flag is true.
- After the diagram has rendered, it calls the route once; on ≥1 participant with related pages it renders the footer line.
- Lifeline mapping: mermaid stamps `name="<actorId>"` on every rendered actor element. Delegated `mouseenter` / `click` on the SVG container resolves `closest('[name]')` → `actorId` → the popover. Participants whose `actorId` is not present in the current SVG (renamed since indexing) are dropped.
- Popover: title *Possibly related by name*; one row per related page: page title (link opens in a new tab through Forge `router.open`), space key, `as <rawLabelThere>` when it differs from this diagram's label. Closes on mouse leave / Escape.
- Inline and fullscreen render identically. No side panel in Phase 1.

## 8. Analytics (required before implementation)

`feature_area: 'architecture_tokens'` (new `FeatureArea` value), `surface: 'viewer' | 'fullscreen'` (the value `GenericViewer.vue` already stamps for fullscreen), `macro_type: 'mermaid'`.

| event | trigger | properties |
|---|---|---|
| `related_diagrams_lookup_succeeded` | route returned after render | `participant_count`, `participants_with_related`, `related_pages_total`, `index_age_days`, `duration_ms` |
| `related_diagrams_lookup_failed` | route error / timeout / `error_kind` in body | `error_kind`, `duration_ms` |
| `related_diagrams_shown` | footer rendered with ≥1 related participant | same counts as succeeded |
| `related_diagram_popover_opened` | hover or click on a lifeline with related pages | `related_count`, `trigger` (`hover` \| `click`), `label_variant_count` |
| `related_diagram_link_clicked` | a related page link opened | `related_count`, `same_space` |

No label text, page id, or tenant vocabulary in any event. Not emitted: lookups when the flag is off (no call), and `shown` on zero results.

## 9. Privacy and data rules

- Customer content (corpus, labels, model outputs, tenant ids) is never committed to any repository, `private/` included; it lives under the git-ignored `private/local-data/` (policy: `docs/policies/client-privacy.md`).
- The public repo names the tenant only as *the pilot tenant*.
- The route serves data only for the caller's own `cloudId`; the permission filter runs as the caller.

## 10. Out of scope (Phase 1)

Editor surface; Token Discovery page; Canonical Token IDs, aliases, "keep separate" decisions and the Decision table; any LLM step; non-sequence Mermaid; side panel; Forge scheduled indexing; fleet rollout.

## 11. Verification

- Unit: extractor oracle parity (exists), normalizer (exists), route (D1 + Confluence mocked), footer component (mount, hover mapping, silent failure).
- Local end-to-end on lite-dev: upload an index built from the dev site's own diagrams, flag rule 1 covers development, open a page with a sequence diagram, screenshot the footer and the popover, capture the five events from the iframe's Mixpanel `/track/` POSTs.
- Production: after release, one page on the pilot site cannot be opened by us (no account there). Runtime evidence comes from Mixpanel: `related_diagrams_lookup_succeeded` with the released `app_version` and `client_domain` of the pilot tenant.
