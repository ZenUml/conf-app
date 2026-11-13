---
name: verify-conf-app
description: "Drive the ZenUML Confluence macro UI and prove what a reader sees. Use for viewer, editor, source, export, or publish checks in conf-app, or when a task says /control-app, control-conf-app, or verify-conf-app."
---

# Verify conf-app

The user-facing surface is a diagram macro inside Confluence. The local stand-in this skill can launch is Storybook (`PRODUCT_TYPE=lite`), which mounts the same Vue components with `@forge/bridge` stubbed. A Storybook proof does not prove a Forge iframe, a custom-content save, or the paywall.

Run every command from the repo root:

```bash
node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs <command>
```

stdout is one JSON object. `ok: false` means do not drive.

## Launch

```bash
node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs launch
```

This starts `pnpm exec storybook dev` on `127.0.0.1` at a free port beginning at `6137`, with `--exact-port`, `--ci`, and `--no-open`. Ready means `GET /index.json` is HTTP 200 and contains `viewer-genericviewer--default`. A listening port alone is not ready.

The process group id is written to `.cursor/skills/verify-conf-app/.run/state.json`. A second launch reuses that instance when doctor passes. It does not attach to a Storybook the user started themselves.

Cloud agents do not keep this process across runs. After dependencies are installed, run `launch` inside the agent. Do not assume port 6006.

## Doctor

```bash
node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs doctor
```

Doctor is read-only. It checks that the recorded pid is alive and that the story index lists `viewer-genericviewer--default`. Run it before the first browser command and again after any failed drive. If it fails, run `stop`, then `launch`. Do not drive a dead instance.

`confluence doctor` only checks that `~/.agent-browser/sessions/stg-conf-app.json` exists. It does not open the shared browser, and a file on disk does not prove the login is still valid.

## Drive

Storybook browser commands use agent-browser session `conf-app-verify`. Never pass `--restore=stg` and never use session `conf-app` for Storybook. That session holds the staging login.

Desktop viewport is `1440x900`. Open the story iframe, not the Storybook manager:

```bash
node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser open-story viewer-genericviewer--default
node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser wait --testid viewer-title-rename
```

Prefer `data-testid`, ARIA roles, and accessible names. The feature map in `features/README.md` is the recipe. Drive the entry point the map names. A different story is not a substitute.

Header actions other than Create stay at opacity 0 until the pointer is over `.viewer-surface`. Hover before asserting Edit, Source, Copy for AI, or Fullscreen:

```bash
node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser hover --selector .viewer-surface
node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser wait 400
node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser query --role button --name Edit
```

Confluence staging is a shared browser. `confluence open --url` allows only `https://` URLs on `lite-stg`, `full-stg`, `dia-stg`, `asyncapi-stg`, and `zenuml-stg` whose path starts with `/wiki/`. It uses `agent-browser --session conf-app --restore stg` and refuses to start while `.run/confluence.lock` belongs to a live pid. Two verification runs must not drive that session at once. `--dry-run` prints the URL and does not navigate.

## Evidence

Write proof under `.cursor/skills/verify-conf-app/artifacts/<feature-id>/`. Capture the action and the resulting state.

```bash
node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser screenshot --feature view-diagram --path .cursor/skills/verify-conf-app/artifacts/view-diagram/header.png
node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs browser snapshot --feature view-diagram --path .cursor/skills/verify-conf-app/artifacts/view-diagram/header.aria.txt
```

Each proof file gets a sibling `.json` noting the feature id, story id, and URL. A screenshot of the final screen without the preceding action is not proof. Storybook seed data is not a Confluence write: confirm a saved title by reading it back from the control the user sees, and say so when that read never left the stub.

Mocks in this stand-in: `.storybook/main.ts` aliases `@forge/bridge` to `src/stubs/forge-bridge.ts` and analytics to `.storybook/stubs/trackAnalyticsEvent.ts`. Stories then seed the Vuex store. Those steps do not happen in Confluence. Until a drive runs on a staging page, these remain unverified: the Forge OOPIF, custom-content load and save, guest or anonymous token behavior, and the Lite paywall.

## Cleanup

```bash
node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs stop
```

`stop` closes the `conf-app-verify` browser session and signals the recorded process group. It does not kill by process name and it does not delete `artifacts/`. `--dry-run` reports the pid it would signal. Run `stop` after a failed launch too, so a half-started Storybook does not keep the port.

`stop` does not close session `conf-app`.

## Helpers

The helper is `scripts/control-conf-app.mjs`. Invoke it as shown above. `launch --dry-run` and `stop --dry-run` change nothing. Destructive Confluence navigation is `confluence open`, which has `--dry-run`.

Keep the feature map honest with `/maintain-verification-skill`.
