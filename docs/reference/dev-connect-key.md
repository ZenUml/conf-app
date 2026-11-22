# A development environment with its own Connect key

Use this when a development environment must be installed on a site that already has another environment of the same app (for example your dev environment next to staging on one test site).

## Why a key and not just an environment

Confluence allows one installation per Connect key on a site. Every environment of an app is deployed with the same key (`app.connect.key` in `manifest.yml`, templated as `${CONNECT_KEY}`), so a second environment is refused. Measured 2026-11-21 on a test site:

| Second Lite environment deployed with | `forge install` result |
|---|---|
| the fixed key `com.zenuml.confluence-addon-lite` | `409 APP_ALREADY_INSTALLED: An app with connect key … is already installed` |
| `com.zenuml.confluence-addon-lite-envtest` | installed; `forge install list` showed both environments on the site |

Custom content types are `ac:<connect key>:<content key>`, so an environment with its own key stores its diagrams under its own types. It does not see the diagrams of the other environment on the same site, and they do not see its diagrams. Everything else works the same.

Development environments only. Staging and production keep each variant's fixed key.

## Naming convention

The key must be the variant's fixed key plus a suffix: `<fixed key>-<suffix>`, suffix lowercase `[a-z0-9.-]`, up to 41 characters.

| Variant | Fixed key | Example development key |
|---|---|---|
| Lite | `com.zenuml.confluence-addon-lite` | `com.zenuml.confluence-addon-lite-alt` |
| Full | `com.zenuml.confluence-addon` | `com.zenuml.confluence-addon-alt` |
| Diagramly | `gptdock-confluence` | `gptdock-confluence-alt` |
| AsyncAPI | `my-api` | `my-api-alt` |

The backend recognises a development key by this shape, so no registration is needed. A key belongs to the longest fixed key it extends: Full may not use a key that starts with `com.zenuml.confluence-addon-lite`, because that would name Lite's types.

## Steps

1. Create the environment:

   ```bash
   forge environments create -e <env-name>
   ```

2. Pick a key that follows the naming convention above.

3. Nothing to register on the backend: `functions/magic-writeback.ts` accepts `ac:<fixed key>-<suffix>:<content key>` when the verified Forge invocation token says `DEVELOPMENT`.

4. Put the key in `.env.forge.local` next to `FORGE_ENV` and `ATLASSIAN_SITE`:

   ```
   CONNECT_KEY_OVERRIDE=com.zenuml.confluence-addon-lite-<name>
   ```

5. Build with the same value. The build fails on a key that does not follow the convention for its `PRODUCT_TYPE`, and writes the value to `dist/connect-key-override.txt`:

   ```bash
   CONNECT_KEY_OVERRIDE=com.zenuml.confluence-addon-lite-<name> pnpm build:lite
   ```

6. Deploy and install through `scripts/forgex` (`pnpm forge:deploy:dev`, `pnpm forge:install:dev`, or the forge wizard). `forgex` sets `CONNECT_KEY` from `CONNECT_KEY_OVERRIDE` and refuses `deploy` or `tunnel` when `dist/` was built for a different key.

## Per-PR environment (CI)

`.github/workflows/pr-dev-environment.yml` does the steps above for every same-repository PR:

| PR #N | Value |
|---|---|
| Forge environment | `pr-N` (Lite), created on the first run |
| Connect key | `com.zenuml.confluence-addon-lite-prN` |
| Site | repo variable `PR_DEV_SITE`; when unset, the environment is deployed but installed nowhere. Never `lite-dev.atlassian.net` |
| In the editor | slash menu entry `Diagram (Mermaid, PlantUML & ZenUML) Lite - pr-N (Dev)` |
| On every push | remove `pr-N` from lite-dev if present, rebuild, redeploy, install or upgrade on `PR_DEV_SITE` |
| On close (merged or not) | uninstall from every site and delete the environment |

It is Forge-only: the app calls the existing `conf-stg-lite` backend. It runs alongside PR validation and takes no staging or PR-slot lock; E2E still runs on the `pr` slot.

**A dev key avoids the install conflict, not macro ambiguity.** Two environments of one app on a site expose the same macro module keys. A macro node with the bare key (`extensionKey: zenuml-sequence-macro-lite`, as API-created pages and pages migrated from Connect have) names no environment, so Confluence may render it with either install. On 2026-11-22 `pr-1284` on lite-dev made PR #1297's E2E run against the `pr-1284` build. Keep one environment per app on any site that E2E or customers-like checks use; give a second environment its own test site.

## What reads the key

| Where | How |
|---|---|
| Frontend custom-content types (`ApWrapper2.getCustomContentTypePrefix`) | build-time `CONNECT_KEY_OVERRIDE` (`vite.config.mjs`) |
| `addonKey()` sent to the backend and to analytics | unchanged: stays the variant's fixed key, because the backend reads it as the variant's identity |
| `functions/magic-writeback.ts` | accepts the naming convention for a `DEVELOPMENT` FIT |
| Agent-link headless MCP tools (`functions/agent-link/`) | not supported: they discover and create under the fixed keys only |
| Production-only scheduled jobs (`src/macro-count-snapshot.ts`, `src/lite-full-conversion.ts`, `src/demoPageContent.js`) | not supported; they act on production data only |
