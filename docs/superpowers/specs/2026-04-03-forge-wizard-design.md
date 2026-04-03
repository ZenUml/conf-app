# Forge Wizard — Design Spec

**Date:** 2026-04-03
**Status:** Draft
**Problem:** Developers face high cognitive burden when working with Forge deployments. The current `package.json` has 28 forge-related scripts — a manual expansion of every (app × environment × action) combination, each hardcoding APP_ID, CONNECT_KEY, BACKEND_API_BASE_URL, site, and other variables inline. A developer must know which app they're working on, which environment, which site, whether to install or upgrade, and which manifest edits apply — all before they can pick the right script name.

**Solution:** A single interactive wizard (`pnpm forge`) that guides the developer through each decision, prints the raw commands it executes for transparency, and handles all orchestration (build, manifest edits, deploy, install/upgrade, tunnel).

---

## User Profile

Small team (2-4 developers). Each person has their own dev environment (Forge env name + Atlassian site in `.env.forge.local`). Staging and production are shared.

## Wizard Flow

```
1. Select app           → [lite, full, diagramly]
   Print: APP_ID, manifest changes that will be applied

2. Select environment   → [development, staging, production]

3. Build                → pnpm build:<variant>

4. Deploy               → backup manifest, apply edits, forge deploy, restore manifest

5. Select site          → [known sites for (app, env), custom input, none]
   - If site chosen     → detect installed vs not → install or upgrade
   - If none            → exit

6. Start tunnel?        → [yes, no]  (only if site was selected)
   - If yes             → forge tunnel -e <env>
   - If no              → exit
```

### Step 1: Select app

Present three choices. After selection, immediately print:

```
App: lite
  APP_ID: 8ad26115-211f-4216-971b-0540f606303d
  Manifest changes:
    - Remove licensing (lite is free)
    - Remove confluence:contentBylineItem
```

| App | APP_ID | Manifest changes |
|-----|--------|-----------------|
| lite | `8ad26115-211f-4216-971b-0540f606303d` | Remove `app.licensing`, remove `modules.confluence:contentBylineItem` |
| full | `d9e4002b-120b-426b-834b-402a4a5adce7` | None |
| diagramly | `01ede8b1-4e88-451a-b9ef-89eeef93afaf` | Remove `modules.confluence:globalSettings`, remove `modules.confluence:globalPage`, remove embed macro from `modules.macro[]` |

### Step 2: Select environment

Three choices: development, staging, production.

| Environment | Forge `-e` flag | Source |
|-------------|----------------|--------|
| development | from `.env.forge.local` `FORGE_ENV` | Developer-specific |
| staging | `staging` | Fixed |
| production | `production` | Fixed |

For **development**, the wizard reads `.env.forge.local` to get `FORGE_ENV` and `ATLASSIAN_SITE`. If the file is missing, print an error with instructions to create it from `.env.forge.local.example`.

For **production**, the wizard prints a warning ("You are about to deploy to PRODUCTION") and asks for explicit confirmation before proceeding.

### Step 3: Build

Always runs before deploy. Executes:

```
→ pnpm build:<variant>
```

Where variant is derived from the app:
- lite → `pnpm build:lite`
- full → `pnpm build:full`
- diagramly → `pnpm build:diagramly`

### Step 4: Deploy

Sequence:

```
→ cp manifest.yml manifest.yml.bak
→ yq eval '<edit1>' -i manifest.yml
→ yq eval '<edit2>' -i manifest.yml
→ forge settings set usage-analytics true
→ APP_ID=... CONNECT_KEY=... BACKEND_API_BASE_URL=... forge deploy -e <env> --non-interactive
→ mv manifest.yml.bak manifest.yml
```

Manifest is always restored, even if deploy fails (use try/finally).

**Environment variables set on the `forge deploy` child process:**

| Variable | Source |
|----------|--------|
| `APP_ID` | From app config |
| `CONNECT_KEY` | From app config |
| `SEQUENCE_MACRO_KEY` | From app config |
| `CUSTOM_CONTENT_KEY` | From app config |
| `LITE_KEY_SUFFIX` | From app config |
| `LITE_TITLE_SUFFIX` | From app config |
| `APP_LABEL` | From app config |
| `BACKEND_API_BASE_URL` | From (app, env) config |
| `DIAGRAMLY_BACKEND_API_BASE_URL` | Only for diagramly+production: `https://diagramly.ai` |

**Manifest edit commands per app:**

| App | yq commands |
|-----|------------|
| lite | `yq eval 'del(.modules["confluence:contentBylineItem"])' -i manifest.yml` |
| | `yq eval 'del(.app.licensing)' -i manifest.yml` |
| full | (none) |
| diagramly | `yq eval 'del(.modules["confluence:globalSettings"]) \| del(.modules["confluence:globalPage"])' -i manifest.yml` |
| | `yq eval 'del(.modules.macro[] \| select(.key \| test("zenuml-embed-macro")))' -i manifest.yml` |

**Backend API base URLs:**

| App | development | staging | production |
|-----|------------|---------|------------|
| lite | from `.env.forge.local` or `https://conf-stg-lite.zenuml.com` | `https://conf-stg-lite.zenuml.com` | `https://conf-lite.zenuml.com` |
| full | from `.env.forge.local` or `https://conf-stg-full.zenuml.com` | `https://conf-stg-full.zenuml.com` | `https://conf-full.zenuml.com` |
| diagramly | from `.env.forge.local` or `https://conf-stg-lite.zenuml.com` | `https://conf-stg-lite.zenuml.com` | `https://conf-lite.zenuml.com` |

### Step 5: Select site

Present choices based on (app, environment):

| App | development | staging | production |
|-----|------------|---------|------------|
| lite | `.env.forge.local` ATLASSIAN_SITE | `lite-stg.atlassian.net` | `zenuml.atlassian.net` |
| full | `.env.forge.local` ATLASSIAN_SITE | `full-stg.atlassian.net` | `zenuml.atlassian.net` |
| diagramly | `.env.forge.local` ATLASSIAN_SITE | `dia-stg.atlassian.net` | `zenuml.atlassian.net` |

Menu always includes:
- Known site(s) for the (app, env) combination
- "Enter custom site..."
- "None (skip install)"

**Install vs upgrade detection:**

Attempt `forge install`. If it fails with "already installed" error, run `forge install --upgrade` instead. This is simpler and more reliable than parsing `forge install --list`.

```
→ APP_ID=... forge install --site <site> --product confluence -e <env> --non-interactive
  (if already installed) → APP_ID=... forge install --upgrade --site <site> --product confluence -e <env> --non-interactive
```

If "none" is selected, exit with a success summary.

### Step 6: Start tunnel?

Only offered if a site was selected in step 5. Simple yes/no prompt.

If yes:
```
→ APP_ID=... BACKEND_API_BASE_URL=... forge tunnel -e <env>
```

Tunnel runs in the foreground (streaming output). Ctrl+C to stop.

If no, exit with a success summary.

---

## Output Format

Every spawned command is printed with `→` prefix before execution, followed by a status indicator:

```
Building...
  → pnpm build:lite
  ✓ Build complete (34s)

Editing manifest...
  → yq eval 'del(.modules["confluence:contentBylineItem"])' -i manifest.yml
  → yq eval 'del(.app.licensing)' -i manifest.yml
  ✓ Manifest edited

Deploying...
  → APP_ID=8ad26115-... BACKEND_API_BASE_URL=https://conf-stg-lite.zenuml.com forge deploy -e staging --non-interactive
  ✓ Deployed v13.175.0

Installing to lite-stg.atlassian.net...
  → APP_ID=8ad26115-... forge install --site lite-stg.atlassian.net --product confluence -e staging --non-interactive
  ✓ Upgraded (already installed)

Restoring manifest...
  → mv manifest.yml.bak manifest.yml
  ✓ Done
```

On failure, print the command's stderr and stop. Manifest is always restored.

---

## Configuration Data Model

Single config object inside `scripts/forge-wizard.mjs`:

```javascript
const APPS = {
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
      { description: 'Remove licensing (lite is free)', cmd: "yq eval 'del(.app.licensing)' -i manifest.yml" },
      { description: 'Remove contentBylineItem', cmd: "yq eval 'del(.modules[\"confluence:contentBylineItem\"])' -i manifest.yml" },
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
      { description: 'Remove globalSettings + globalPage', cmd: "yq eval 'del(.modules[\"confluence:globalSettings\"]) | del(.modules[\"confluence:globalPage\"])' -i manifest.yml" },
      { description: 'Remove embed macro', cmd: "yq eval 'del(.modules.macro[] | select(.key | test(\"zenuml-embed-macro\")))' -i manifest.yml" },
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
```

---

## Implementation Details

### File

`scripts/forge-wizard.mjs` — ES module, ~250 lines.

### Dependency

`@inquirer/prompts` — added as a devDependency. Provides `select` and `input` prompt types with arrow-key navigation.

### Command execution

Use Node.js `child_process.execSync` (or `spawnSync`) for all commands except tunnel. Tunnel uses `spawn` with `stdio: 'inherit'` to stream output in foreground.

Environment variables are passed via the `env` option on spawn, merged with `process.env`.

### Error handling

- Build failure → print error, stop
- Manifest edit failure → restore manifest, print error, stop
- Deploy failure → restore manifest, print error, stop
- Install failure with "already installed" → retry with `--upgrade`
- Upgrade failure → print error, stop (manifest already restored after deploy)
- Tunnel failure → print error (non-critical, user just Ctrl+C'd)

Manifest restore is in a `try/finally` block — always runs.

### Development environment support

When environment = "development":
1. Read `.env.forge.local` for `FORGE_ENV` and `ATLASSIAN_SITE`
2. If file missing → print error: "Create .env.forge.local from .env.forge.local.example"
3. If `BACKEND_API_BASE_URL` is in `.env.forge.local`, use it; otherwise fall back to the staging URL
4. `ATLASSIAN_SITE` from the file appears as the first known site option

---

## What This Does NOT Do

- **Deploy to Cloudflare Pages** — use `pnpm wrangler:publish:stg:lite` or the `/deploy-stg` skill
- **Apply D1 migrations** — handled by wrangler, not forge
- **Replace CI scripts** — CI still calls forge directly with hardcoded env vars
- **Deploy to production without confirmation** — when environment = production, the wizard prints a warning and asks for confirmation before proceeding

---

## Future Considerations

- CI could be migrated to use a shared config extracted from this wizard (eliminating duplication)
- The wizard could support `--non-interactive` mode with args (e.g. `pnpm forge -- --app lite --env staging --site none`) for scripting
- The 28 legacy forge scripts in package.json could be removed once CI is migrated
