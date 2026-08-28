# `attachment_not_found` — Mixpanel analysis (2026-08-28)

Window: **2026-07-28 .. 2026-08-25** (28 days), external tenants only (canonical
internal-domain exclude list). Source: Mixpanel project `3373228`, JQL.

Tenant names are redacted here per [client-privacy](../policies/client-privacy.md).
The ranked tenant list lives in the `private/` submodule.

---

## 0. Read this first — the published numbers are wrong by ~190x

Every prior write-up of this failure (`docs/features/paywall.md`: "517/mo";
`docs/adr/0004`: "305 events over one week"; `docs/features/export-pipeline.md`:
"65% of failures") was measured **before** commit `528817f`, which gave export
events a UUID `$insert_id`. Until then Mixpanel collapsed every macro of one page
export into a single event — the code comment records 12,407 real `exportMacro`
invocations in 24h against **65** recorded `macro_export_requested`.

The step change is visible and is the fix landing, not a regression:

| Week | `macro_export_requested` | `attachment_not_found` | rate |
|---|---|---|---|
| 2026-07-27 | 1,343 | 263 | 19.6% |
| 2026-08-03 | 1,312 | 241 | 18.4% |
| 2026-08-10 | 1,247 | 252 | 20.2% |
| **2026-08-17** | **85,851** | **43,000** | **50.1%** |

Do not compare across 2026-08-17. Do not quote the older figures.

A second break follows on **2026-08-26**: `src/lib/exportSampling.js` samples
`macro_export_requested`/`succeeded` at 5% and `macro_export_failed` at 10%.
Counts after that date need `count / sample_rate`, and the two rates differ, so a
raw failure *ratio* after 2026-08-26 is inflated 2x.

## 1. Scale

| Event | 28d count |
|---|---|
| `macro_export_requested` | 122,203 |
| `macro_export_succeeded` | 62,321 |
| `macro_export_failed` | 60,582 |

`attachment_not_found` is **58,143 — 96.0% of all export failures** and 47.6% of
all export invocations. Every other failure reason is a rounding error
(`attachments_api_404` 3.5%, `missing_custom_content_id` 0.5%, rest <0.2%).

## 2. The headline number is not a user-facing problem

Splitting by `format` changes the conclusion completely:

| format | requested | succeeded | `attachment_not_found` | anf % of requested |
|---|---|---|---|---|
| **other** | 111,065 | 53,074 | **56,212** | **50.6%** |
| email | 8,988 | 7,212 | 1,806 | 20.1% |
| pdf | 1,048 | 932 | 109 | 10.4% |
| feed | 667 | 668 | 9 | 1.3% |
| diff | 232 | 232 | 0 | 0.0% |
| word | 198 | 198 | 7 | 3.5% |
| html_export | 5 | 5 | 0 | 0.0% |

**The genuine user-initiated PDF/Word export path is healthy** — 116 failures in
28 days across both formats combined. 96.7% of `attachment_not_found` is
`exportType: 'other'`, the unidentified caller that issue **#554** is still open
to name.

Until #554 names that caller we cannot say whether *any* human sees these
failures. That makes #554 the gate on prioritising the rest of this document, not
a side quest.

## 3. It is a handful of tenants re-sweeping the same few thousand macros

Within `format: 'other'` + `attachment_not_found`:

- **76** tenants, but the top 2 are **69.7%** and the top 5 are **83.4%** of all events
- only **3,228 distinct macros** produce all 56,212 events
- mean **17.4 repeat failures per macro** over 28 days; the worst tenant averages 139

Combined with the fixed hourly cadence already noted in `src/export.js`, this is a
scheduled export tool at a few sites, walking whole spaces on a timer and hitting
the same never-viewed macros again and again.

## 4. The macros genuinely have no PNG and never will

For the top 8 tenants over a 59-day window, joining failing macros to
`macro_viewed`:

- **90.2%** of failing macros were never rendered by any browser in 59 days
- those macros account for **94.5%** of the failure events

This confirms and strengthens #434's 79.2%. **Retry-with-backoff cannot help
this population** — there is no upload in flight to wait for. Only generating the
PNG without a viewer (at save time, or server-side) can.

## 5. New finding — `macro_type: 'none'` is an unfixed permission gap, not deleted content

`macro_type: 'none'` is the single largest bucket at **36.2%** (21,064 events).
The code comment treats it as a catch-all ("content deleted, page restricted,
asApp() lacking read access"). The data says it is overwhelmingly the third case:

| population | events | type unresolved (`none`) |
|---|---|---|
| used the asUser fallback | 14,047 | **13,892 = 98.9%** |
| did not | 44,096 | 7,172 = 16.3% |

**6.1x enrichment.** An export that needed `asUser()` to read the attachments API
almost *always* fails to resolve its diagram type.

The mechanism is a one-line asymmetry in `src/export.js`:

- the attachments lookup has an `asApp()` → `asUser()` 404 fallback (issue #74, line 404-425)
- `fetchPngDimensions` threads `usedAsUser` through to pick its requester (line 339)
- **`fetchCustomContentParsed` is `asApp()`-only** (line 80) — no fallback

So on a restricted page, `asApp()` cannot read the custom content, the type
resolves to `'none'`, and the failure is recorded as untyped. The pattern needed
to fix it already exists twice in the same file.

Consequences:
1. #435's per-type failure sizing is broken for a quarter of all failures.
2. Any future server-side render **cannot determine what to render** for exactly
   the restricted-page population — it would have to fix this first anyway.

## 6. Failure composition by diagram type

| macro_type | events | share |
|---|---|---|
| none (see §5) | 21,064 | 36.2% |
| sequence | 14,345 | 24.7% |
| mermaid | 11,029 | 19.0% |
| graph | 10,057 | 17.3% |
| openapi | 813 | 1.4% |
| plantuml | **78** | **0.1%** |

Two things follow.

**The save-time upload (#212) has a known, unclosed coverage gap.**
`src/forgeIndex.ts:1315` restricts save-time PNG creation to
sequence/mermaid/plantuml — its own comment says "graph/openapi editors have no
diagram to snapshot here (tracked separately)". That gap is **18.7%** of failures.

**ADR-0004's recommended first slice targets the smallest bucket in the data.**
ADR-0004 proposes "implement PlantUML only" as the smallest first slice. PlantUML
is **0.1%** of `attachment_not_found` — 78 events in 28 days. That slice was in
fact built (`4cc6952`) and rolled back a day later (`0100824` / PR #498), and the
later export work (`07ccb16`, `c521371`) established *why* it could not have
worked: the export ADF must reference a native Confluence media file by `fileId`,
and a `plantuml.com` URL is not one. The ADR's per-type feasibility analysis
stands; its slice ordering should be re-derived against these numbers.

---

## Recommendations, ranked by value / effort

1. **Give `fetchCustomContentParsed` the same `asApp()` → `asUser()` fallback the
   attachments lookup already has** (§5). Smallest change here, mirrors an
   existing in-file pattern, recovers the true type for ~24% of all failures, and
   is a prerequisite for any server-side render on restricted pages.

2. **Split the `attachment_not_found` label.** It currently conflates three
   different situations: never-rendered (fixable by generating the PNG),
   content-unreadable (a permission problem), and the race window. One label
   across all three is why the published numbers were misread for months. Emit
   distinct `failure_reason` values.

3. **Deduplicate the telemetry at source.** 17.4 identical failures per macro per
   month is what pushed the export family to 32.7% of all Mixpanel volume and
   forced the 5%/10% sampling on 2026-08-26. Sampling treats the symptom and
   costs resolution everywhere; keeping the first failure per
   `(custom_content_id, day)` and dropping repeats would cut the same volume by
   ~94% while *improving* the data.

4. **Close #554 — name the `exportType: 'other'` caller.** 96.7% of the problem
   sits behind a caller we cannot identify. The 1% payload-shape log is running;
   with 69.7% of volume in 2 tenants, asking those 2 what scheduled export tool
   they run is likely faster than waiting on the log.

5. **Extend save-time PNG upload (#212) to graph and openapi.** Closes 18.7% of
   failures for macros created after it ships, with no server-side rendering.

6. **Re-derive ADR-0004's slice order before implementing it.** On current data
   the value is in sequence (24.7%) + mermaid (19.0%) + graph (17.3%), not
   PlantUML (0.1%). Note items 1-5 are all cheaper and, together, address a large
   share of the same population.

## Reproducing

JQL against project `3373228`, exclude list per the **mixpanel** skill. Queries:
failure composition by `name`/`failure_reason`; by `macro_type`/`format`;
`format` x outcome for the rate table; `client_domain` x `custom_content_id` for
concentration; and a `macro_export_failed` / `macro_viewed` / `upload_attachment`
join on `custom_content_id` for the never-rendered share.
