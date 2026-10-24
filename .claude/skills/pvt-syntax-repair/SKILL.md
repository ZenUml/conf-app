---
name: pvt-syntax-repair
description: >
  Focused production validation for manual syntax-error repair in code-based diagram editors:
  syntax error detection, SyntaxErrorBox visibility, direct human correction in the editor,
  error clearing, preview render, save, and published render. Use this when parser validation,
  SyntaxErrorBox, editor validation, error-surface, Mermaid/ZenUML/PlantUML/OpenAPI syntax
  handling, or non-AI repair commits ship. Triggers on "pvt-syntax-repair", "test syntax repair",
  "validate syntax error repair", "manual syntax repair", or "repair syntax error without AI".
---

# PVT - Manual Syntax Repair

Focused post-release validation for **manual** repair of syntax errors on `zenuml.atlassian.net`
(production).

This skill validates the path where a user sees a syntax error and fixes the code directly in the
editor. It deliberately does **not** click **AI Repair** and does not validate `/diagramly/fix-diagram`
or `/diagramly/job-status`; use `/pvt-ai-repair` for that backend-assisted flow.

## Arguments

Usage: `/pvt-syntax-repair [lite] [full] [diagramly] [mermaid|sequence|plantuml|openapi]`

### Which product (variant) to test

1. **Explicit flags** - Test only named variants, in order.
2. **Infer from conversation** - Release tag, `/release-app` variant, Step 2.6 pass-through, branch/PR wording, or user wording -> test that product only when unspecified.
3. **If still ambiguous** - Prefer **lite** for generic syntax-validation changes because Lite is commonly used for editor validation smoke. If the conversation is clearly about another product but not explicit, ask once. Do **not** run all three automatically.

Site: always production (`zenuml.atlassian.net`).

### Which macro type to test

Default macro: **Mermaid**. It is fast, uses the standard Workspace editor, and has deterministic syntax-error validation.

Use another macro only when the release delta requires it:

| Macro | Use when | Notes |
|---|---|---|
| Mermaid | default / shared editor validation changes | Standard Workspace + `SyntaxErrorBox`; fastest deterministic invalid input |
| Sequence | ZenUML parser / sequence editor changes | Standard Workspace + `SyntaxErrorBox` |
| PlantUML | PlantUML validation or protected-line editing changes | Standard Workspace + `SyntaxErrorBox`; preserve `@startuml` / `@enduml` |
| OpenAPI | swagger editor / OpenAPI validation changes | Separate Swagger editor shell; still validates error clearing |
| Graph | not supported by this skill | DrawIO does not use the code-editor `SyntaxErrorBox` flow |

## Prerequisites

- Logged into production.
- The selected variant is installed and the selected macro is available.
- Use Playwright for Forge iframes. Browser tools that cannot cross sandboxed Forge iframes are not sufficient.
- If the **AI Repair** button is present in the error banner, ignore it for this skill. Its presence or absence is not a pass/fail condition here unless the release specifically changed that affordance.

## Confluence page title (scratch pages)

When **creating** a page for this run, set the title before inserting the macro:

```text
Smoke Test <lite|full|diagramly> <YYYY-MM-DD HH:mm> (Syntax Repair <macro>)
```

Use the resolved variant and local `YYYY-MM-DD HH:mm`. Append seconds only on duplicate-title errors.

## Test fixture input

Use one small syntax error, then manually replace it with the corresponding valid code.

| Macro | Invalid input | Manual repair |
|---|---|---|
| Mermaid | `graph TD\n  A B` | `graph TD\n  A --> B` |
| Sequence | `A.-method(）` | `A.method()` |
| PlantUML | `@startuml\nAlice -1> Bob: Hello\n@enduml` | `@startuml\nAlice -> Bob: Hello\n@enduml` |
| OpenAPI | Missing colon after `schema` in the YAML fixture below | Add `schema:` and a minimal `responses` block |

Recommended OpenAPI invalid fixture:

```yaml
openapi: 3.0.0
info:
  title: Pet Store API
  version: 1.0.0
paths:
  /pets:
    get:
      summary: List all pets
      parameters:
        - name: limit
          in: query
          schema
            type: integer
```

Recommended OpenAPI repaired fixture:

```yaml
openapi: 3.0.0
info:
  title: Pet Store API
  version: 1.0.0
paths:
  /pets:
    get:
      summary: List all pets
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
      responses:
        '200':
          description: Success
```

Avoid customer content and avoid real tenant names.

## Steps

### 1. Create or open an editor page

- Create a scratch page under the normal PVT parent (`ZEN` / `247136259`) or reuse an existing smoke page you control.
- Insert the selected macro for the resolved variant.
- Wait for the Forge editor iframe (`[data-testid="hosted-resources-iframe"]`) to mount.

### 2. Introduce a syntax error

In the editor iframe, replace the diagram code with the invalid fixture for the selected macro.

Expected:

- A bottom `Syntax error` banner appears.
- The error text is meaningful and specific to the invalid input.
- The editor remains interactive.

**Fail if:** no syntax error appears, the error appears for the wrong macro/editor, the editor becomes stuck, or the error surface is blank/meaningless.

### 3. Manually repair the code

Without clicking **AI Repair**, replace the invalid code with the repaired fixture for the selected macro.

Expected:

- The edited code remains visible in the editor.
- The syntax error banner disappears after validation.
- The live preview renders successfully and is not blank.

**Fail if:** the banner remains visible for valid code, the preview stays blank, the editor code reverts, or an exception appears in the iframe console.

### 4. Save and verify published render

Click **Publish** in the macro editor, then publish the Confluence page.

On the published page:

- The macro iframe renders.
- The repaired diagram/spec content is visible and not blank.
- Toolbar version string, if shown, matches the release under test.

**Fail if:** save is disabled indefinitely, save fails, published page renders the old invalid content, or the viewer iframe is blank.

### 5. Regression guard: re-break and re-repair

Reopen the editor, reintroduce the invalid fixture, wait for the syntax error banner, then manually repair it again.

Expected:

- The second invalid edit triggers the same error surface.
- The second manual repair clears the error again.
- Save remains possible.

**Fail if:** validation only works once, stale error state persists, or save remains blocked after valid code.

## Optional automation

Use this only when the local E2E profile maps cleanly to the target variant and site. The manual PVT above is still the source of truth for production release validation.

```bash
cd tests/e2e-tests
APP=zenuml-lite@prod pnpm exec playwright test tests/syntax-validation/mermaid.spec.ts --project=insert
APP=zenuml-lite@prod pnpm exec playwright test tests/syntax-validation/sequence.spec.ts --project=insert
APP=zenuml-lite@prod pnpm exec playwright test tests/syntax-validation/plantuml.spec.ts --project=insert
APP=zenuml-lite@prod pnpm exec playwright test tests/syntax-validation/openapi.spec.ts --project=insert
```

Swap `APP` to the resolved variant profile when testing full or diagramly.

## Pass/Fail Report

```text
## pvt-syntax-repair: PASS | FAIL | SKIPPED
- Variant(s): lite | full | diagramly
- Macro type: mermaid | sequence | plantuml | openapi
- Step 2 (syntax error detected): PASS | FAIL - <note>
- Step 3 (manual repair clears error + preview renders): PASS | FAIL - <note>
- Step 4 (save + published render): PASS | FAIL - <version string or N/A>
- Step 5 (re-break + re-repair regression guard): PASS | FAIL | SKIPPED - <note>
```
