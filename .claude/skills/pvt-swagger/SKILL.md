---
name: pvt-swagger
description: >
  Focused production validation for the OpenAPI / Swagger macro: insert or open editor, set title,
  publish, and verify rendered spec viewer in the Forge iframe. Invoked by release-app Step 5.5 when
  swagger/openapi-related commits are detected. Triggers on "pvt-swagger", "test openapi", "validate swagger macro".
---

# PVT — OpenAPI / Swagger macro

Focused post-release validation for the **OpenAPI / Swagger** macro on `zenuml.atlassian.net` (production).

## Arguments

Usage: `/pvt-swagger [lite] [full] [diagramly]`

### Which product (variant) to test

1. **Explicit flags** — Test only named variants.
2. **Infer from conversation** — Release tag, `/release-app` variant, Step 5.5 pass-through, or user/PR wording → test **that** product only when unspecified.
3. **If still ambiguous** — Ask lite / full / diagramly. **Do not** enumerate all three automatically.

**Lite** macros include a **Lite** suffix in the macro browser; Full and Diagramly do not — see `smoke-test` variant table.

Site: always production (`zenuml.atlassian.net`).

## Prerequisites

- Logged into production.
- App profile includes OpenAPI: Lite and Full on zenuml include this macro; Diagramly profile may differ — if macro missing in browse dialog, report **SKIPPED (macro not installed for variant)** not FAIL.

## Confluence page title (scratch pages)

When **creating** a page for this run, set the title per **`smoke-test` § Page title format**:

```text
Smoke Test <lite|full|diagramly> <YYYY-MM-DD HH:mm> (OpenAPI)
```

Use the **resolved variant** and **local** `YYYY-MM-DD HH:mm`. Append seconds only on duplicate-title errors.

## Reference flow (manual / MCP)

Align with `smoke-test` **OpenAPI** block:

1. Create page: `https://zenuml.atlassian.net/wiki/create-content/page?spaceKey=ZEN&parentPageId=247136259` — set **page title** first (§ Confluence page title).
2. Slash menu → **View more** → browse → search `openapi`
3. Pick **OpenAPI / Swagger** with the correct **app label** for the variant (`ZenUML for Confluence` vs `ZenUML for Confluence Lite` vs `Diagramly for Confluence`).
4. Insert → wait for Forge modal → iframe `hosted-resources-iframe`
5. Fill the **Title** field (`getByRole('textbox', { name: 'Title' })` per smoke-test)
6. **Publish** in iframe → **Publish** Confluence page
7. On published page: confirm **one** `ForgeExtensionContainer` / hosted iframe renders and Swagger UI (or stub) shows without blank body

**Fail if:** macro not found, title field missing, publish stuck, or published page shows empty iframe.

## Double-iframe note

Unlike DrawIO, OpenAPI is typically **single** `hosted-resources-iframe` — do not assume nested DrawIO-style frames.

## Optional automation

When `tests/e2e-tests` exists and OpenAPI is in the app profile:

```bash
cd tests/e2e-tests
APP=zenuml-lite@prod pnpm exec playwright test tests/insert/openapi.spec.ts --project=insert
# or zenuml-full@prod / diagramly@prod when supported
```

## Pass/Fail Report

```
## pvt-swagger: PASS | FAIL | SKIPPED
- Variant(s): lite | full | diagramly
- Insert + Title + Publish: PASS | FAIL — <note>
- Published render (spec visible): PASS | FAIL — <note>
- Version string in toolbar (if shown): <string or N/A>
```
