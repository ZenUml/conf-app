---
name: pvt-ai-repair
description: >
  Focused production validation for the AI Repair flow in diagram editors: syntax error banner,
  AI Repair modal, asynchronous fix-diagram job polling, editable diff, Apply Code, and save/render
  after applying the repair. Invoked by release-app Step 2.6 when AI repair, SyntaxErrorBox,
  GenerateService, diagramly fix-diagram, or validation/error-surface commits are detected.
  Triggers on "pvt-ai-repair", "test ai repair", "validate ai repair", "repair broken diagram".
---

# PVT - AI Repair

Focused post-release validation for the **AI Repair** editor flow on `zenuml.atlassian.net` (production).

AI Repair is launched from `SyntaxErrorBox` after the editor reports a syntax error. The flow calls
`/diagramly/fix-diagram`, polls `/diagramly/job-status`, shows an editable diff, then applies repaired
code back into the editor.

## Arguments

Usage: `/pvt-ai-repair [lite] [full] [diagramly] [mermaid|sequence|plantuml|openapi]`

### Which product (variant) to test

1. **Explicit flags** - Test only named variants, in order.
2. **Infer from conversation** - Release tag, `/release-app` variant, Step 2.6 pass-through, branch/PR wording, or user wording -> test that product only when unspecified.
3. **If still ambiguous** - Prefer **lite** for AI feature validation because Lite is where AI affordances are commonly exposed. If the conversation is clearly about another product but not explicit, ask once. Do **not** run all three automatically.

Site: always production (`zenuml.atlassian.net`).

### Which macro type to test

Default macro: **Mermaid**. It is fast, uses the standard Workspace editor, and has deterministic syntax-error validation.

Use another macro only when the release delta requires it:

| Macro | Use when | Notes |
|---|---|---|
| Mermaid | default / generic AI Repair changes | Standard Workspace + `SyntaxErrorBox`; easiest deterministic invalid input |
| Sequence | sequence parser / shared editor changes | Standard Workspace + `SyntaxErrorBox` |
| PlantUML | PlantUML validation or rendering changes | Standard Workspace + `SyntaxErrorBox` |
| OpenAPI | swagger editor / OpenAPI validation changes | Separate Swagger editor shell; still mounts `SyntaxErrorBox` |
| Graph | not supported by this skill | DrawIO does not use the code-editor `SyntaxErrorBox` repair flow |

## Prerequisites

- Logged into production.
- The selected variant is installed and the selected macro is available.
- AI Repair is gated by the Forge feature flag `ai-repair-enabled`, read via the `@forge/bridge` client flag SDK (`src/apis/aiTitleFeatureFlag.ts`). If the button is missing, check the flag's **production** environment chip in the Developer Console before failing the UI — a rule showing "Everyone 100%" can still cover only dev/staging, returning `false` in prod. Do **not** query `/api/features` (that KV endpoint does not gate this feature).
- Diagramly backend credentials must be configured in the production Cloudflare project. Backend failure from missing `DIAGRAMLY_API_KEY` or upstream Diagramly outage is a real **FAIL** for this PVT unless the release explicitly did not touch the backend and the incident is already known.
- Use Playwright for Forge iframes. Browser tools that cannot cross sandboxed Forge iframes are not sufficient.

## Confluence page title (scratch pages)

When **creating** a page for this run, set the title before inserting the macro:

```text
Smoke Test <lite|full|diagramly> <YYYY-MM-DD HH:mm> (AI Repair <macro>)
```

Use the resolved variant and local `YYYY-MM-DD HH:mm`. Append seconds only on duplicate-title errors.

## Test fixture input

Use a deliberately broken diagram that produces a visible syntax error but is obvious for AI to repair.

Recommended Mermaid fixture:

```text
graph TD
  A[Start --> B[Broken bracket]
```

Expected repair shape: Mermaid code with balanced brackets, for example `A[Start] --> B[Broken bracket]`.
Do not require exact AI output; require valid repaired syntax and preserved intent.

For other macro types, introduce one small syntax error only. Avoid customer content and avoid real tenant names.

## Steps

### 1. Create or open an editor page

- Create a scratch page under the normal PVT parent (`ZEN` / `247136259`) or reuse an existing smoke page you control.
- Insert the selected macro for the resolved variant.
- Wait for the Forge editor iframe (`[data-testid="hosted-resources-iframe"]`) to mount.

### 2. Introduce a syntax error

In the editor iframe, replace the diagram code with the broken fixture for the selected macro.

Expected:

- A bottom `Syntax error` banner appears.
- The banner includes the **AI Repair** button.
- The error text is meaningful enough to pass to the repair API.

**Fail if:** no syntax error appears, the editor remains stuck, or the AI Repair button is missing while the `ai-repair-enabled` Forge flag is enabled for the production environment.

### 3. Start AI Repair and verify backend job creation

Before clicking **AI Repair**, start capturing network requests from the page and Forge iframe.

Click **AI Repair** in the syntax error banner.

Expected:

- Dialog overlay `data-testid="ai-repair-dialog-overlay"` appears.
- Dialog content `data-testid="ai-repair-dialog-content"` appears with title **AI Repair**.
- UI shows `Starting AI repair...` or a progress/loading state.
- A POST request is made to `/diagramly/fix-diagram`.
- The response includes a non-empty `jobId`.

**Fail if:** the modal does not open, `/diagramly/fix-diagram` is not called, the request returns 4xx/5xx, or no `jobId` is returned.

### 4. Verify polling and completion

Wait for polling to `/diagramly/job-status` to complete. The UI polls for up to about 60 seconds.

Expected:

- At least one POST request to `/diagramly/job-status`.
- Final status is `COMPLETED`.
- Response includes `output.diagramCode`.
- The modal switches from spinner/progress to a two-column diff:
  - `Original`
  - `Repaired (Editable)`
  - footer buttons `Discard` and `Apply Code`

**Fail if:** polling never starts, status becomes `FAILED`, the modal times out, completion lacks `output.diagramCode`, or the diff never renders.

### 5. Exercise editable diff controls

Run a minimal interaction on the diff before applying:

- Toggle at least one changed-line checkbox off and back on, if a changed-line checkbox is present.
- Double-click one repaired line, make a harmless edit that keeps syntax valid, then commit with Enter or blur.

Expected:

- The modal remains stable.
- The changed-line state visibly updates.
- `Apply Code` remains enabled.

If the AI output has only unchanged lines and no checkbox, mark the checkbox sub-step **SKIPPED** with the reason.

### 6. Apply the repair

Click **Apply Code**.

Expected:

- Modal closes.
- Editor code is replaced with the final repaired code.
- The syntax error banner disappears after validation.
- The live preview renders successfully.

**Fail if:** modal closes but code is unchanged, the syntax error persists for repaired valid code, preview stays blank, or an exception appears in the iframe console.

### 7. Save and verify published render

Click **Publish** in the macro editor, then publish the Confluence page.

On the published page:

- The macro iframe renders.
- The diagram content is visible and not blank.
- Toolbar version string, if shown, matches the release under test.

**Fail if:** save is disabled indefinitely, save fails, published page renders the old broken content, or the viewer iframe is blank.

### 8. Negative/dismissal path

Reopen the editor, reintroduce the broken fixture, click **AI Repair**, then click **Discard** or close the modal.

Expected:

- Modal closes.
- Original broken code remains in the editor.
- Syntax error banner remains visible.
- No repaired code is applied.

**Fail if:** dismissing applies changes, clears the error, or leaves polling running with visible UI side effects.

## Optional backend-only probe

Use this only when UI access is blocked but production backend validation is still needed. It does not replace the full UI PVT when UI changes shipped.

```bash
curl -sS -X POST 'https://<prod-pages-domain>/diagramly/fix-diagram' \
  -H 'content-type: application/json' \
  --data '{"accountId":"<test-account-id>","diagramType":"mermaid","diagramCode":"graph TD\n  A[Start --> B[Broken bracket]","errorMessage":"Syntax error"}'
```

Then POST the returned `jobId` to `/diagramly/job-status`. Use only test accounts and placeholder content.

## Pass/Fail Report

```text
## pvt-ai-repair: PASS | FAIL | SKIPPED
- Variant(s): lite | full | diagramly
- Macro type: mermaid | sequence | plantuml | openapi
- Step 2 (syntax error + AI Repair button): PASS | FAIL - <note>
- Step 3 (fix-diagram job created): PASS | FAIL - jobId=<id or N/A>
- Step 4 (job-status completed + diff rendered): PASS | FAIL - <note>
- Step 5 (editable diff controls): PASS | FAIL | SKIPPED - <note>
- Step 6 (Apply Code updates editor + clears error): PASS | FAIL - <note>
- Step 7 (save + published render): PASS | FAIL - <version string or N/A>
- Step 8 (discard leaves original broken code): PASS | FAIL | SKIPPED - <note>
```
