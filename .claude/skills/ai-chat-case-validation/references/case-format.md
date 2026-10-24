# Ordinary AI Chat Case Format

For each run, derive a run manifest from the immutable case manifest and write the current default model and boolean `reasoningDisabled` value into it. L1 (if run), L2, L3, and L4 must use the same effective value; this is not a setting exclusive to AI Repair.

A case fixes `original diagram code + user instruction + expected outcome`; do not deduplicate by DSL alone. Two different instructions for the same diagram are two cases. Customer data belongs only in a local private directory: `private/local-data/ai-chat-regression/cases/<opaque-id>/`. Temporary diagnostics may go in `/tmp/ai-chat-case-validation/<run-id>/`. Do not add these directories to the public repository or commit the private submodule.

```text
cases/<opaque-id>/
  input.mmd                 Original DSL, preserving the original bytes
  manifest.json             Run parameters and manual acceptance criteria
  source.json               Source job, time, status, model, and missing fields
  attempts/                 Append-only responses, candidates, scores, and code versions
  l4/                       UI and network evidence
```

The `manifest.json` example uses synthetic content only. Actual customer instructions may contain sensitive information and must not be copied into public documentation:

```json
{
  "dslPath": "input.mmd",
  "diagramType": "mermaid",
  "languageKey": "LANG_MERMAID",
  "subTypeKey": "FLOWCHART",
  "command": "Add a retry path after validation fails.",
  "expectedOutcome": "change",
  "requiredEffects": ["A failed validation reaches Retry"],
  "requiredAnchors": ["Validate", "Success"],
  "forbiddenEffects": ["The success path is removed"]
}
```

- `command` must be the complete instruction the user actually submitted; `errorMessage` must be absent or empty. An AI Chat request driven by a syntax error needs a separate workflow and is not an ordinary modification case; only the legacy `/fix-diagram` entry point uses AI Repair cases.
- `expectedOutcome` is usually `change`; use `no_change` only when evidence shows the original diagram already satisfies the instruction. `requiredEffects` and `forbiddenEffects` are criteria for manual semantic judgment; do not present string searches as semantic checks. `requiredAnchors` are the minimum items that can be checked mechanically.
- Before using the L2 runner, read the current `DEFAULT_AI_CHAT_MODEL` and write the actual default model into `models` in the private manifest. The example intentionally omits it so the example model is not mistaken for the product default. The L3 runner reads the default directly from product configuration.
- `source.json` records the source environment, job ID, UTC time, original status, input/instruction SHA-256 hashes, model source, and whether a user error report or undo was observed. Keep job IDs only in private evidence; do not put them in Mixpanel or public output. Once the original input, instruction, and expected criteria are established, append revision records; do not overwrite the original with model output.
- `corpus.json` stores case IDs, paths, input and instruction hashes, status, most recent observation time, and next step. Cases with the same input but different instructions, expectations, or failure reasons must not overwrite one another. Create a separate `runs/<run-id>/run.json` for each run to record scope, budget, authorization, code/Prompt versions, per-layer results, and evidence paths.
