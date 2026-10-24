---
name: forge-feature-flag
description: Create, enable, scope, and verify Atlassian Forge feature flags for Confluence apps. Use when asked to enable, roll out, disable, create, or check a Forge Feature Flag, especially before or after a release.
---

# Forge Feature Flag

Read the code and `flags-status.mjs` first. Open the Console list for a full inventory. Mutate in the Console only when asked.

## Workflow

1. Name the request: product variant, environment, key, and whether this is a read or a write. Lite, Full, Diagramly, and AsyncAPI each have their own flags.
2. Read that key’s `initialize()`: ID type is `identifiers`. Note the runtime signal that proves the flag is on.
3. Read current state with `flags-status.mjs`. Use the Console list only when you need a full inventory.
4. Stop if this is a read. On a write, use the `atlassian-developer-console` skill: create a missing key with the ID type from step 2, then change the requested environment.
5. Confirm the write on the Activity tab.
6. If the write affects deployed behavior, verify step 2’s signal in a live macro on that environment with `agent-browser --session conf-app --restore=stg`.

### Read flag state — `flags-status.mjs`

Use this for any read. Same token as `create-test-page` (`FORGE_EMAIL` / `FORGE_API_TOKEN` from `.env.forge.local`):

```bash
set -a; source .env.forge.local; set +a
node .claude/skills/forge-feature-flag/scripts/flags-status.mjs                  # all 4 apps
node .claude/skills/forge-feature-flag/scripts/flags-status.mjs --app lite --json
node .claude/skills/forge-feature-flag/scripts/flags-status.mjs --keys session-replay --history
node .claude/skills/forge-feature-flag/scripts/flags-status.mjs --include-branches   # find orphans
```

It reports live / deleted, last action, created-at, environments, and `--history`. Percentage ramps appear in `details` only when someone changed them; otherwise read the current % from the Console.

The public API requires a `flagId` and cannot list flags. The script only reports keys from `src/` at HEAD, `--keys`, or `--include-branches`. A Console-only flag is invisible — use the Console list for a full inventory. The typed `changes` field is always null; read `details`. Do not switch the query back to `changes`.

### Console

Drive UI work with the `atlassian-developer-console` skill, including its account check, before any write.

- list — `/console/myapps/<appId>/manage/feature-flags?environment=production&featureFlagStatus=All&interval=P6M`
- detail — `/console/myapps/<appId>/manage/feature-flags/<flagKey>`

`interval` is capped at `P6M`. App IDs: Lite `8ad26115-211f-4216-971b-0540f606303d`, Full `d9e4002b-120b-426b-834b-402a4a5adce7`, Diagramly `01ede8b1-4e88-451a-b9ef-89eeef93afaf`, AsyncAPI `49017727-af19-4ab6-8d5a-7d28108936b6`.

Each app allows 10 flags. At the cap, retire one before creating another. `checkFlag` defaults to `false`, so ungate a 100% live flag in code and release before deleting it.

Confirm writes on the **Activity** tab.

Rules evaluate top-down; the first match wins. Read the whole list before widening a rule, and report which rules that made redundant.

A new flag’s rule is **development + staging**; production starts off. After save, reload and read chips from the snapshot: selected is ✓, unselected is ○.

## Runtime verification

Drive the Forge iframe with `agent-browser --session conf-app --restore=stg` (spot-check skill). Read this flag’s own observable from the calling code — a Mixpanel property, a UI control, or a network request. If the first load still shows the default, wait for propagation and retry. Report the raw runtime value.

## Reporting

Report the app variant, environment, key, rollout scope, and runtime evidence. If verification cannot run, mark it **SKIPPED** with the blocker.
