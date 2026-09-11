# Working from the phone — what the cloud environment can and cannot do

Written 2026-09-11 (AEST) for a 14-day period with the laptop closed. Evidence base:
last 7 days of Claude Code (54 sessions), Codex (12 sessions) and Cursor history,
plus a live probe of the claude.ai cloud environment (routine
`trig_01MxhqxzhsfzERc7QQ2yJLTX`, run `cse_01R3iCgaMNXfdd63S3YnyPGT`).

```
            LAPTOP (off for 14 days)                 CLOUD "Conf App", probed 2026-09-11
 ┌───────────────────────────────────┐     ┌───────────────────────────────────────────┐
 │ real Chrome (eagle.xiao, Profile 8│     │ env_018cHo8XMcQftZBkNS3atV6c              │
 │  → Marketplace UI, dev console,   │     │ network: Trusted                          │
 │    admin.atlassian.com, Figma web │     │   *.atlassian.net, api.cloudflare.com,    │
 │ agent-browser sessions (robot1)   │     │   mixpanel.com → CONNECT 403              │
 │ Playwright MCP extension          │     │   api.github.com → 200                    │
 │ forge tunnel / Storybook / Vite   │     │ env vars: GITHUB_TOKEN only               │
 │ .env.forge.local (FORGE_*, JSM_*) │     │ API credentials: none                     │
 │ .env.mixpanel, e2e-tests/.env     │     │ setup script: none (no node_modules)      │
 │ codexloom :4870, seedmux, Codex   │     │ connectors (verified in routines):        │
 │ desktop scheduled tasks (none)    │     │   Mixpanel, Gmail, Slack, Figma, HubSpot  │
 └───────────────────────────────────┘     │ GitHub Actions: staging deploy, release   │
                                           └───────────────────────────────────────────┘
```

**The 2026-08-07 baseline in `docs/reference/agent-container-credentials.md` no longer
holds.** Probe run `cse_01R3iCgaMNXfdd63S3YnyPGT` on the routine environment found none of
the `FORGE_*` / `CLOUDFLARE_*` / `MIXPANEL_*` / `ATLASSIAN_*` variables and an egress-policy
`403` on every Atlassian, Cloudflare and Mixpanel host. The sibling environment
`env_018cHo8XCfQtZBkNS3atV6c` (2 old routines) returns `environment_not_found`. The claude.ai
environment editor (read 2026-09-11) shows both conf-app environments, "Conf App" and
"Conf app 2", with **no API credentials** and network access **Trusted**. Until that changes,
every REST path in the table below is laptop-only; only the **connectors** and **GitHub** work. Connector availability is verified for routines (attached `mcp_connections`, succeeded Mixpanel runs); interactive cloud sessions were not probed.

## 1. Last week's activity, by dependency

| Activity (sessions, last 7 days) | Needs from laptop | Cloud substitute |
|---|---|---|
| Mixpanel analysis, session replay reading (26 + 12) | none | **Mixpanel connector works today.** JQL needs step 2 |
| D1 / KV / paywall state (19 + 13) | `wrangler` + local `wrangler.toml` | Cloudflare REST — **blocked today** (no credential, egress 403); needs step 2 |
| JSM ticket reading / reply drafting (7) | `JSM_API_TOKEN` in `.env.forge.local` | **blocked today**; needs step 2 (JSM token) |
| Gmail read + draft (9) | none | **Gmail connector works today** |
| Marketplace evaluations / licences (2) | `eagle.xiao` Chrome session for the manage UI | REST `/reporting/*/export` — **blocked today**; needs step 2 |
| Storybook / local dev / Vite (21) | local process, Portless | none. Unit tests (`pnpm test:unit`) run in cloud; visual review does not |
| agent-browser spot checks / PVT (14) | `~/.agent-browser/sessions/*.json`, `cloud.session.token` expires **2026-09-15** | Playwright + robot TOTP (`tests/e2e-tests`) — needs `ATLASSIAN_*` vars **and** `*.atlassian.net` egress; blocked today |
| forge tunnel (8) | laptop + `eagle.xiao` identity | none |
| Figma design reading (5 + 8) | Figma web in Chrome | Figma connector (read design context / screenshots) |
| Forge feature flags, developer console | `eagle.xiao` Chrome session | `forge` CLI read-only after `pnpm install`; flag **edits** stay on the Console |
| Release (release-app skill) | nothing local — GitHub Actions | pipeline runs in GitHub, but the container has no `gh` and no GitHub MCP tools (only `api.github.com` REST answered `200`); policy: no release without PVT + spot check |
| Codex / codexloom / seedmux (18 + 35) | local daemons | none — Claude Code cloud only |

## 2. Pre-departure actions (laptop needed)

1. Commit or accept as unreachable the **uncommitted** work in these worktrees. Cloud clones GitHub; dirty files never leave the laptop.
   - `conf-app-export-annotations` (`feat/export-annotations-shottr`): 7 modified analytics files. The 8 committed-but-unpushed commits **were pushed on 2026-09-11**.
   - `conf-app-export-fullscreen` (`feat/export-in-fullscreen`): 13 files (ExportModal, previewFit).
   - `.claude/worktrees/figma-png-export-design-fb78fe`: 5 files (ExportModal, ExportSidebar, catalog).
   - primary `conf-app` on `main`: 2 skill docs, `CONTEXT.md`, `GenericViewer.stories.ts`, `lite-upgrade-sequence.md`.
   - Other repos: `diagramly.ai` (367 untracked, mostly artefacts), `mmd-zenuml-core` (12 untracked images), `conf-mini-sites` (24), `aws-widgets` (10), `diagramly-dev-workflow` (24 on a branch with no upstream).
2. Re-provision the "Conf App" cloud environment (claude.ai → Code → composer environment picker → Cloud → "Conf App" → settings). Only you can do this: the values are secrets and the editor is your account. Two mechanisms, chosen by how the consumer authenticates:
   - **Environment variables + Network access = Full** (options are None / Trusted / Full / Custom). Required for anything that reads env vars itself: the `forge` CLI (`FORGE_EMAIL` / `FORGE_API_TOKEN`), `tests/e2e-tests` (`ATLASSIAN_*`), `mp_query.py` (`.env.mixpanel`), and every skill script that builds `-u "$FORGE_EMAIL:$FORGE_API_TOKEN"` on its own. The editor warns these values are visible to anyone using the environment.
   - **API credentials** (Add credential, per host). The proxy attaches the secret and opens that host even under Trusted, but the editor states the value never reaches the session as an env var or file, so it serves only raw HTTP calls that send no auth of their own. Whether the proxy overrides a script's empty `-u :` header is **unverified**. Most of this repo's skills are env-var readers, so the first path is the one that unblocks them.
   Values, by file on the laptop (names only):
   - `FORGE_EMAIL`, `FORGE_API_TOKEN`, `JSM_EMAIL`, `JSM_API_TOKEN` → `.env.forge.local` (Confluence REST v2, Marketplace export, `forge` CLI, service desk).
   - `CLOUDFLARE_ACCOUNT_ID` → `.env`. `CLOUDFLARE_API_TOKEN` is **not on disk** (local `wrangler` uses OAuth login); create a token in the Cloudflare dashboard with D1 read, KV read/write, Pages read.
   - Mixpanel JQL → `.env.mixpanel` (`API_Secret`, `Token`); export as `MIXPANEL_API_SECRET`. The Mixpanel connector needs none of this.
   - `ATLASSIAN_USERNAME`, `ATLASSIAN_PASSWORD`, `ATLASSIAN_OTP` → `tests/e2e-tests/.env` (`ZENUML_STAGE_*` names there); only if headless Playwright smoke tests should run in the cloud.
   Setup script: `pnpm install --frozen-lockfile` (gives `forge` and `wrangler`).
   Also: "Conf App" currently keeps a GitHub PAT in the plain **Environment variables** box, which the editor labels as visible to anyone using the environment. Move it to an API credential for `api.github.com` (or rely on the built-in git proxy, which already answers `200` without it).
   **Verify:** Routines → "Cloud env probe — press Run now after adding credentials to "Conf App"" → Run now. The run log prints set/unset per variable and an HTTP status per host; `200` rows are live. The routine named "DELETE ME — probe of a deleted environment" is junk; the API has no delete, remove it from the Routines page.
3. Push or commit-and-push the dirty worktrees in step 1; the cloud sees only GitHub.
4. (Optional) Authorize the `plugin:cloudflare:*` and `second-brain` MCP servers in an interactive session if wanted in the cloud; today they need OAuth.

## 3. Work that suits the cloud (do these from the phone)

- **Works today in routines, expected in sessions:** Mixpanel questions, health checks, session-replay reads, dashboard creation through the Mixpanel connector (`mixpanel`, `health-check`, `conf-app` skills); Gmail triage and reply drafts (sending needs your go-ahead per message); Figma design reads; Slack; HubSpot.
- **Works today:** code changes proven by unit tests, docs, skills, PR review, CI babysitting. Push branch → PR → GitHub Actions runs E2E on staging with CI's own secrets.
- **After pre-departure step 2:** D1 / KV / paywall state via Cloudflare REST (`paywall`, `tenant`, `marketplace`, `income-radar`), JSM queue triage (`support-queue`, `extend-space-license`), Confluence REST page work (`create-test-page`, `find-macros-on-page`), `forge install list` / flag reads.
- Routines: the paywall block-retirement re-read already runs on this environment; one-shot reminders can be added via `RemoteTrigger`. (The docat weekly check lives on a different environment.)

## 4. Work that does not suit the cloud (leave for return)

- Anything needing your **own** Atlassian identity in a browser: Marketplace manage UI, developer console flag edits, `admin.atlassian.com`, Forge deploy from a laptop.
- Visual UI work: Storybook, Vite dev server, `forge tunnel`, agent-browser spot checks with human eyes. Screenshots from headless Playwright are the ceiling.
- Production releases. The release pipeline runs in GitHub, but the policy requires PVT + a post-release spot check with UI evidence, and rollbacks need a laptop. Recommendation: no production release for 14 days unless an incident forces it.
- Codex / codexloom / seedmux / Cursor workflows: local daemons, none in the cloud.
- Any task whose credential lives only in `.env.forge.local` or the macOS keychain.

## 5. Environment layout — one per secrets profile, not per repo

An environment holds only a network policy, env vars / API credentials and a setup script;
the repository is picked separately in the composer. Repos that share secrets share one
environment, so a token is entered once and rotated in one place.

```
 secrets profile                  repos                               environment
 ─────────────────────────────    ──────────────────────────────────  ───────────────────────
 Atlassian: FORGE_*, JSM_*,       conf-app, conf-mini-sites,          "Conf App" (rename to
   CLOUDFLARE_*, Mixpanel JQL     aws-widgets                          "Atlassian apps")
 Diagramly: CHARGEBEE_*, Neon,    diagramly.ai                        "Diagramly.ai"
   AGENT_LINK_*, App Insights
 none (Trusted network is fine)   mmd-zenuml-core, web-sequence,      one env; fold "ZenUML",
                                  docs sites                           "ZenUML CORE", "Web sequence"
 —                                —                                   "Conf app 2": empty, archive
```

Evidence (2026-09-12, names only): conf-app `.env*` carries `FORGE_*`, `JSM_*`,
`CLOUDFLARE_ACCOUNT_ID`; diagramly.ai carries `CHARGEBEE_*`, `AGENT_LINK_*`,
`APPLICATIONINSIGHTS_*`, no overlap. mini-sites and aws-widgets keep no `.env` on disk and
are Forge apps under the same Atlassian owner, so the same `FORGE_*` token serves them.

Routines bind an environment by id (`env_018cHo8XMcQftZBkNS3atV6c`), so renaming "Conf App"
breaks nothing; archiving it would.

Shared setup script, since the repos differ in package manager (conf-app and mini-sites
pnpm, aws-widgets npm/yarn, core bun):

```bash
#!/bin/bash
if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile
elif [ -f bun.lock ]; then bun install --frozen-lockfile
elif [ -f package-lock.json ]; then npm ci; fi
```

## 6. How to start from the phone

1. claude.ai app → Code → new session on **ZenUml/conf-app**, environment **"Conf App"** (`env_018cHo8XMcQftZBkNS3atV6c`; "Conf app 2" is empty — archive or ignore).
2. First message names the skill (`/health-check 1d`, `/support-queue`, `/tenant <domain>`), so the session loads the right reference before touching credentials.
3. For recurring checks, ask the session to create a routine on the same environment; check results under Routines.
