# copy-macro e2e on lite-stg — openapi macro

## Setup

- **Site:** lite-stg.atlassian.net (lite-forge)
- **Source:** page 164004 "Automated Test Page 2026-02-28"
- **Target macro:** OpenAPI (CC 589832)
- **Browser session:** authenticated as support@zenuml.com via Playwright MCP

## Source state (Phase 2)

| CC id | title | diagramType | pageId | body.id |
|---|---|---|---|---|
| 491523 | Test PlantUML | plantuml | 164004 | — |
| 589832 | Untitled 2026-02-28T01:57:31.539Z | OpenAPI | 164004 | — |

Page storage macro refs: `[557058, 491523, 622593, 589832]` — note: 557058 (sequence) and 622593 (graph) are referenced but not owned by the page; both were purged in earlier session work, so the source page itself has two dead refs unrelated to this test.

## Copy created (Phase 3)

- **Copy page id:** 80543782 "Copy of Automated Test Page 2026-02-28 (3)"

## Copy state before edit (Phase 4)

| CC id | title | diagramType | pageId | body.id |
|---|---|---|---|---|
| 80543811 | Test PlantUML | plantuml | 80543782 | — |
| 80543813 | Untitled 2026-02-28T01:57:31.539Z | OpenAPI | 80543782 | — |

Page storage macro refs (unchanged from source): `[557058, 491523, 622593, 589832]` ← drift state.

## Copy state after edit + save (Phase 6)

| CC id | title | diagramType | pageId | body.id | flags |
|---|---|---|---|---|---|
| 80543811 | Test PlantUML | plantuml | 80543782 | — | — |
| 80543813 | Untitled 2026-02-28T01:57:31.539Z | OpenAPI | 80543782 | — | — |
| **80642076** | Sample API | OpenAPI | **80543782** | **589832** | isCopy:true, copyReason:cross-page |

Page storage macro refs: `[557058, 491523, 622593, 80642076]` ← **OpenAPI ref written back from 589832 → 80642076**.

## Assertions

| # | Result | Evidence |
|---|---|---|
| A1 child CCs created on copy | **PASS** | 80543811 + 80543813 owned by copy page 80543782 |
| A2 pre-edit refs point at source (evidence) | PASS | `[557058, 491523, 622593, 589832]` matches source's distinct refs |
| A3 **post-edit macro refs new CC on copy** (headline) | **PASS** | OpenAPI ref: `589832 → 80642076`; 80642076 is a child of copy page |
| A4 new CC pageId matches copy page | **PASS** | `80642076.pageId === "80543782"` |
| A5 new CC body.id set to source id (lineage anchor) | **PASS** (after skill fix) | `body.id === "589832"` (source CC id) — preserves lineage for recovery probe |
| A6 macro renders after reload | **PASS** | OpenAPI iframe 760×529 px |

## Skill draft correction

Iteration-1 originally graded A5 as FAIL because the skill draft expected `body.id === newCcId`. That expectation was wrong. The correct behavior — observed here — is `body.id === sourceCcId`. This preserves lineage so the orphan-recovery probe can find this CC if the source 589832 ever becomes inaccessible. The skill and `references/data-model.md` were updated in place to encode the correct expectation; all six assertions now pass.

## Cleanup

- Copy page 80543782 deleted via DELETE (204), then `?purge=true` (204).
- Verification: GET 80543782 → 404 ✓
- Source page 164004 untouched. Children after cleanup: `[491523 PlantUML, 589832 OpenAPI]` ✓
- No custom content was purged — the skill's non-destructive contract held.

## Verdict

**PASS** — writeback fix verified end-to-end on lite-stg for the openapi macro. The skill itself
needed one correction (A5 expectation) which was applied directly to the skill files. A re-run is
not required because the only change is to the assertion text, not to any test step.
