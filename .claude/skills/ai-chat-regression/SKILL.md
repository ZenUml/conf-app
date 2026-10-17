---
name: ai-chat-regression
description: Regress the current model and Prompt using saved original diagrams and modification instructions from the private corpus; supports simple model-layer-only regression and full regression with local jobs and real UI. Does not collect new production cases.
---

# Ordinary AI Chat Historical Regression

This skill replays only fixed ordinary-modification cases in `private/local-data/ai-chat-regression/`. Use [ai-chat-improvement](../ai-chat-improvement/SKILL.md) to find and fix new production issues, and [ai-chat-case-validation](../ai-chat-case-validation/SKILL.md) for single-case diagnosis. Do not mix syntax-error-driven repair cases into ordinary-modification regression.

## Scope and gates

Read the corpus index and each case's original DSL, complete `command`, expected changes, and preservation criteria; verify hashes and distinguish missing files from validated cases. If no scope is specified, first report the total case count and use the full corpus as the default candidate scope. If the user specifies a limit, explain the selection basis and uncovered cases. If the user says only “regression” without choosing a mode, ask: **simple** covers L2 only; **full** runs L2 → L3 → L4. If there are no historical cases, report an empty corpus; do not fabricate a passing regression.

Before model calls, determine the service for this run, default model, maximum call count or cost, and authorization to send the complete original diagrams and instructions. Authorization from an earlier batch does not automatically apply. If full regression L4 will put customer content in a test Confluence macro, separately confirm the specific site and whether a draft may remain. Mark cases `BLOCKED` when authorization or budget is insufficient; do not silently reduce scope and claim a full pass.

## Execution

`reasoningDisabled` is effective for L1–L4 in both AI Repair and AI Chat. This skill starts at L2 by default; if L1 is also run, use the same effective value there. Ordinary AI Chat currently uses Diagramly `ai-config.ts` to determine the provider default according to `AI_DISABLE_REASONING !== "false"`; Fix syntax also goes through `resolveRepairAIOptions` (default `true`). Explicitly write the boolean into this run's derived manifest, then verify the L2 model record, L3 request and job output, and L4 UI request and target environment. Do not mark a cross-layer PASS if the effective parameters differ or cannot be proven.

Create a record at private `runs/<run-id>/run.json` containing the selected cases, mode, budget ledger, authorization, conf-app and diagramly.ai versions, Prompt hash, input/instruction hashes, model, and evidence paths for each layer. Start each case from the **unchanged original diagram and instruction** and use the same model and layer gates as `ai-chat-case-validation`; do not use an old candidate as new input or substitute historical L4 success for current UI evidence. In simple mode, record L3/L4 as `SKIPPED (simple_regression)`.

At each layer, at minimum verify that the request returned and has no Error. A complete PASS also requires actual parsing/rendering, fulfillment of the instruction, and satisfaction of preservation criteria. Judge `noChange` only against the case's expected outcome. L3 must use a versioned asynchronous job. L4 must observe the request in the Forge UI, terminal status, editor code, and valid preview, and check for relevant page/network/console errors in this run. If the UI cannot be operated, record `BLOCKED` or `SKIPPED` with the reason; do not substitute unit tests.

Compare each case's historical status with this run's result. If a regression appears, save the raw output and earliest failing layer. Regression itself does not automatically change the Prompt, add trials, or switch to a stronger model. If the user requests a fix, proceed to case validation or continuous improvement within the explicit budget boundary.

## Delivery

Report covered and uncovered cases, each case's `PASS/FAIL/UNVERIFIED/BLOCKED/SKIPPED` status, instruction fulfillment, actual UI and network evidence, model/Prompt versions, call count, and cost source. A passing simple regression proves only this run's L2; a passing full regression covers only the cases and environments actually tested in this run. Code being written automatically into the editor does not mean the user accepted it or that it was saved to Confluence. Without a separate explicit request, do not commit, push, deploy, publish pages, or schedule recurring runs.
