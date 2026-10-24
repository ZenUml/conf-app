---
name: ai-chat-improvement
description: Build private cases from failed or suspicious ordinary AI Chat modifications, fix them, complete layered case validation, and run historical regression; use for continuous improvement. Use ai-chat-regression only to replay existing cases.
---

# Ordinary AI Chat Continuous Improvement

The cycle for one batch is: identify an actual issue → preserve the original diagram, instruction, and acceptance criteria → fix → validate layer by layer with [ai-chat-case-validation](../ai-chat-case-validation/SKILL.md) → check existing cases with [ai-chat-regression](../ai-chat-regression/SKILL.md). Comparing models is not a prerequisite for completing this cycle. This skill covers ordinary AI Chat modifications only; AI Chat syntax repair with an `errorMessage` is handled separately, and only the legacy `/fix-diagram` entry point uses the [AI Repair workflow](../ai-repair-improvement/SKILL.md).

## Find and select cases

First establish the time range, environment, and product variant the user cares about. If the scope is unclear, ask only about missing details that affect data retrieval. Follow [Production intake](references/production-intake.md): start with read-only aggregates, then retrieve raw records up to the case-count limit selected by the user. Select only jobs verified as ordinary conf-app chat modifications: versioned diagram ID, non-empty `command`, and empty `errorMessage`. Do not classify syntax repair or native Diagramly sessions as conf-app traffic based only on `Job.type = diagram_modification`.

A `FAILED` job is a technical-failure candidate; `COMPLETED` + `noChange` is a result to review because the request may already have been satisfied; `COMPLETED` + a version number indicates only that the backend wrote a version, not that the instruction was correct or saved to Confluence. Select cases using user reports, visible previews, and, when needed, manual semantic review. Mixpanel events do not contain the complete DSL, instruction, or jobId; do not reconstruct source text or assume one-to-one job correspondence from event counts.

Before calling a model, define the maximum number of cases, model calls, or cost for this run, and verify authorization to send the selected original diagrams, instructions, and current Prompt to the actual AI service/model. Putting a customer's original diagram in a test Confluence macro is a separate data destination; confirm the site and draft handling before reproducing in the UI. Authorization covers only the stated scope of this run. Track all spending in one ledger, including retries. Read-only statistics and offline organization may proceed first, but do not describe them as completed model validation.

## Preserve cases, fix, and accept

Use the [case format](../ai-chat-case-validation/references/case-format.md) to store the original DSL, complete `command`, source job, model, time, output, user report, and acceptance criteria in `private/local-data/ai-chat-regression/`. If evidence is missing about “what should change and what must stay the same,” mark `UNVERIFIED (missing_expectation)` and fill the gap using a user report or manual review; do not invent success criteria based on a fluent model response. Do not put customer content, identity, tenant information, or secrets in public files, task titles, PRs, or ordinary messages. Do not commit cases in the private submodule.

Run each case through the L2 → L3 → L4 gates in `ai-chat-case-validation`. At minimum, observe an AI Chat result with no job Error; a full PASS also requires syntax/rendering, instruction fulfillment, and actual UI preview evidence. For empty output, timeout, missing version, error code, unmet instruction, or failed UI update, locate and change the earliest failing layer, then retest with the same original diagram and instruction. Preserve all attempts and code/Prompt versions; a lucky success must not erase an earlier failure, and acceptance criteria must not be relaxed. Judge `noChange` against the case's expected outcome.

If a code fix introduces new product behavior, plan and register Mixpanel events first under the repository rules; existing `ai_chat_change_*` success events do not represent the user's explicit acceptance. When other tasks are running in parallel, do not modify their analytics events or Excel files. Preserve existing worktree changes. Do not create a worktree without the user's consent, and do not commit or deploy automatically.

## Historical regression and delivery

After the selected cases in this batch complete L4, run `ai-chat-regression` against the historical scope selected by the user, using the final code/Prompt. Simple regression covers L2 only; full regression runs L2 → L3 → L4. Do not describe either as full end-to-end coverage unless it actually is. Regression calls count against the same budget. If historical customer data is outside this run's model/UI authorization, verify authorization first. If a regression finds a regression, preserve evidence and return to the earliest failing layer for the relevant case; if the budget is insufficient, record `BLOCKED` and do not report the full corpus as passing.

Deliver the private corpus index, source evidence and acceptance criteria for each case, root causes, code changes, per-layer statuses and actual UI previews, plus historical regression coverage and uncovered items. Keep layers that were not actually run as `SKIPPED` or `BLOCKED`. This skill is a manually started batch with a defined limit; it does not authorize scheduled tasks, external messages, commits, pushes, deployments, or page publishing.
