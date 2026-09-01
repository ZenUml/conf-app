# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project orientation

### Domain terminology

- **edits** — new versions of existing macro custom content (updating an existing diagram)
- **creates** — new macro custom content (saving a diagram for the first time)
- **D1** — Cloudflare D1 database (SQLite-compatible, used for backend storage)
- **pw** — Playwright (E2E test runner)
- **client** / **tenant** — interchangeable; both refer to a Confluence Cloud site (one Atlassian instance that has installed the add-on)
- **spot check** — ad hoc, AI-driven, ephemeral verification of a specific behavior; use the **spot-check** skill

### Project overview

This is a ZenUML Confluence Cloud Add-on (Forge app) that provides diagramming capabilities for Confluence users. The `DiagramType` enum (`src/model/Diagram/Diagram.ts`) defines seven user-facing diagram types (`Unknown` is only a sentinel fallback):

Six of the seven (`Sequence`, `Mermaid`, `PlantUml`, `Graph`, `OpenApi`, `Embed`) are self-describing from the enum. The seventh carries variant rules that the enum does not state:

- **AsyncApi** — AsyncAPI specifications via the bundled AsyncAPI Studio build (`vendor/asyncapi-studio` submodule). Ships **only** in the asyncapi variant — the `zenuml-asyncapi-*` macros and `async-api-doc` custom content are stripped from lite/full/diagramly manifests (see `manifest.yml` comments and `.github/workflows/release.yml`)

Stack, build system, and deployment targets are stated in `package.json`, `wrangler.toml`, and `manifest.yml`. The one platform fact those files do not make obvious is under **Pure Forge — no Connect code** below.

### Product variants

The add-on comes in four variants:

- **Full Version** (`PRODUCT_TYPE=full`) — All features enabled
- **Lite Version** (`PRODUCT_TYPE=lite`) — Reduced feature set (free)
- **Diagramly** (`PRODUCT_TYPE=diagramly`) — Diagramly-branded variant
- **AsyncAPI** (`PRODUCT_TYPE=asyncapi`) — "AsyncAPI for Confluence" variant with its own Forge app identity (`APP_ID=49017727-af19-4ab6-8d5a-7d28108936b6`, macro key `zenuml-asyncapi-macro`, custom content `async-api-doc` — see the `forge:*:asyncapi:*` scripts in `package.json`). **Not single-macro:** the manifest strip (`scripts/forge-wizard.mjs`, filter `test("zenuml-asyncapi|zenuml-openapi-macro") | not`) keeps the asyncapi macros **plus `zenuml-openapi-macro`** — AsyncAPI and OpenAPI are sibling API-spec formats, so this variant ships both API editors. Consequence: anything wired into the OpenAPI/swagger editor (`forge-swagger-editor.ts` → `SyntaxErrorBox` → **AI Repair**, gated by the `ai-repair-enabled` Forge flag) is reachable in the asyncapi app via the OpenAPI macro, even though the AsyncAPI Studio editor itself has no such wiring. Build: `pnpm build:asyncapi` (runs `build:studio` first). Staging site `asyncapi-stg.atlassian.net`; backend shares the Lite Cloudflare Pages project (`conf-stg-lite` staging / `conf-lite` prod per `release.yml`), with prod `BACKEND_API_BASE_URL=https://zenapi.zenuml.com`

### The Handbook (internal team site)

The **Handbook** is our internal, team-only knowledge site — *not* customer-facing. It collects what the team needs day to day: developer reference, operations runbooks, pricing/growth strategy, and customer intelligence (profiles, investigations). Because it can contain client-sensitive data, it lives in the **`private/` submodule** (`ZenUml/conf-app-private`), never the public repo. (This replaces the older, narrower "dev site" framing.)

## Hard rules

### Never mark a UI spot check passed without UI evidence

A spot check assertion that requires UI verification must be confirmed by actually observing the UI — a screenshot, a snapshot, or a network intercept. Passing a unit test does not satisfy a UI assertion. If the UI cannot be driven (e.g. iframe keyboard limitations), mark the assertion **SKIPPED** with the reason and the blocker, not **PASS**.

### Never state without evidence

Do not assert facts about external systems, APIs, processes, or behavior unless you can point to proof — code you read, a doc you fetched, a command you ran. If you don't have evidence, say "I don't know" or "I'd need to verify this." Guessing and presenting it as fact is strictly prohibited.

### Plan Mixpanel events before implementing any feature

Before writing code for any new feature, define the analytics events first. For each event specify: name, trigger (what user action or system transition fires it), and the key properties (e.g. `feature_area`, `surface`, `macro_type`, outcome fields). Add them to `src/utils/analytics/catalog.ts` and `src/utils/analytics/types.ts` as the first commit of the feature branch.

**Why:** events retrofitted after the fact miss edge cases (e.g. "accepted vs modified" required understanding the full UX flow before implementation). Planning events up front forces clarity on what "success" looks like before the code is written.

### Pure Forge — no Connect code

All four variants (lite, full, diagramly, asyncapi) are **Forge-only** in production. The Connect runtime is fully removed.

**Only exception:** `manifest.yml` must keep the `app.connect` / Connect key / modules entries — Atlassian's Forge-from-Connect migration requires these to stay so that upgrade paths from legacy Connect installs still work. Don't remove those.

For the full policy — banned APIs (`AP.*`, `xdm_e`, Connect hosts), `@forge/bridge` replacements, environment detection, DrawIO URL rules — see `docs/policies/forge-only.md` (create if absent when you need to capture a new decision).

### Client privacy — no client names in public files

Real Confluence tenant names (subdomain prefixes, `<customer>.atlassian.net` hostnames, customer page titles, customer `cloudId`s) **MUST NOT** appear in any public-repo file. Use placeholders (`example-tenant`, `example.atlassian.net`). Real tenant data lives in the `private/` submodule (`ZenUml/conf-app-private`).

Full rules, artifact routing table, pre-commit grep, and background: [docs/policies/client-privacy.md](docs/policies/client-privacy.md).

### Never commit directly to `main`

Always use a feature branch. Exceptions, both requiring the change be **confined** to those paths: `.md`-only changes, and agent-skill changes under `.claude/skills/**` (any file type — `SKILL.md` *and* its `.py`/`.mjs`/`.sh` helpers; skills are agent tooling, and CI `paths-ignore`s `.claude/**` so a PR adds no signal).

**The primary checkout (`workspaces/zenuml/conf-app`) stays on `main`** — feature work goes in a worktree beside it (`../conf-app-<feature>`), because a branch can only be checked out in one worktree and a stale worktree holding `main` blocks `git switch main` in the primary directory. Still don't create a worktree reflexively: `.md`-only edits go straight to `main`, and changes to git-ignored files need no branch or worktree at all. See [docs/policies/git-workflow.md](docs/policies/git-workflow.md) for the full protocol — per-worktree setup cost, start-of-issue steps, cleanup.

### Never disrupt another session's working tree

If `git status` shows uncommitted changes you didn't make, **do not** `git checkout`, `git reset --hard`, `git restore`, `git clean`, or `git stash` those changes — all of these either destroy or displace in-flight work from another session.

Instead, create a new branch from `main` using a worktree:

```bash
git worktree add ../conf-app-<your-feature> -b <your-feature-branch> main
```

The original directory stays untouched. When in doubt, ask before any destructive git operation.

## Architecture

### Backend (Cloudflare Workers)

Backend code is in `functions/`. See [functions/CLAUDE.md](functions/CLAUDE.md) — it holds the `public/_routes.json` allowlist gotcha, which makes a new function path return static HTML instead of running.

### Content management

The app uses custom content (V2 API) for diagram persistence.

Confluence is the system of record for diagram content; D1/backend data may support telemetry or sync, but must not become required storage or recovery for user diagram bodies. Rendering and editing must not depend on our Cloudflare backend being available when Confluence storage is available.

## Local development

### Initial setup

1. Copy `wrangler-dev.toml` to `wrangler.toml`
2. Set up D1 database bindings
3. Configure environment variables in `wrangler.toml`

### Build, test & dev server

See `package.json` scripts — `build:full`, `build:lite`, `test:unit`, `test:e2e`,
`start:local` (frontend only), `start:sit` (frontend + backend proxy), `wrangler:serve`.

### Database setup

```bash
# Create D1 database
wrangler d1 create zenuml-for-confluence

# Run migrations
wrangler d1 migrations apply zenuml-for-confluence --remote
```

## Operations

### Agent container — what you can actually reach

When running in the Claude Code remote container, **do not rediscover credentials by
trial and error** — read [docs/reference/agent-container-credentials.md](docs/reference/agent-container-credentials.md).
The short version:

- `FORGE_EMAIL` + `FORGE_API_TOKEN` → Confluence REST v2 on all seven of our sites, **and** the Marketplace vendor export API. This is the credential for all Confluence content work.
- `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` → D1 query, KV read, Pages. Prefer the **REST API** for one-offs; `wrangler` works too, but only after `pnpm install`.
- `MIXPANEL_SA_USER` + `MIXPANEL_SA_SECRET` → project `3373228` query API.
- `ATLASSIAN_USERNAME` / `ATLASSIAN_PASSWORD` / `ATLASSIAN_OTP` → robot account for **browser login only** (Playwright); these do not work as REST basic auth.
- GitHub → the `mcp__github__*` tools. `GH_TOKEN` is the placeholder string `proxy-injected`, and a direct `api.github.com` call returns **`200` with an error body** — never read that status as success.
- `forge` and `wrangler` are devDependencies — they exist only **after `pnpm install`** (the e2e workspace needs its own install). `forge` then authenticates from `FORGE_EMAIL`/`FORGE_API_TOKEN`, but its first run dies on a non-TTY analytics prompt; clear it with `forge settings set usage-analytics false` and `forge install list` works.

Never echo a secret's value; prove access with a status code instead.

### Forge deployment

**Staging deployment rule:** staging is deployed only by the GitHub Actions CI/CD pipeline triggered by pushing the candidate branch. Do **not** run `pnpm forge:deploy:*:staging` from a local shell; use the pipeline run as the deployment authority and verify its completion before staging checks. Local Forge use is limited to development tunnels and read-only diagnostics.

See the `forge:deploy:*` scripts in `package.json`, one per variant and environment. For local tunnelling use the **forge-tunnel** skill.

#### Forge CLI auth

If `forge whoami` says not logged in (or `forge login` fails on keychain), see [docs/debugging/forge-cli-auth.md](docs/debugging/forge-cli-auth.md). Common in IDE/non-TTY shells: rebuild `keytar`, unlock macOS keychain, re-login from Terminal.app, or use `FORGE_EMAIL` / `FORGE_API_TOKEN`.

### Cloudflare Pages projects

Lite / full / diagramly map to `conf-stg-lite`, `conf-stg-full`, `conf-lite`, `conf-full`. See [docs/ops/cloudflare-pages.md](docs/ops/cloudflare-pages.md) for the full table, CI sources, and `wrangler pages secret put` usage.

### Forge Functions usage & cost (GB-seconds)

When a "Forge Functions usage" alert fires, use the **forge-functions-cost** skill — it holds the
Developer-console ground-truth path and the billing subtleties (a `trigger`→`remote` forward bills as
SYNC, not waived async).

### Forge app versions — major vs minor (admin consent)

A **major** version (requires **admin re-consent** on upgrade, rolls out only as admins approve) is caused **only** by: scope changes (add/swap/**remove**), new `dynamic` web triggers (or `static`→`dynamic`), and licensing/providers/remotes changes. See [Forge — App versions](https://developer.atlassian.com/platform/forge/versions/).

**Egress / CSP / external-fetch URL changes are NOT major for our apps** — they auto-upgrade with no admin consent. Our variants (lite/full/diagramly/asyncapi) are all **Forge-from-Connect (Connect-migrated)** apps, and `manifest.yml` documents this exactly above the `permissions.external` block: *"Modifying content permissions CSP options, external permissions CSP options and URLs, or fetch permissions options and URLs does not require admin approval."* The retained Connect consent already covers the network permission, so adding an egress entry — **even a new scheme like `wss://*.zenuml.com`** — stays a **minor** bump. (Connect-migration exception; in a *pure* Forge app, adding egress WOULD force a major. The same principle covers Forge scopes that inherit an already-accepted Connect scope — see the note at the top of `permissions:` in `manifest.yml`.) **Evidence, 2026-07-11:** the agent-link release added `wss://*.zenuml.com` to `external.fetch.{backend,client}`; asyncapi deployed as **`10.7.0` (minor)** and all 8 prod installs auto-upgraded to `Latest` with no consent wall.

Changing a `trigger` module's `events:` list (e.g. removing `avi:confluence:viewed:page`) is **NOT** on that list, and as long as `permissions.scopes` is untouched it is a **minor** version → **auto-upgrades to all installs, no admin consent**. Do not claim otherwise. The docs don't state event-list changes explicitly, so the zero-cost confirmation is the **`forge deploy` output**, which reports the deployed version (and any major-version change) at deploy time.

**Remote storage declaration status, 2026-08-11:** PR #383 removed the Full/Diagramly/AsyncAPI `operations: storage` and `storage.inScopeEUD: true` strips from `scripts/forge-wizard.mjs`, but missed duplicate strips in `.github/workflows/staging-deploy.yml` and `.github/workflows/release.yml`. Its merge deployment therefore still removed the declaration before Forge deploy; the observed minor versions (`3.448.0`, `2.637.0`, and `5.127.0`) do **not** classify the intended change. PR #460 removes the remaining workflow strips. Before the first main-branch staging deployment containing #460, the version impact is **unknown**: the Forge remotes reference explicitly marks `inScopeEUD: false` → `true` as major, while these generated manifests previously omitted the field entirely. Treat that staging deploy output as the authoritative classification and do not release production until it is checked.

### CI on PRs — a CANCELLED run next to a green one is NORMAL (don't investigate it)

Every push to a PR branch fires the `Build, Test and Draft Release` workflow (`.github/workflows/build-test-deploy.yml`) **twice** — once on the `push` event and once on the `pull_request` (`synchronize`) event, both on the same head SHA. A `concurrency` group keyed on the bare branch name with `cancel-in-progress: true` (for non-default branches) **deliberately cancels one of the two as a duplicate** — usually the `push` run shows up `CANCELLED`. This is by design (the workflow comments say so), not a failure.

So when checking a PR before merge:
- `gh pr view <pr> --json mergeStateStatus` showing **`UNSTABLE`** with some `CANCELLED` contexts is **expected and mergeable** — it is not a real failure.
- The authoritative signal is the surviving **`pull_request`** run for the head SHA. Verify with: `gh run list --json event,headSha,conclusion` — the `pull_request` run's `conclusion: success` is what matters. The `CANCELLED` `push` run is noise; `gh run view <id> --log-failed` on it is empty because it was cancelled, not failed. **Do not spend rounds diagnosing it.**
- `.md` / `docs/**` / `.claude/**` / `.cursor/**`-only changes are `paths-ignore`d by both triggers, so those PRs show `CLEAN` with nearly all checks `skipping` — also normal, and they do not run E2E or trigger a staging deploy.

### Analytics & observability

Key gotcha: `page_viewed` in D1 signals tenant activity on Confluence — **not** a macro view. Use Mixpanel `macro_viewed` (project ID `3373228`) for macro engagement.

Full reference (event storage, `clientDomain` format, key sources, paywall events): [docs/analytics/reference.md](docs/analytics/reference.md). For query patterns, use the **conf-app** skill.

**Paywall mechanics** (metered soft-paywall, the "Continue editing (N)" counter, staging test spaces, how to skip it): use the **paywall** skill.

**Every new feature must include Mixpanel tracking.** When adding a feature, add `trackAnalyticsEvent` calls for the key lifecycle moments (requested, succeeded, failed, dismissed, etc.). Register new event names in `src/utils/analytics/catalog.ts` (`AnalyticsEventName` union) and use appropriate properties from `src/utils/analytics/types.ts`. Tracking is not optional — it is part of the definition of done.

### Bug reports: User-First Trace

Frame bug reports and incident write-ups user-journey first, then runtime evidence, then code path —
see the **bug-report-framing** skill.

## Browser automation and Forge iframes

Forge Custom UI apps render inside **sandboxed cross-origin iframes** (OOPIFs). Three tools reach inside them; the rest cannot.

**Default to `agent-browser`** for ad hoc Forge macro work (spot checks, PVT, UI inspection). Checked-in E2E specs stay on standalone `@playwright/test` — that is a test-runner choice, unrelated to the MCP server below.

```bash
agent-browser --session conf-app --restore=stg <command>
```

`--session conf-app --restore=stg` loads a saved login state from `~/.agent-browser/sessions/stg-conf-app.json` (robot1yanhui, `cloud.session.token` valid to 2026-09-15). Without it every invocation starts on a blank profile and lands on the Atlassian login page. The SSO token covers any `*.atlassian.net` site the account belongs to; a site's first visit costs one redirect, then its cookie is cached.

| Tool | OOPIF snapshot | OOPIF `eval` | OOPIF console | snapshot token |
|---|---|---|---|---|
| **agent-browser** | ✅ | ✅ | ✅ | 9,048 |
| **ego lite** (`ego-browser`) | ✅ | ✅ (`cdp` + `sessionId`) | ✅ (`Runtime.enable` + `drainEvents`) | 12,246 |
| **Playwright MCP** | ✅ | ✅ (snapshot `ref` as `target`) | ✅ (`console-*.log`) | 17,914 |
| **Kimi WebBridge** | ❌ | ❌ | ❌ | 17,888 |
| chrome-devtools-mcp | ❌ | ❌ | ❌ | — |
| browser-use | ❌ | ❌ | ❌ | — |
| claude-in-chrome | ❌ | ❌ | ❌ | — |

Measured 2026-08-16 on lite-stg page 211026061; token counts are one accessibility snapshot of the same page (`cl100k_base`). Wall-clock for a 3-step flow was 13.5–15.7 s for all three capable tools — no measurable speed difference.

**Why agent-browser is the default, and it is not token cost.** Playwright MCP drives one Chrome extension relay with a single global pairing: every concurrent Claude Code session competes for it, the loser's calls hang for 120 s, and recovery needs `/mcp` → Reconnect, which only the user can run. Over 2026-08-10..16 that produced 27 timeouts, 14 `PROFILE_BUSY`, 19 `Target … has been closed`, and **14 forced user interventions**. agent-browser gives each session its own `user-data-dir`, so the failure mode does not exist. Token saving is a rounding error by comparison (~1% of daily spend).

**Nested iframes work as of the 2026-08-17 patch** (`ab-src` `d2d8dbd`). A DrawIO editor inside a Forge macro OOPIF is two `frame` calls deep, and both `frame` and `eval` reach it. Take the ref from a snapshot in the *current* frame's context — `@e` refs are per-snapshot and per-frame, so re-read after every `frame` and every navigation:

```bash
A(){ agent-browser --session conf-app --restore=stg "$@"; }
A frame "@e42"                      # layer 1: editor OOPIF
A snapshot | grep Iframe            # re-read the ref HERE
A frame "@e1"                       # layer 2: DrawIO
A eval "typeof window.mxClient"     # -> "object"
```

Older builds fail two ways worth recognising: `frame @<ref>` reported `✓ Done` while `eval` silently stayed in the top frame (verify with `location.host` — it must be the `cdn.prod.atlassian-dev.net` host), and second-layer `eval` was rejected by the inner frame's CSP for lacking `unsafe-eval`. Both are fixed; the CSP one only ever affected same-origin nested frames.

The DrawIO **instance** is a separate matter: the deployed build keeps its UI object in a closure, so `window.editorUi` does not exist and `graph-macro/SKILL.md`'s `editorUi.editor.graph.insertVertex(...)` fallback has no entry point. Reaching it in the current build is unsolved — use that skill's UI-click primary path.

Kimi WebBridge cannot be used for Forge work at all: its snapshot omits OOPIF subtrees, and its `cdp` passthrough is `chrome.debugger`, which rejects `Target.getTargets` and `Target.attachToTarget` with `Not allowed`.

**This section overrides the skills.** Twelve `.claude/skills/*/SKILL.md` files still spell their browser steps as `mcp__playwright__*` calls. Their *logic* (which page, which selector, which assertion) is still correct — translate the mechanics to agent-browser as you go:

| Playwright MCP | agent-browser (prefix every call with `--session conf-app --restore=stg`) |
|---|---|
| `browser_navigate({url})` | `open <url>` |
| `browser_snapshot()` | `snapshot` |
| `browser_evaluate({function})` | `eval "<expr>"` |
| `browser_click({target})` | `click "@<ref>"` |
| `browser_type` / `browser_fill_form` | `fill "@<ref>" "<value>"` |
| `browser_take_screenshot({filename})` | `screenshot <path>` |
| `frameLocator()` / snapshot `ref` as `target` | `frame "@<ref>"`, then plain `eval` / `click` |
| `browser_console_messages()` | `console` |

Reach for Playwright MCP only when a skill needs something agent-browser lacks, or when agent-browser itself fails. Standalone `@playwright/test` under `tests/e2e-tests/` is unaffected by any of this.

## Agent skills

- **spot-check** — ad hoc verification of a specific behavior (not a checked-in E2E test). Triggers: "spot check on staging", "verify this fix". Forge iframe rules in [Browser automation and Forge iframes](#browser-automation-and-forge-iframes).
- **Issue tracker** — issues live as GitHub issues on `ZenUml/conf-app`; use the `gh` CLI for all operations.
- **Triage labels** — five canonical roles, names verbatim: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.
- **Domain docs** — single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root (created lazily by `/grill-with-docs` as terms and decisions crystallise).
- **Vendored skill set** — the 25 skills from [mattpocock/skills](https://github.com/mattpocock/skills) (`grill-me`, `grill-with-docs`, `tdd`, `code-review`, `implement`, `triage`, `to-spec`, `to-tickets`, `wayfinder`, …) are copied into `.claude/skills/` as editable files we own, not installed as the `mattpocock-skills` plugin — a plugin install is per-machine and would not reach the team or the remote agent containers. Vendored from upstream `6654f6b` (plugin v1.2.3); to refresh, re-copy from that repo rather than editing in place, or keep local edits deliberate. Do **not** also run `claude plugins install mattpocock-skills`: that would give every skill twice.
- **`code-review` shadows the built-in** — `.claude/skills/code-review/` (Matt Pocock's two-axis Standards + Spec review) takes precedence over Claude Code's built-in `/code-review` in this repo. Rename the directory if you want the built-in back.
