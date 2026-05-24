---
name: pvt-edit
description: >
  Focused production validation for the macro edit path (Forge custom UI modal, editor mount,
  Publish). Confirms opening Edit from the viewer loads the editor iframe and can publish or
  cancel without blank states. Invoked by release-app Step 5.5 when editor-related commits are detected.
  Triggers on "pvt-edit", "test macro edit", "validate editor", "pvt-editor".
---

# PVT — Edit path (Forge modal editor)

Focused post-release validation for **Edit → editor → Publish/cancel** on `zenuml.atlassian.net` (production). This is **not** the paywall flow — use `/pvt-paywall` when testing CSS/macro-limit upgrade modal.

## Arguments

Usage: `/pvt-edit [lite] [full] [diagramly]`

### Which product (variant) to test

1. **Explicit flags** — Test only the variants named on the command.
2. **Infer from conversation** — If no flags: use release context, `/release-app` target, Step 5.5 release variant, or user/branch language → **one** variant unless the user clearly asked to compare multiple.
3. **If still ambiguous** — Ask which variant. **Do not** run lite → full → diagramly by default.

Site: always production (`zenuml.atlassian.net`).

## Prerequisites

- Logged into production.
- User has permission to **edit** the test page (use a team space page you control).
- **Forge iframe** interaction only — same rules as `smoke-test` / `pvt-paywall`.

## Macro choice

Prefer **Mermaid** or **Sequence** for speed (single iframe depth). OpenAPI and DrawIO have different editor chrome — if commits touched those, pair this skill with `/pvt-swagger` or `/pvt-drawio` instead of overloading one run.

## Confluence page title (when creating a scratch page)

If you **create** a page (via `/smoke-test` or manually), use **`smoke-test` § Page title format**: include **product** (`lite` \| `full` \| `diagramly`), **datetime** `YYYY-MM-DD HH:mm`, and short label **`Mermaid`** or **`Sequence`** as appropriate.

## Steps

### 1. Open a published page with a macro

Use an existing PVT/smoke page or create one via `/smoke-test on zenuml <variant> mermaid` (titles must follow **`smoke-test` § Page title format**).

### 2. Open edit mode (Confluence)

Click **Edit** on the Confluence page so the document editor loads.

### 3. Open macro Edit from the viewer

Inside the **Forge iframe**, click **Edit** on the macro header (wait up to ~15s for permission gating).

**Expected:**

- Atlassian Forge modal: `[data-testid="custom-ui-modal-dialog"]`
- App iframe: `[data-testid="hosted-resources-iframe"]` with editor UI (tabs, code editor, or diagram canvas — depends on diagram type).

**Fail if:** iframe never appears, permanent spinner, or wrong app (e.g. picked another vendor macro).

### 4. Make a trivial change and publish

- **Mermaid/Sequence:** add a harmless comment or whitespace in DSL where supported, or rename the diagram title field if that is the stable control.
- Click **Publish** inside the iframe, then **Publish** the Confluence page.

**Expected:** return to view mode; diagram still renders; no data loss message.

**Fail if:** Publish disabled indefinitely, validation error loop, or save throws.

### 5. Cancel path (regression guard)

Repeat Edit → open modal → **Cancel** or close without saving (product-specific). Page should return to a consistent state without corrupting the macro.

### 6. Paywall note

If **upgrade / space limit** modal appears instead of the editor, you are in **paywall** territory — follow `/pvt-paywall` for that scenario; this skill assumes a space where edit is allowed or mocks are cleared.

## Optional automation

```bash
cd tests/e2e-tests
APP=<zenuml-lite@prod|zenuml-full@prod|diagramly@prod> pnpm exec playwright test tests/insert/mermaid.spec.ts --project=insert
```

Use insert smoke only when it matches the macro under test; insert failures on unrelated tabs do not automatically fail **this** skill if manual Edit path passes.

## Pass/Fail Report

```
## pvt-edit: PASS | FAIL
- Variant(s): lite | full | diagramly
- Step 3 (modal + editor mount): PASS | FAIL — <note>
- Step 4 (publish): PASS | FAIL — <note>
- Step 5 (cancel/close): PASS | FAIL | SKIPPED — <note>
```
