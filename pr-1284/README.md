# PR 1284 evidence: a development environment with its own Connect key

- Candidate: `e8c31273` on `claude/elegant-goldberg-4har49`. Baseline: `f2a564d3` (`origin/main`).
- Variant: Lite (app `8ad26115-…`). Site: the team's test site `whimet6.atlassian.net`, which already had Lite installed from development environment `yanhui` (fixed key).
- Candidate install: development environment `alt-key` (`4d8bcead-f943-4b68-8298-648e626e6891`), built and deployed with `CONNECT_KEY_OVERRIDE=com.zenuml.confluence-addon-lite-alt` through `scripts/forgex`. Scheduled triggers were removed from the temporary deploy manifest; `manifest.yml` was restored afterwards.
- Browser: Playwright Chromium, 1440×1000, robot test account. Personal names, avatars and the site's page tree are masked.
- Captured 2026-11-21 (UTC).

## Install, before and after the key change (Forge CLI, same site)

| Second Lite environment deployed with | `forge install` |
|---|---|
| fixed key `com.zenuml.confluence-addon-lite` (environment `development`) | `409 APP_ALREADY_INSTALLED: An app with connect key "com.zenuml.confluence-addon-lite" is already installed` |
| `com.zenuml.confluence-addon-lite-alt` (environment `alt-key`) | installed; `forge install list` for the site: `yanhui` v13 and `alt-key` v2 |

## UI, candidate build on `alt-key`

| # | Step | Observed |
|---|---|---|
| 1 | View a page whose macro points at `alt-key` and content created over REST as `ac:com.zenuml.confluence-addon-lite-alt:zenuml-content-sequence` | diagram renders; byline shows both `alt-key (Dev)` and `yanhui (Dev)` apps |
| 2 | Edit page → macro Edit → append a Mermaid line → Publish → page Update | REST: same content id, version 1 → 2, type still `…-lite-alt:…`, new line in `mermaidCode`; page renders 3 nodes |
| 3 | Slash menu `/Mermaid` | two entries: `… Lite - alt-key (Dev)` and `… Lite - yanhui (Dev)` |
| 4 | Insert the `alt-key` entry, edit, Publish, Update | REST: new content `245071895`, type `ac:com.zenuml.confluence-addon-lite-alt:zenuml-content-sequence`; macro extensionKey names environment `4d8bcead-…` |
| 5 | Byline `Diagrams Lite - alt-key (Dev)` | panel lists the page's alt-key diagram |
| 6 | Fullscreen from the viewer | renders |

## Not verified

- magic-writeback and agent-link (MCP headless) with the dev key on a live site: they run in the backend, which serves the table only after this branch is deployed to staging Pages. Covered by unit tests only.
- Graph (DrawIO) diagrams on `alt-key`: not exercised; same prefix code path as above.
- Frontend console showed Mixpanel errors because the local build had no `VITE_MIXPANEL_TOKEN`; unrelated to the key.
