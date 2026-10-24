# L4: conf-app Forge UI E2E

L4 is the only layer that covers the complete real path: conf-app → Forge bridge → Cloudflare Worker → Diagramly job → UI apply/render.

## Browser and environment

- Start and verify the five-service stack using the `joint-debug` skill. Do not run Forge upgrade unless the user explicitly requests it.
- First enumerate the current browser tabs, then take over the target page that the user already has open and is logged into. Do not call create/open to create a browser for a real account, a tab, or a new session.
- Use a browser tool that can both take over that tab and enter the Forge OOPIF in the current environment. If the current browser cannot be operated, follow project instructions to use the Codex built-in browser at the standard desktop viewport. If neither is available, mark `SKIPPED` and record the blocker.
- Use the Diagramly development macro and confirm that moduleKey, Forge tunnel, and Vite `PRODUCT_TYPE=diagramly` agree.

## Model selection and UI flow

1. In the macro editor, restore the exact damaged DSL specified by the manifest.
2. Read `DEFAULT_AI_REPAIR_MODEL` and `AI_REPAIR_MODEL_STORAGE_KEY` from `src/utils/aiModelConfig.ts`. Save the original value of that localStorage key. For a default-model test, temporarily remove the key so the first repair uses the product default model. When another model is explicitly specified, temporarily set the key to that model. Restore the original value after the test. If localStorage is inaccessible, record that and confirm the model from the actual request.
3. Wait for the actual syntax error banner and AI Repair button.
4. Start collecting network/console evidence and record when AI Repair is clicked.
5. Require the model in the `/diagramly/fix-diagram` request to match the model under test; the request must succeed and return a jobId. Count `/diagramly/job-status` polls and record the final status.
6. Record when the diff first becomes visible. The candidate must pass the applicable parser; check required anchors.
7. Click Apply Code and wait for the banner to disappear and the preview to succeed; save a screenshot or snapshot.
8. Do not click the stronger-model retry in the default flow. If the user explicitly asks to verify retry-button interaction, record the actual UI operation and request model separately; that model must first pass its own L2/L3 gates. In all cases, restore the original localStorage value saved in step 2.

By default, save only in the macro draft; do not click page-level Publish in Confluence. If the test must verify the published state, first confirm that the user has authorized publishing the test page.

## Timing

- `uiStartToDiffMs`: AI Repair click → diff visible.
- `uiApplyToRenderMs`: Apply click → error cleared and preview valid.
- `uiTotalMs`: AI Repair click → preview valid.
- Backend `durationMs` / `llmDurationMs`: read from final job output or network response.
- Calculate `proxyOverheadMs = uiStartToDiffMs - backendDurationMs` only when both clocks cover the same request and the result is non-negative.

## Evidence and failures

Retain at least the error state, diff state, valid preview after Apply, and network path/status/timestamp plus the actual requested model. Do not save authorization headers or customer DSL request bodies.

If the UI cannot be driven, the macro is missing, or the login session has expired, mark `SKIPPED` and record the blocker. An L3 result cannot substitute for L4 PASS.

## L4 record

Write one record to `l4/results.jsonl` for every model explicitly tested. A PASS record must include at least:

```json
{
  "id": "L4-1-selected-model",
  "runId": "<run-id>",
  "layer": "L4",
  "model": "<selected model>",
  "trial": 1,
  "status": "COMPLETED",
  "repairStatus": "PASS",
  "qualityGrade": "A",
  "syntaxValid": true,
  "renderValid": true,
  "identifierRetention": 1.0,
  "changedLineRatio": 0.02,
  "wallMs": 12345,
  "uiStartToDiffMs": 10000,
  "uiApplyToRenderMs": 2345,
  "backendDurationMs": 9000,
  "llmMs": 8000,
  "pollCount": 9,
  "promptTokens": null,
  "completionTokens": null,
  "reasoningTokens": null,
  "cachedTokens": null,
  "costUsd": null,
  "costProvenance": "unavailable_job_output",
  "evidencePaths": ["/absolute/path/error.png", "/absolute/path/final.png"]
}
```

For a `SKIPPED` record, preserve the planned model/trial, set `repairStatus: "SKIPPED"` and `qualityGrade: "UNVERIFIED"`, and explain the blocker in `error`. Report coverage separately from success rate; an environment blocker must not be counted as a model repair failure.
