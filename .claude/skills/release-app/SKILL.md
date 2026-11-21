---
name: release-app
description: >
  Release one named ZenUML Forge variant (lite, full, diagramly/dia, asyncapi/async/api)
  to production. The script selects the draft, enforces the canary gate, publishes,
  and waits for production smoke. Use when the user asks to release, deploy, ship,
  or promote a named variant, or asks for `release-app preflight`.
---

# Release

One variant per command. No variant named: ask which one. Do not release a variant the user did not name. `preflight` is the prepare command below and does not publish.

Script: `.claude/skills/release-app/scripts/release.sh`

Diagramly, Lite, Full, and AsyncAPI use this same command. Full stays behind Lite by 24 hours. The script enforces that. Do not pass an override.

## 1. Prepare

```bash
.claude/skills/release-app/scripts/release.sh <variant>
```

Exit 0 prints `READY` with the draft tag, commit, previous tag, gate line, source build, and a delta file. The delta file lists each commit as `behavioral` (touches `src/` or `functions/` outside tests) or `infra`.

Any other exit: stop. Show the script output. Do not dispatch a build and do not publish.

A direct request to release this variant authorizes the publish in step 2. `preflight` stops here.

## 2. Notes, then publish

Write the notes from the delta file. Behavioral commits become the user-facing lines. Infra commits become one trailing line, or are omitted when there is nothing to say. Do not put the draft placeholder (`This is a draft release`) in the notes. The script copies the draft's `Daily regression`, `Bypass reason`, and `E2E` lines onto the body.

```bash
.claude/skills/release-app/scripts/release.sh <variant> --publish --notes-file <file>
```

The script publishes only when the gate is `OK`. Lite also waits until Diagramly's smoke for the same commit is green and Diagramly's release carries a spot-check line. Full waits for the same from Lite. It then blocks until this variant's own deploy and smoke finish.

- Exit 0: smoke passed. The production `@smoke` run is the PVT.
- Exit 2: deploy succeeded and the workflow ran no smoke jobs. Confirm the behavioral lines on that variant's production site before publishing the next variant. AsyncAPI hits this until `release.yml` runs its prod smoke.
- Any other exit: stop. Do not publish the next variant.

## 3. Spot check

After exit 0 (or exit 2), spot check only the `behavioral` lines in the delta file, and only what prod smoke does not already cover. Smoke already inserts and renders. Then record the result before the next variant; the next publish is refused without it:

```bash
.claude/skills/release-app/scripts/release.sh <variant> --spot-check pass --note "<what was checked, where, evidence link>"
.claude/skills/release-app/scripts/release.sh <variant> --spot-check na --note "<why this variant cannot reach the change>"
```

- `na` when a behavioral path cannot be reached in this variant, or `behavioral` is 0. The note names the reason.
- A UI assertion that could not be driven is not `pass`. Record `na` only when the variant truly cannot reach the change; otherwise stop and report the blocker.
- The line goes on the variant's latest published release as `Spot check: PASS|N/A — <note>`. Re-running replaces it.

## More than one variant

Finish prepare, notes, publish, and the recorded spot check for one variant before starting the next. Diagramly then Lite is one sitting. Full is a later sitting; during the soak the script exits `BLOCK`.
