# Forge Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic interactive Forge deployment wizard that guides the user through (app, environment, site) and executes build, manifest edits, Forge deploy, install/upgrade, and optional tunnel while printing every raw command.

**Architecture:** Implement `scripts/forge-wizard.mjs` as a self-contained Node ES module exporting small pure helper functions (for unit tests) plus an interactive `main()` entrypoint. The script maintains a single source of truth config mapping `(app, environment)` to `APP_ID`, manifest edit commands, and backend base URLs. It deploys (with manifest restored in `finally`) before prompting for site installation, and only offers tunnel after a site is selected.

**Tech Stack:** Node.js + `@inquirer/prompts` + `yq` + `forge` CLI + `vitest` for unit testing.

---

### Task 1: Add wizard dependency + pnpm entrypoint

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml` (regenerate via `pnpm install`)
- Create: `scripts/forge-wizard.mjs` (next task)

- [ ] **Step 1: Add dependency**

Update `package.json` by adding `@inquirer/prompts` to `devDependencies`.

Example patch intent:
```json
"devDependencies": {
  ...
  "@inquirer/prompts": "^3.0.1"
}
```

- [ ] **Step 2: Run install to update lockfile**

Run:
```bash
pnpm install
```

Expected: `pnpm-lock.yaml` updates and command exits `0`.

- [ ] **Step 3: Add pnpm script**

In `package.json`, add:
```json
 "forge": "node scripts/forge-wizard.mjs"
```

Expected: `pnpm run forge -- --help` works once Task 2 is implemented (wizard handles `--help`).

- [ ] **Step 4: Smoke lint (no functional changes yet)**

Run:
```bash
pnpm lint
```

Expected: exits `0`.

---

### Task 2: Implement wizard helper functions + manifest edit preview

**Files:**
- Create: `scripts/forge-wizard.mjs`
- Create: `tests/unit/forgeWizard.spec.ts` (next task)

- [ ] **Step 1: Write failing unit test**

Create `tests/unit/forgeWizard.spec.ts` with a failing import + assertions. (Test code will be added fully in Task 3; for this step, create only the initial version so it fails until helpers exist.)

Test intent:
- For app `lite`, preview should include:
  - deleting `.app.licensing`
  - deleting `.modules["confluence:contentBylineItem"]`
- For app `full`, preview should have no yq manifest deletions
- For app `diagramly`, preview should include:
  - deleting `.modules["confluence:globalSettings"]`
  - deleting `.modules["confluence:globalPage"]`
  - deleting the `zenuml-embed-macro` macro item

Expected: `pnpm test:unit` fails because helpers are not implemented/exported yet.

- [ ] **Step 2: Run unit tests (confirm failure)**

Run:
```bash
pnpm test:unit
```

Expected: test failures referencing missing exports / import errors from `scripts/forge-wizard.mjs`.

- [ ] **Step 3: Implement helper exports in `scripts/forge-wizard.mjs`**

Create `scripts/forge-wizard.mjs` implementing:
- `export const APPS` config object (single source of truth)
- `export type AppKey = 'lite' | 'full' | 'diagramly'` (JSDoc types are fine)
- `export function getAppConfig(appKey)`
- `export function getManifestEditDescriptions(appKey)` returning array of user-facing strings
- `export function getManifestEditYqArgs(appKey)` returning array of `{ expr: string }` or array of `{ evalExpr: string }` used by yq

Add the following implementation (complete code for helpers only; wizard `main()` can remain TODO until Task 4):

```javascript
// scripts/forge-wizard.mjs
import fs from 'node:fs';
import path from 'node:path';

export const APPS = {
  lite: {
    appId: '8ad26115-211f-4216-971b-0540f606303d',
    connectKey: 'com.zenuml.confluence-addon-lite',
    sequenceMacroKey: 'zenuml-sequence-macro-lite',
    customContentKey: 'zenuml-content-sequence',
    liteKeySuffix: '-lite',
    liteTitleSuffix: ' Lite',
    appLabel: 'ZenUML for Confluence Lite',
    productType: 'lite',
    manifestEdits: [
      {
        description: 'Remove licensing (lite is free)',
        yqEvalExpr: 'del(.app.licensing)',
      },
      {
        description: 'Remove confluence:contentBylineItem',
        yqEvalExpr: 'del(.modules["confluence:contentBylineItem"])',
      },
    ],
    backendUrls: {
      staging: 'https://conf-stg-lite.zenuml.com',
      production: 'https://conf-lite.zenuml.com',
    },
    sites: {
      staging: ['lite-stg.atlassian.net'],
      production: ['zenuml.atlassian.net'],
    },
  },
  full: {
    appId: 'd9e4002b-120b-426b-834b-402a4a5adce7',
    connectKey: 'com.zenuml.confluence-addon',
    sequenceMacroKey: 'zenuml-sequence-macro',
    customContentKey: 'zenuml-content-sequence',
    liteKeySuffix: '',
    liteTitleSuffix: '',
    appLabel: 'ZenUML for Confluence',
    productType: 'full',
    manifestEdits: [],
    backendUrls: {
      staging: 'https://conf-stg-full.zenuml.com',
      production: 'https://conf-full.zenuml.com',
    },
    sites: {
      staging: ['full-stg.atlassian.net'],
      production: ['zenuml.atlassian.net'],
    },
  },
  diagramly: {
    appId: '01ede8b1-4e88-451a-b9ef-89eeef93afaf',
    connectKey: 'gptdock-confluence',
    sequenceMacroKey: 'gpt-diagram-macro',
    customContentKey: 'gpt-custom-content-key',
    liteKeySuffix: '',
    liteTitleSuffix: '',
    appLabel: 'Diagramly for Confluence',
    productType: 'diagramly',
    manifestEdits: [
      {
        description: 'Remove globalSettings + globalPage',
        yqEvalExpr: 'del(.modules["confluence:globalSettings"]) | del(.modules["confluence:globalPage"])',
      },
      {
        description: 'Remove embed macro (zenuml-embed-macro)',
        yqEvalExpr: 'del(.modules.macro[] | select(.key | test("zenuml-embed-macro")))',
      },
    ],
    backendUrls: {
      staging: 'https://conf-stg-lite.zenuml.com',
      production: 'https://conf-lite.zenuml.com',
    },
    extraEnv: {
      production: { DIAGRAMLY_BACKEND_API_BASE_URL: 'https://diagramly.ai' },
    },
    sites: {
      staging: ['dia-stg.atlassian.net'],
      production: ['zenuml.atlassian.net'],
    },
  },
};

export function getAppConfig(appKey) {
  if (!APPS[appKey]) throw new Error(`Unknown app key: ${appKey}`);
  return APPS[appKey];
}

export function getManifestEditDescriptions(appKey) {
  return getAppConfig(appKey).manifestEdits.map((e) => e.description);
}

export function getManifestEditYqArgs(appKey) {
  return getAppConfig(appKey).manifestEdits.map((e) => ({ expr: e.yqEvalExpr }));
}

// Placeholder for the wizard main() to be completed in Task 4.
if (process.argv[1] && process.argv[1].endsWith('forge-wizard.mjs') && process.argv.includes('--help')) {
  console.log('Forge wizard: add Task 4 implementation to run interactive flow.');
}
```

- [ ] **Step 4: Run unit tests (should still fail until Task 3 test creation is complete)**

Run:
```bash
pnpm test:unit
```

Expected: still failing because `tests/unit/forgeWizard.spec.ts` isn’t present or assertions are not aligned (Task 3 will finalize it).

---

### Task 3: Add unit tests for manifest edit preview helpers

**Files:**
- Create: `tests/unit/forgeWizard.spec.ts`

- [ ] **Step 1: Write failing test (if not already created)**

Create `tests/unit/forgeWizard.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  getManifestEditDescriptions,
  getManifestEditYqArgs,
} from '../../scripts/forge-wizard.mjs';

describe('forge-wizard manifest preview helpers', () => {
  it('lite deletes licensing and contentBylineItem', () => {
    const desc = getManifestEditDescriptions('lite');
    expect(desc).toContain('Remove licensing (lite is free)');
    expect(desc).toContain('Remove confluence:contentBylineItem');

    const yq = getManifestEditYqArgs('lite').map((x) => x.expr);
    expect(yq).toContain('del(.app.licensing)');
    expect(yq).toContain('del(.modules["confluence:contentBylineItem"])');
  });

  it('full has no manifest deletions', () => {
    expect(getManifestEditDescriptions('full')).toEqual([]);
    expect(getManifestEditYqArgs('full')).toEqual([]);
  });

  it('diagramly deletes global settings/page and embed macro', () => {
    const desc = getManifestEditDescriptions('diagramly');
    expect(desc).toContain('Remove globalSettings + globalPage');
    expect(desc).toContain('Remove embed macro (zenuml-embed-macro)');

    const yq = getManifestEditYqArgs('diagramly').map((x) => x.expr);
    expect(yq).toContain('del(.modules["confluence:globalSettings"]) | del(.modules["confluence:globalPage"])');
    expect(yq).toContain('del(.modules.macro[] | select(.key | test("zenuml-embed-macro")))' );
  });
});
```

- [ ] **Step 2: Run unit tests (confirm fail is resolved)**

Run:
```bash
pnpm test:unit
```

Expected: all unit tests pass (`PASS`).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/forgeWizard.spec.ts scripts/forge-wizard.mjs
git commit -m "feat(forge-wizard): add manifest preview helpers"
```

---

### Task 4: Implement interactive wizard + deterministic command execution (deploy/install/tunnel)

**Files:**
- Modify: `scripts/forge-wizard.mjs`

- [ ] **Step 1: Implement `.env.forge.local` parser + config resolution**

Add functions to `scripts/forge-wizard.mjs`:
```javascript
function parseEnvFile(filePath) { /* key=value parsing, ignores comments */ }
function resolveForgeEnvAndSite(environmentChoice) { /* for development read .env.forge.local */ }
function resolveBackendApiBaseUrl(appKey, environmentChoice, devEnvVars) { /* staging vs production */ }
```

Implement behavior:
- `development` reads `.env.forge.local`:
  - expects `FORGE_ENV` and `ATLASSIAN_SITE`
  - uses `BACKEND_API_BASE_URL` if present, else fall back to the app's staging backend URL
- `staging` uses `forge -e staging`
- `production` uses `forge -e production`

- [ ] **Step 2: Add interactive prompts using `@inquirer/prompts`**

Import:
```javascript
import { select, input, confirm } from '@inquirer/prompts';
```

Prompt steps:
1) Select app: choices `lite`, `full`, `diagramly`
2) Print:
   - App ID
   - Manifest changes (descriptions from `getManifestEditDescriptions`)
3) Select environment: `development`, `staging`, `production`
4) Build: always runs `pnpm build:<variant>` (variant derived from appKey)
5) Deploy:
   - backup `manifest.yml` to `manifest.yml.bak` (use a timestamped temp file to avoid collisions)
   - apply yq edits for selected app (iterate `getManifestEditYqArgs`)
   - run `forge settings set usage-analytics true`
   - run `forge deploy -e <forgeEnv> --non-interactive --verbose` (if verbose is required; otherwise omit)
   - restore manifest in `finally`
6) Select site (only shown after deploy step):
   - show known site(s) from config for `staging` or `production`
   - for `development`, include `ATLASSIAN_SITE` as known
   - choices always include:
     - each known site
     - `"Enter custom site..."`
     - `"None (skip install)"` (if chosen, print summary and exit immediately)
7) Install/upgrade if site selected:
   - try: `forge install --site <site> --product confluence -e <forgeEnv> --non-interactive`
   - on stderr containing `already installed` or `already installed`-like wording:
     retry `forge install --upgrade ...`
   - otherwise rethrow
8) Tunnel prompt (optional):
   - ask `Start forge tunnel?` (yes/no)
   - only if yes:
     run `forge tunnel -e <forgeEnv>`

- [ ] **Step 3: Print raw commands before every execution**

Implement:
```javascript
function runLoggedCommand(label, command, args, options = {}) { /* console.log → ... */ }
```

Command printing requirements:
- show exact `pnpm build:<variant>` command
- show each `yq eval '<expr>' -i manifest.yml` command
- show `forge settings set usage-analytics true`
- show `forge deploy ...` and `forge install ...` and `forge tunnel ...`
- For `forge deploy/install`, include environment variables in the printed line (e.g. `APP_ID=... CONNECT_KEY=... BACKEND_API_BASE_URL=... forge deploy ...`)
  - Implementation detail: build a printed prefix string from the env var map; do not attempt shell-quoting beyond minimal safety.

- [ ] **Step 4: Add production confirmation gate**

When environmentChoice is `production`, prompt:
```javascript
await confirm({ message: 'You are deploying to PRODUCTION. Continue?' })
```
If false, exit without doing deploy.

- [ ] **Step 5: Run unit tests**

Run:
```bash
pnpm test:unit
```

Expected: unit tests still pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/forge-wizard.mjs
git commit -m "feat(forge-wizard): add interactive deploy/install/tunnel wizard"
```

---

### Task 5: Final verification + usability checks

**Files:**
- Modify: none

- [ ] **Step 1: TypeScript/ESLint sanity**

Run:
```bash
pnpm lint
```

Expected: exits `0`.

- [ ] **Step 2: Manual dry run**

Run:
```bash
pnpm forge -- --help
```

Expected: prints help / exits `0` without prompting.

- [ ] **Step 3: Manual staging test (Forge-only)**

Run (choose `lite`, `staging`, deploy flow, pick site `lite-stg.atlassian.net`, choose `tunnel: no`):
```bash
pnpm forge
```

Expected:
- wizard prints appId + manifest deletions
- wizard prints yq and forge commands exactly
- deploy succeeds
- install/upgrade succeeds
- manifest is restored after deploy regardless of result

Note: Use staging, not production, for first verification.

- [ ] **Step 4: Commit if any follow-up fixes**

No commit required unless lint/verification reveals issues.

