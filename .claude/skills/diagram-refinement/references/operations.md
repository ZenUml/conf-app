# Operational evidence and staging

## External runtime and local input

This skill is a workflow and offline staging helper, not a standalone generation engine. For a local Mermaid file, freeze exact bytes/hash and render it without requiring customer identity queries. Selection and identity below applies only to an explicitly scoped newest-diagram request; staging adds all target checks.

The generation runtime `tools/pi-diagram-agent` is absent from current main. Its CLI was inspected read-only at commit `f0607412f` on `origin/park/pi-semantic-layout-contract-2026-10-10`; do not restore that branch automatically. Accept a separately supplied, verified runtime/package and Pi executable. Record paths, commit, local changes, dependencies and CLI before use. If unavailable, report generation **BLOCKED_RUNTIME_UNAVAILABLE**; still inspect/review supplied source, SVG and evidence. Never claim a model generated or reviewed an artifact when no call ran.

The inspected `bench/run-bench.mjs` accepts `--package`, `--fixtures`, `--reps`, `--concurrency`, `--out`, `--magic-options`, `--timeout-min`, `--pi-bin`, `--model`, `--auditor`, and repeatable `--env KEY=VALUE`. It starts real model calls and hardcodes the `openai-codex` provider and high thinking; it also contains machine-specific dependency defaults. Do not execute it merely to discover help. Read the actual supplied version, resolve Node/Mermaid/Playwright/Chromium and auditor paths, and override stale defaults. Before any call disclose provider, subscription/API billing, authentication, model, budget and known access/cost implications. Honor existing authorization and never silently switch providers or channels. Choose roles/models and time limits for the task, without a fixed model mandate.

After disclosure and authorization, adapt this template to the supplied verified CLI:

```sh
node <runtime>/bench/run-bench.mjs --package <verified-package> --fixtures <source.mmd> --reps 1 --concurrency 1 --timeout-min <authorized-minutes> --model <authorized-model> --pi-bin <verified-pi> --auditor <verified-auditor> --out <private-run-dir>
```

Output must be outside the repository for this CLI. Record roles actually called, semantic spec/caller brief and original render. A separately repaired/reviewed artifact needs a new external review receipt; never rewrite runtime manifests or claim native acceptance gates passed. Runtime defaults are not user choices.

For product integration locate current `src/utils/magic/artifact.ts` (validation and sanitization), `tools/mermaid-highlights/src/mermaid-highlights.mjs` and the shared interaction runtime. Verify deployed exports and versions; current reference exports include `validateMagicArtifact`, `readMermaidFlowchartModel`, and `attachPreparedSvgHighlights`. Do not assume a local file matches deployed code.

## Selection and identity

Use existing verified D1 and Mixpanel access. Check the selected environment's authoritative configuration; `wrangler-prod.toml` applies to production. For ordinary Mixpanel queries resolve `.claude/skills/mixpanel/scripts/mp_query.py` from the repository root to an absolute path, following local AGENTS.md overrides; keep its API Secret local and never print it. The CLI does not replace Mixpanel management functions. Keep secrets/private payloads out of console output. Access failure is unavailable, not empty activity. Apply project disclosure rules before changing authentication/provider.

Inspect schemas before adapting this known parameter-bound pattern:

```sql
SELECT cc.*, v1.createdAt AS v1CreatedAt
FROM CustomContent cc
LEFT JOIN CustomContentVersion v1
  ON v1.contentId=cc.contentId AND v1.appId=cc.appId AND v1.versionNumber=1
WHERE cc.cloudId=? AND cc.appId=? AND cc.status='current'
ORDER BY cc.createdAt DESC, cc.contentId DESC;
```

The verified storage shape parses as `JSON.parse(JSON.parse(body).raw.value)`; extract `mermaidCode` unchanged. Mermaid can use the Lite `zenuml-content-sequence` custom-content key; its name does not establish DSL type. Check metadata/model `diagramType` and the current Mermaid/Pi parser, including supported frontmatter/comments. Page through enough results to establish the newest eligible creation. ID tie-breaking cannot prove which identical-timestamp creation came first.

Cross-check version 1 and Mixpanel `macro_create_succeeded`; use current `macro_viewed`/`macro_save_succeeded` for identity/activity corroboration. Normalize string/numeric IDs, UTC times and site representations. Pad date boundaries for query timezone. Missing/stale creation evidence cannot be called verified. D1/analytics capture may be incomplete: report the newest **verified** creation with that limitation. A newer eligible candidate with unresolved evidence blocks automatic staging of an older fallback; obtain an explicit selection of that fallback if needed.

Verify tenant/site/cloud, product/app, selected environment/installation, exact content ID/macro UUID, page history, status and source hash together. Check `ForgeInstallation` and authoritative installation mapping. `DiagramAudience` can corroborate cloud ID; absence is not a contradictory identity.

A macro UUID can be copied across contents; it is not a unique delivery key. Investigate differing page IDs, timestamps and copy/recovery signals before staging. Preserve historical/current page evidence. Do not choose a convenient page, rename targets or substitute internal preview macros. Runtime delivery preserves the freshly read current container even if its historic page differs.

Save selection, exact source bytes, parsed semantic model, original renders and provenance in gitignored `private/local-data` or private external run directories; restrict permissions. Never commit customer diagram bodies or artifacts, even in the private submodule. Do not print source/model bodies unless requested.

## Staging

Fresh preflight follows repair: exact D1 source/hash/identity, selected installation evidence, page/macro mapping, existing Refined content and scoped queue. Changed source requires new generation/review. Conflicting evidence stops the write. Existing Refined/queue content is a separate replacement decision, never automatic overwrite.

Compare actual deployed validator/sanitizer/binder/runtime files with local preparation code; branch/SHA/build label alone is insufficient. Use verified current exports (`validateMagicArtifact`, `readMermaidFlowchartModel`, `attachPreparedSvgHighlights` in the precedent). Check artifact shape against code; current fields: `sourceHash`, `svg`, `rulesVersion: magic-v1`, `outcome: validated`, `generatedAt`.

Record source/reviewed/prepared/sanitized digests separately. Sanitization can alter XML/CSS representation. If numeric `tspan dy` must become absolute `y`, prove finite cumulative coordinates, exact text and unchanged other paint/geometry/semantics. Reject unsupported relative/mixed text instead of approximating; review transformed paint if equivalence is uncertain. Never bypass sanitization. Semantic binding must match source, including parallel edges/group endpoints. JSDOM BBox/CTM stubs prove binding only, not geometry/arrows/hover.

### Offline frozen request helper

Create private `handoff.json`; paths may be relative to it:

```json
{
  "target": {
    "clientDomain": "example-tenant", "productType": "lite", "environmentType": "PRODUCTION",
    "contentId": "<exact-id>", "macroUuid": "<verified-uuid>", "pageId": "<verified-page>",
    "customContentType": "<verified-current-type>"
  },
  "connection": {"accountId": "<verified-account>", "databaseId": "<verified-database>"},
  "scope": {"cloudId": "<verified-cloud>", "appId": "<verified-app>",
            "environmentId": "<verified-production-env>", "installationId": "<verified-installation>"},
  "snapshotPath": "current-content.json", "sourcePath": "source.mmd",
  "reviewedSvgPath": "reviewed.svg", "reviewPath": "review.json",
  "artifactPath": "artifact.json", "compatibilityPath": "compatibility.json"
}
```

Snapshot is one exact current D1 row with body/status/type/diagramType/version and identity. Review has `status` (`ACCEPTED` or `ACCEPTED_WITH_DISCLOSED_TRADEOFFS`), `sourceHash`, `svgHash`. Compatibility has `sourceHash`, `reviewedSvgHash`, prepared `svgHash`, `displayValidation: PASS`, `highlightBinding: PASS`, `paintGeometryTextAttributesPreserved: true`, produced from actual deployed-code checks. Receipt declarations never replace those checks.

```sh
python3 <skill-dir>/scripts/stage_request.py freeze --handoff <run-dir>/handoff.json --out <run-dir>/frozen-stage-request.json --client-domain example-tenant --product-type lite --environment PRODUCTION
```

Helper creates a UUID and fixed creation/30-day expiry once, with parameter-bound SQL requiring **no existing scoped queue** and **unchanged exact D1 identity/body/version/type**. It refuses to overwrite output. The payload is private: send from file through existing authenticated D1 tooling, never shell-interpolate/log it. Helper consistency does not prove external authorization, tenant ownership, visual quality or current customer source.

Freeze only after preparation and any required approval, immediately before the intended send. The SQL requires insertion within **two minutes** of frozen creation using D1's clock (`sendBy`); freeze time is the recorded queue creation time and the TTL remains exactly 30 days from it. Before sending once, check that window and compare the request-file SHA256 to the helper's original freeze receipt, then persist attempt time/request SHA256/delivery ID. If it elapsed before **any** attempt, retain the old request as canceled evidence, refresh preflight and freeze a new request; once any attempt exists, use readback only and never regenerate/resend automatically. One returned insertion plus exact readback proves staging. On timeout/uncertain response, stop writes and inspect read-only evidence. Zero rows requires investigation, not weakened predicates. D1 is a synced snapshot/queue, not the system of record: production delivery **must validate current Confluence source hash with viewer permissions before writing**.

Save exact scoped readback as a private JSON array:

```sh
python3 <skill-dir>/scripts/stage_request.py verify --request <run-dir>/frozen-stage-request.json --readback <run-dir>/queue-readback.json
```

This checks exact delivery/scope/content/source/SVG/artifact/timestamps. Lease state can change; lease or absence is not delivery proof. Retain attempt/result/readback/seed receipts and a short staging record.

## Monitoring handoff

Resolve the explicitly selected existing monitor/config if monitoring is requested. Derive the current count from config, never its name. Verify access/fingerprint/baseline before staging. Append only confirmed deliveries with exact IDs/hashes, original creation/30-day expiry, seed evidence path and own insert-attempt cutoff. Replacement cutoffs conservatively exclude old-revision signals and retain old history.

Use existing `migrate_append_only_state` or verified equivalent. Preserve all earlier targets/TTLs/baselines/timestamps/signals/history; do not reset on fingerprint mismatch. Save backups/migration evidence. Derive `expectedItemCount` from the list and `monitorUntil` from maximum configured expiry. Do not extend old queue TTLs or invent missing evidence.

Update **existing** heartbeat through supported `automation_update` (discover by tool metadata when deferred) or equivalent interface. Preserve ID/thread/notification preference and existing schedule. Do not hand-edit scheduler TOML or create duplicate cron. If scheduler access is unavailable, prepare the exact update and report handoff incomplete; do not claim scheduling applied. Verify saved config and one read-only poll.

Stay quiet on unchanged/non-actionable polls. Notify meaningful first write/display, bounded failure, explicit feedback, integrity problem, unconfirmed disappearance, expiry or unavailable access. At maximum expiry final-poll, save/report per-diagram summary, then pause existing heartbeat. Never renew queue items automatically or access customer pages/APIs.

## Evidence and event meaning

| Evidence | Permitted claim |
| --- | --- |
| Exact INSERT + identical D1 readback | Exact scoped prepared layout queued |
| `magic_writeback_completed` with `magic_writeback_outcome=written` | Successful backend write/readback outcome observed for content |
| `magic_view_succeeded` | Actual Refined display observed for content |
| `existing`, availability/default/request, lease, absence, expiry | No independent proof of delivery of this seed |
| No event/vote | No signal observed; not proof of failure/dislike |
| D1/analytics unavailable | Access unavailable; never zero |

Current events lack delivery/source/SVG hashes; cannot independently prove persistence/display of this **exact artifact**. Verify new deployed semantics before strengthening claims. Show times in the user’s timezone and keep UTC evidence. D1 `page_viewed` is page/tenant activity, not macro engagement; use Mixpanel `macro_viewed`. Missing request events can reflect inline suppression/cooldown: inspect deployed code instead of inferring from absence.


## Helper verification

The helper uses only Python’s standard library and performs no network, model calls, authentication or writes to D1. Run the complete suite from the repository root:

```sh
python3 .claude/skills/diagram-refinement/scripts/test_stage_request.py
```

`freeze` requires an independently supplied expected client/product/environment via the three CLI flags; it validates nonempty values and the product/environment choices, then compares them with the handoff. The Python API likewise requires `expected_target=` with `clientDomain`, `productType`, and `environmentType`. Products: `lite`, `full`, `diagramly`, `asyncapi`; environments: `DEVELOPMENT`, `STAGING`, `PRODUCTION`. These are intended target assertions, not external identity verification. A local preview needs none of these staging inputs.
