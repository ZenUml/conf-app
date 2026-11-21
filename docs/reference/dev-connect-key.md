# A development environment with its own Connect key

Use this when a development environment must be installed on a site that already has another environment of the same app (for example your dev environment next to staging on one test site).

## Why a key and not just an environment

Confluence allows one installation per Connect key on a site. Every environment of an app is deployed with the same key (`app.connect.key` in `manifest.yml`, templated as `${CONNECT_KEY}`), so a second environment is refused. Measured 2026-11-21 on a test site:

| Second Lite environment deployed with | `forge install` result |
|---|---|
| the fixed key `com.zenuml.confluence-addon-lite` | `409 APP_ALREADY_INSTALLED: An app with connect key … is already installed` |
| `com.zenuml.confluence-addon-lite-envtest` | installed; `forge install list` showed both environments on the site |

Custom content types are `ac:<connect key>:<content key>`, so an environment with its own key stores its diagrams under its own types. It does not see the diagrams of the other environment on the same site, and they do not see its diagrams. Everything else works the same.

Development environments only. Staging and production keep each variant's fixed key; the backend ignores the table below unless the verified Forge invocation token says `DEVELOPMENT`.

## Steps

1. Create the environment and note its ID:

   ```bash
   forge environments create -e <env-name>
   forge environments list          # the Environment ID column
   ```

2. Pick a key: lowercase `[a-z0-9.-]`, 3-63 characters, not one of the four fixed keys. Convention: the variant's key plus a suffix, e.g. `com.zenuml.confluence-addon-lite-<name>`.

3. Register it in `functions/utils/devConnectKeys.ts` (`appId`, `environmentId`, `connectKey`) and get that change deployed to the backend your environment calls (`BACKEND_API_BASE_URL`; staging Pages for a dev environment). Until it is, magic-writeback refuses this environment's diagrams and the MCP headless tools cannot create on a site where only this environment is installed. Saving and loading diagrams in Confluence do not depend on it.

4. Put the key in `.env.forge.local` next to `FORGE_ENV` and `ATLASSIAN_SITE`:

   ```
   CONNECT_KEY_OVERRIDE=com.zenuml.confluence-addon-lite-<name>
   ```

5. Build with the same value. The build fails on a malformed key or a fixed key, and writes the value to `dist/connect-key-override.txt`:

   ```bash
   CONNECT_KEY_OVERRIDE=com.zenuml.confluence-addon-lite-<name> pnpm build:lite
   ```

6. Deploy and install through `scripts/forgex` (`pnpm forge:deploy:dev`, `pnpm forge:install:dev`, or the forge wizard). `forgex` sets `CONNECT_KEY` from `CONNECT_KEY_OVERRIDE` and refuses `deploy` or `tunnel` when `dist/` was built for a different key.

## What reads the key

| Where | How |
|---|---|
| Frontend custom-content types (`ApWrapper2.getCustomContentTypePrefix`) | build-time `CONNECT_KEY_OVERRIDE` (`vite.config.mjs`) |
| `addonKey()` sent to the backend and to analytics | unchanged: stays the variant's fixed key, because the backend reads it as the variant's identity |
| `functions/magic-writeback.ts` | `devConnectKeyFor(appId, environment)` for a `DEVELOPMENT` FIT |
| Agent-link headless tools (`functions/agent-link/macroIdentity.ts`) | discovery and filters accept every registered key; a create uses the resolved environment's key |
| Production-only scheduled jobs (`src/macro-count-snapshot.ts`, `src/lite-full-conversion.ts`, `src/demoPageContent.js`) | not supported; they act on production data only |
