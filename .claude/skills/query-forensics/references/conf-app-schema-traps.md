# conf-app D1 schema traps (verified 2026-07-26)

Facts paid for in a full session of wrong numbers. Verify dates before trusting counts —
templates and schema evolve; the *methods* here outlive the snapshots.

## CustomContent.body is double-encoded JSON with dead fields

```
body = {"raw":{"representation":"raw","value":"<JSON string>"}}
value = {"diagramType":"mermaid","code":"...","mermaidCode":"...","title":...,...}
```

Extraction (note the nesting, and `\$` escaping inside bash double quotes):

```sql
json_extract(json_extract(body,'$.raw.value'),'$.mermaidCode')
```

**The payload carries ALL content fields simultaneously; only the field matching
`diagramType` is user-visible.** A mermaid diagram keeps the ZenUML default template in its
`code` field forever, untouched, because the user never opens that tab. Consequence:
**any LIKE over the whole `body` is invalid for per-type content questions.**

| diagramType | user-visible field |
|---|---|
| mermaid | `mermaidCode` |
| sequence | `code` |
| plantuml | `plantUmlCode` |
| graph | `graphXml` |
| OpenAPI | unverified — sample rows first |

Content mix (2026-07): mermaid 72%, graph 12.6%, OpenAPI 5.8%, sequence 5%, plantuml 4.6%.

## Template generations found by frequency clustering (2026-07 snapshot)

- **sequence**: ≥3 generations. Current (2025-11→): 242-char `title Order Service` /
  `OrderController @EC2 <<BFF>>` — **no "Demonstration only", no Double_Click_Me marker**.
  Older: "(Demonstration only)" + `Double_Click_Me` variants.
- **mermaid**: `sequenceDiagram Alice->>John: Hello John, how are you?…` (~448 pristine rows).
- **plantuml**: 118-char `@startuml Alice -> Bob: Hello Bob…`.
- Templates change; **re-run the clustering, never reuse these strings as the only marker.**

Ground truth from that snapshot: settled unedited defaults ≈ **1–2% of all content**
(sequence ~2% settled; the headline "31%" was 89% trailing-3-month editing lag).

## appId is one column with two semantics

Declared `INTEGER`, actually holds **Connect small ints** (join `AppInstance` → tenant) and
**Forge variant-app UUIDs** (`8ad26115-…`=Lite, `49017727-…`=AsyncAPI) which identify the
**variant, not the tenant**. 71% of rows don't join `AppInstance`. Schema types lie here.

## Tenant attribution for CustomContent

- Best available bridge: `DiagramLikes` (`diagramCustomContentId` + `clientDomain`) →
  build `spaceId → clientDomain` map → amplifies to ~**19% coverage** (10,887 rows, 46 tenants).
  Biased toward engaged tenants; treat as sample, not census.
- `UserBehaviorEvent` (contentId + clientDomain) would be better but is **archived to R2**, table empty.
- `AnalyticsEventFact.contentId` matches almost nothing (389/55,698) — no macro events there.
- Mixpanel `client_domain` is bare subdomain; D1 `clientDomain` full hostname — convert to join.

## Internal accounts & domains for contamination checks

- E2E robot: `robot1yanhui` = `712020:888717c7-f038-42da-b149-754163a710ba` (top author of test defaults).
- Peng: `557058:0a2e245b-f5cd-42f7-bf07-a53b8d17e94f`, `5f07a383ce15e8002618291d`.
- Domain excludes: `zenuml` (contains-match), `whimet`, `full-stg`, `lite-stg`, `lite-dev`,
  `dia-stg`, `asyncapi-stg`, `diagramly`, `danshuitaihejie`.
  For customer-specific internal exclusions, also load
  `private/operations/internal-analytics-domain-exclusions.md`; keep those identifiers private.
- Session measurement: internal contamination of content counts ≈ 5% — real but not decisive.

## D1 / wrangler practicalities

- `GROUP BY substr(body,…)` over ~50k rows → intermittent `internal error [code 7500]`.
  Group on a short `substr()` of the **json_extract'ed field**, not the raw body; retry once.
- `--json` output is unreliable; parse stdout with a regex for the `"results": […]` block.
- `ORDER BY RANDOM() LIMIT n` is fine at 56k rows — use it for stratified sampling (70/type held up).
- Demo-page provenance: title `LIKE '%Demonstration only%'` is **NOT** demo-page evidence —
  that title is the template's own `title` line. Real demo-page diagrams ≈ 4 rows
  (`@Actor Client` body shape, no `PurchaseService`). Page property `diagramly-demo-page` is authoritative.
