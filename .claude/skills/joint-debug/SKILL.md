---
name: joint-debug
description: Enable, launch, monitor, troubleshoot, and stop the local joint-debug environment across conf-app, its Cloudflare Worker, ngrok, Forge tunnel, and diagramly.ai. Use for requests mentioning joint-debug, join-debug, combined local AI Repair testing, starting or monitoring the five-service stack, or closing that stack.
---

# Joint Debug

Run a local five-service stack:

1. Diagramly AI service on `http://localhost:3000`
2. Cloudflare Pages Worker on `http://localhost:8789`
3. ngrok forwarding the configured HTTPS domain to port `8789`
4. conf-app frontend on `http://127.0.0.1:8080`
5. Forge tunnel

## Guardrails

- Preserve unrelated working-tree and staged changes.
- Never print the ngrok token or database password.
- Keep `'/diagramly'` in `functions/_middleware.ts` `AUTHENTICATED_PATHS`. AI routes require verified Forge JWT data in `data.forgeContext`.
- Keep AI Repair visibility on its existing feature-flag/runtime path. Never force `isAiRepairEnabled` or `shouldShowAiRepair` to `true`.
- Use a local PostgreSQL database for Diagramly. Do not point local joint-debug at staging or production.
- Do not claim a service is ready until its log or health endpoint proves readiness.

## Enable configuration

1. Inspect `git status`, staged and unstaged diffs, and existing `JOINT-DEBUG` markers.
2. Obtain the full Diagramly checkout path. Discover likely sibling checkouts first; ask only when multiple plausible paths remain.
3. Verify `wrangler.toml` contains `NGROK_AUTHTOKEN` and `NGROK_DOMAIN` without displaying their values.
4. In `src/model/globals/forgeGlobal.ts`, replace only `DEVELOPMENT_LITE`, `DEVELOPMENT_FULL`, and `DEVELOPMENT_ASYNCAPI` with `https://<NGROK_DOMAIN>` using idempotent markers. AsyncAPI must be included because its bundled OpenAPI macro reaches AI Repair through `/diagramly/*`:

   ```typescript
   // [JOINT-DEBUG-START]
   DEVELOPMENT_LITE: 'https://<NGROK_DOMAIN>',
   DEVELOPMENT_FULL: 'https://<NGROK_DOMAIN>',
   DEVELOPMENT_ASYNCAPI: 'https://<NGROK_DOMAIN>',
   // [JOINT-DEBUG-END]
   // DEVELOPMENT_LITE: '<original>', // [JOINT-DEBUG-ORIGINAL]
   // DEVELOPMENT_FULL: '<original>', // [JOINT-DEBUG-ORIGINAL]
   // DEVELOPMENT_ASYNCAPI: '<original>', // [JOINT-DEBUG-ORIGINAL]
   ```

5. In `wrangler.toml`, set `DIAGRAMLY_BACKEND_API_BASE_URL = "http://localhost:3000"` with TOML `JOINT-DEBUG` markers and preserve the original line as `JOINT-DEBUG-ORIGINAL`.
6. Do not modify `functions/_middleware.ts` or `src/components/SyntaxErrorBox.vue`.
7. Run `git diff --check` and inspect the final diff before launching services.

## Prepare the Diagramly local database

First inspect `packages/database/prisma/schema.prisma`; Diagramly uses PostgreSQL-specific migrations and cannot be switched to SQLite as a startup-only change.

1. Reuse an existing `DATABASE_URL` only when its hostname is `localhost` or `127.0.0.1`.
2. Check ports and existing containers before starting anything. Never stop an unknown PostgreSQL, Supabase, or user-owned container.
3. If no suitable local PostgreSQL exists, create a dedicated `diagramly-postgres` PostgreSQL 16 container. Prefer host port `5432`; use `5433` or another free port when occupied.

   ```bash
   docker run -d --name diagramly-postgres \
     -e POSTGRES_USER=test_user \
     -e POSTGRES_PASSWORD=test_pass \
     -e POSTGRES_DB=diagramly_test \
     -p 127.0.0.1:<free-port>:5432 \
     postgres:16
   ```

4. Initialize the empty local database from the Diagramly root:

   ```bash
   DATABASE_URL='<local-url>' \
     pnpm --filter database exec prisma db push \
       --skip-generate --schema prisma/schema.prisma
   ```

5. Keep the chosen URL as a runtime override; do not rewrite Diagramly `.env` unless the user explicitly asks.
6. After Diagramly starts, require `GET http://127.0.0.1:3000/api/health?deep=1` to report `db: "up"`.

The repository's `.env.test.example` local defaults are suitable for a dedicated test database. Treat any remote, staging, or production database URL as a configuration error for this workflow.

## Before launch

Before starting any of the five services, ask the user whether to run the following command to update the app installed on the development site:

```bash
pnpm forge:upgrade:diagramly:dev
```

Run it from the conf-app root only after the user explicitly agrees, and wait for it to complete successfully before launching services. If the user declines, skip it and continue with the launch.

## Launch mode

Choose based on the user's request.

### Frontend mode invariants

- Treat `pnpm start:local` as a standalone Lite frontend. It runs Vite in
  `serve` mode and intentionally aliases `@forge/bridge` to
  `src/stubs/forge-bridge.ts`.
- Treat `pnpm start:sit` as local D1 migration + Wrangler + `start:local`. It
  still uses the Forge bridge stub, and it also starts its own Worker. Never
  substitute it for the separately managed Worker + frontend in this stack.
- Start a frontend consumed by Forge tunnel with `FORGE_TUNNEL=1`; this is the
  explicit signal in `vite.config.mjs` that retains the real
  `@forge/bridge` package.
- Set `PRODUCT_TYPE=diagramly` on the Vite command itself. Do not rely on a
  parent environment variable when a nested package script sets
  `PRODUCT_TYPE=lite` explicitly.
- Expect the Confluence iframe source to use `http://localhost:8000`: Forge
  tunnel owns that proxy origin and forwards Custom UI assets to Vite on
  `127.0.0.1:8080`. Seeing port `8000` is not evidence of a failure.

Before UI testing, inspect the transformed frontend module without printing
secrets:

```bash
curl -fsS http://127.0.0.1:8080/src/model/globals/forgeGlobal.ts \
  | rg 'node_modules/.vite/deps/@forge_bridge|src/stubs/forge-bridge|PRODUCT_TYPE'
```

Require the real `@forge_bridge` dependency, no `src/stubs/forge-bridge` import,
and `PRODUCT_TYPE: "diagramly"`. If a real Forge iframe reports
`Forge context missing extension`, check these invariants first. Do not weaken
the context guard or manufacture a Forge context in application code.

### Codex-managed monitoring

When the user asks Codex to start, own, monitor, or automatically diagnose the stack, do not run the AppleScript helper. Launch five long-running managed PTY sessions and retain every session ID:

```bash
# Diagramly checkout
DATABASE_URL='<local-url>' pnpm dev

# conf-app checkout
npx wrangler pages dev --port 8789
ngrok http --authtoken '<token>' --url '<domain>' 8789
FORGE_TUNNEL=1 VERSION=latest PRODUCT_TYPE=diagramly pnpm exec vite dev --port 8080 --host 127.0.0.1
forge tunnel
```

If a sandboxed launch fails with `EPERM`, file-log permission errors, or port-binding errors, rerun that service with the required elevated permission. Do not launch `pnpm start:sit`: it starts another Worker and collides with the separately managed Worker.

Require these readiness signals:

- Diagramly: Next.js `Ready` on port `3000`, mock OpenAI server on `9000`, and deep health `db: "up"`.
- Worker: `Ready on http://localhost:8789`.
- ngrok: local API on `4040` shows the configured public URL forwarding to `8789`.
- Frontend: Vite `ready` on `127.0.0.1:8080`.
- Forge: tunnel reports its development environment and listens for requests.

### User-managed Terminal windows

When the user explicitly wants separate macOS Terminal windows, run:

```bash
./.claude/skills/joint-debug/launch-debug-services.sh \
  '<NGROK_AUTHTOKEN>' \
  '<NGROK_DOMAIN>' \
  '<DIAGRAMLY_PATH>'
```

The fourth argument is optional. When omitted, the helper lets Diagramly's `pnpm dev` load
`DATABASE_URL` from its default `.env`; the helper still verifies that it targets localhost. Pass
`'<LOCAL_DATABASE_URL>'` as the fourth argument only when an explicit local override is needed.

The helper requires macOS permission to send Apple Events to Terminal. If it reports error `-1743`, stop and tell the user to grant Automation permission or switch to Codex-managed PTYs. Never accept its success banner without checking that the expected ports are listening.

## Monitor and repair

While the user tests:

1. Poll all five PTY sessions after each action and retain new output.
2. Correlate requests with ngrok metadata, Worker logs, Forge logs, and Diagramly logs. Avoid dumping authorization headers or request bodies containing secrets.
3. Trace the user-visible error through runtime evidence before editing code.
4. Apply the smallest evidence-backed fix, run focused tests, and confirm the affected service hot-reloads or restarts.
5. Ask the user to retry only after the stack returns to ready state.

For an AI Repair acceptance test on a real Confluence draft:

1. Reuse the user's existing logged-in browser tab; do not open another browser.
2. Use Playwright because Forge Custom UI is a sandboxed cross-origin iframe.
3. Insert the Diagramly development OpenAPI macro and enter deliberately invalid
   YAML, for example `title Sample API` instead of `title: Sample API`.
4. Require visible parser-error evidence, open AI Repair, wait for the repaired
   diff, apply it, and wait for the stale parser error to disappear.
5. Require the editor to contain the repaired code and the preview to render.
6. Corroborate the UI with ngrok metadata showing successful
   `/diagramly/fix-diagram` and `/diagramly/job-status` responses. Print only
   timestamps, methods, paths, and status codes.
7. Save the macro to the page draft only when the user authorized insertion.
   Do not click Confluence's page-level Publish action unless separately asked.

Do not mark the check passed from unit tests alone. Preserve a screenshot,
snapshot, or network intercept that proves the final UI state.

Known signatures:

- `Missing accountId in Forge context`: `/diagramly` bypassed authentication. Restore it in `AUTHENTICATED_PATHS`; do not fall back to client-supplied identity.
- Diagramly returns `401 Unauthorized`: inspect Diagramly logs before changing API keys. API-key auth may be masking a Prisma connection failure. Confirm deep health and the local `DATABASE_URL`.
- Prisma points at `diagramly-db-stg.postgres.database.azure.com`: the local configuration is stale; use the dedicated local PostgreSQL database.
- Wrangler `EMFILE` or `listen EPERM`: relaunch outside the sandbox; do not change application code.
- Wrangler `/diagramly/job-status` fails with `Network connection lost` after earlier
  polls returned `200`, while Diagramly later logs the job as completed: do not
  diagnose this as an AI/model failure. Read
  [references/wrangler-network-connection-lost.md](references/wrangler-network-connection-lost.md)
  and follow its evidence, restart, and deployment-boundary guidance.
- Forge lint errors followed by `Listening for requests`: an old Forge CLI may reject newer manifest schema while the tunnel still works. Do not edit `manifest.yml` without separate evidence.
- Diagramly Node `>=24` warning followed by Next.js `Ready`: record the warning but treat it as non-blocking for that run.
- Mixpanel `before_register` errors together with Vite's
  `VITE_MIXPANEL_TOKEN is empty` warning mean local analytics is unconfigured;
  report dropped local events separately from AI Repair transport health.

## Stop and clean up

1. Send Ctrl+C to every managed service session and confirm exit.
2. Stop `diagramly-postgres` only if this workflow created or started it. Never stop unrelated Docker/Supabase containers.
3. Revert only marked joint-debug changes in `src/model/globals/forgeGlobal.ts` and `wrangler.toml`:
   - remove `JOINT-DEBUG-START` through `JOINT-DEBUG-END` blocks;
   - uncomment `JOINT-DEBUG-ORIGINAL` lines;
   - remove marker suffixes.
4. Do not change middleware authentication or AI Repair feature flags during cleanup.
5. Inspect both `git diff` and `git diff --cached`; preserve all unrelated edits.
6. Confirm expected ports are no longer listening and run `git diff --check`.
