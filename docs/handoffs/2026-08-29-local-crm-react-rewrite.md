# Handoff — Local CRM console, rewrite in React

**To:** the agent implementing this next.
**From:** the session that imported `Local CRM.dc.html` from Claude Design and started a Vue implementation.
**Date:** 2026-08-29. **Repo:** `ZenUml/conf-app`. **Branch at handoff:** `fix/diagramly-first-seen-smoke-scope`.

**Read sections 3, 5 and 6 before writing any code.** Section 5 lists rules the design is built around; breaking one produces a screen that looks right and lies. Section 6 lists three defects in the source prototype and how they were resolved — you will hit all three.

---

## 1 · What this is

An internal, local-only operations console for the ZenUML for Confluence Marketplace app. It puts three lifecycle scenarios into one event stream — new registrations (**Welcome**), paywall extension grants (**Extension**), and expiries (**Retention**) — so an operator sees what happened, what evidence exists behind it, and what the single next step is.

Five screens plus a detail drawer. Runs on `localhost:7331`, bound to loopback, never deployed.

The governing constraint, stated in the design handoff and enforced throughout:

> **The UI must never claim more than the data supports.** Most layout decisions exist to keep "we wrote a record", "we sent a message", "they replied" and "the site actually used the product" visually separate. Every unknown renders in red as an explicit unknown, never as an empty cell or a zero.

---

## 2 · Sources of truth

| What | Where | Notes |
|---|---|---|
| The design | Claude Design project `ea471416-dbac-410c-9697-af63c2b079e6`, file `Local CRM.dc.html` | 1,367 lines. Read via the `DesignSync` MCP tool, `method: "get_file"`. Template is lines 25–548; logic is lines 551–1363. |
| Written spec | same project, `design_handoff_lifecycle_crm/README.md` | Prose spec: screens, drawer regions, the lifecycle rail, tokens, copy rules. **This is the authority when it and the prototype disagree.** |
| Design tokens | same project, `_ds/zenuml-for-confluence-design-system-.../colors_and_type.css` | Already copied verbatim to `local-crm/src/styles/tokens.css`. Re-copy rather than transcribe values. |
| Real data | `private/local-data/lifecycle/real-data-handoff-2026-08-29.md` | Git-excluded. Real tenant hostnames and cloud IDs. **Never copy rows into the public repo.** See section 7. |
| Backend that feeds it | branch `feat/lifecycle-crm` | Migration `0024_add_lifecycle_crm.sql`, `0025` (written, never applied), `scripts/lifecycle/*`, `workers/lifecycle-ingest/*`. **Backend only — it contains no UI.** |

Two more files sit in the design project and are **not** needed: `support.js` (the prototype's own runtime, explicitly not for porting) and `client-profiles/assets/style.css` (the AsyncAPI Client Profiles page CSS — `hp-*`/`br-*` classes the CRM design never uses; its only effect is a `body` background the prototype immediately overrides).

---

## 2a · Local mirror of the design source (added 2026-08-29, 16:45 AEST)

The Claude Design integration was re-checked and **is accessible** — `list_files` and `get_file`
both answered with no re-authorisation. The source is now mirrored on disk so the rewrite does
not depend on the integration staying up. Mirroring is split by `docs/policies/client-privacy.md`,
because `Local CRM.dc.html` carries 66 real tenant subdomains and 15 real customer email
addresses in its `REG` / `EXT` / `JSM` arrays.

**Public, committed — `docs/handoffs/local-crm-design-source/`** (scanned: 0 customer emails,
0 customer `*.atlassian.net` hostnames):

| File | Why the rewrite needs it |
|---|---|
| `design_handoff_lifecycle_crm/README.md` | The written spec. Authority over the prototype. |
| `_ds/colors_and_type.css` | Pristine token file. `local-crm/src/styles/tokens.css` is this file plus a header comment. |
| `_ds/_adherence.oxlintrc.json` | **React-specific.** oxlint config with the `react` plugin: bans raw hex and raw `px` literals in favour of `var()` tokens, and declares the prop contracts for `Button`, `TabSwitcherTab`, `TitleInput`. Wire this into the React lint step. |
| `_ds/_ds_manifest.json` | The 113 token names and their kinds. |
| `_ds/README.md` | Design-system prose: voice, casing, iconography priority, hover/focus/press, animation rules. |
| `_ds/client-profiles-assets-style.css` | Linked by the prototype and **not needed** — `hp-*`/`br-*` classes the CRM never uses. Mirrored so that claim is checkable. |
| `real-data-instructions.md`, `remove-suppressed.md` | Context docs from the design project. |

**Git-excluded — `private/local-data/lifecycle/design-source/`** (identity-bearing; `private/local-data/` is excluded via `.git/modules/private/info/exclude`):

- `Local CRM.dc.html` — the 1,367-line prototype. Both copies in the design project
  (root and `design_handoff_lifecycle_crm/`) are byte-identical, `sha256:d8c488f6c64e…`.
- `support.js` — the prototype runtime, mirrored only so the file opens. Not for porting.
- `_ds/…/colors_and_type.css`, `_ds/…/client-profiles/assets/style.css` — duplicated at the exact
  paths the HTML references, so it renders without edits.
- `_ds/…/_ds_bundle.TRUNCATED.js` — see below.

### Opening the prototype

```bash
cd private/local-data/lifecycle/design-source
python3 -m http.server 7788
# then http://127.0.0.1:7788/Local%20CRM.dc.html
```

Serve it over HTTP rather than `file://` — the runtime fetches its own source, which a `file://`
origin blocks. **Network access is required**: `support.js` pulls React 18.3.1 UMD and
`@babel/standalone` 7.29.0 from unpkg at runtime.

**Verified 2026-08-29 by rendering it** (Chrome, 1440×900): React loaded, 5 nav buttons, nav
counts 21 / 39 / 37 / 2 / 8, filter counts `everything 85 · registrations 21 · grants 37 ·
expiries 26`, stream and lifecycle rails drawn. The screenshot is at
`private/local-data/lifecycle/prototype-today.png`.

That render is also **visual confirmation of defect 6.1**: all three right-rail cards — "New this
month, by app", "Ingested contacts", "No data source yet" — draw their heading and footer with
**no rows at all**, because `renderVals()` never returns `byApp`, `steps` or `gaps`.

### What could NOT be retrieved in full

`_ds/…/_ds_bundle.js` is **truncated**: `get_file` caps responses at 256 KiB and the API returned
`truncated: true` at 258,177 characters. The full size is unknown. The mirrored copy is therefore
named `_ds_bundle.TRUNCATED.js`, which makes the prototype's `<script src>` 404 instead of
throwing a `SyntaxError` on a half-file. This costs the rewrite nothing: the bundle contains only
`Button`, `TabSwitcher` and `TitleInput`, and the Local CRM design uses none of them. It is also
identity-bearing — it embeds the client-profile preview components, which carry 32 real tenant
names — so it could not be committed publicly in any case.

Two `uploads/draw-*.png` files exist in the design project. `Local CRM.dc.html` contains zero
`<img>`, `.png` or `uploads/` references, and the design handoff states "Assets: None", so they
were not mirrored.

### One thing to decide

`local-crm/package.json` now pins `react@=17.0.2`. The prototype runtime loads **React 18.3.1**.
The design-system README describes the source product as having "React 17 islands", so the pin is
defensible, but it was not derived from the design source. Nothing in the Local CRM design needs
either version specifically — no portal, no concurrent features, no `createRoot` requirement in
the target app.

---

## 3 · What already exists, and what to keep

Everything is under `local-crm/`. `pnpm install` has been run; `local-crm` is listed in the root `pnpm-workspace.yaml`.

### Keep verbatim — framework-neutral TypeScript, no Vue import in any of them

These are the expensive part. They encode the state machines, the derivations and the copy. Port the React app on top of them unchanged.

| File | Lines | What it owns |
|---|---|---|
| `src/data/types.ts` | ~180 | The four data sources as types. Comments record why a field is absent (no `Registration.contact`, no stored `Grant.active`). |
| `src/data/placeholder.ts` | ~330 | The shipped identity-free dataset. Shape-faithful to the real extraction. |
| `src/data/index.ts` | ~20 | Loader. Prefers git-excluded `src/data/local/dataset.ts`, else the placeholder. Uses `import.meta.glob` — swap for your bundler's equivalent if you leave Vite. |
| `src/lib/format.ts` | ~55 | `iso` / `human` / `relative` / `count` / `plural` / `hostname`. |
| `src/lib/lifecycle.ts` | ~230 | **The four state machines.** `lifecycleOf()`, `grantState()`, `requesterOf()`, `stageLabel()`, `dotColor()`, `WRITE_ACTIONS`. |
| `src/lib/derive.ts` | ~330 | Event stream, day grouping, scheduled block, sites, site stats, tenants, unresolved grants, filter counts. |
| `src/lib/caseModel.ts` | ~530 | The drawer view-model per case kind: facts, actions, blockers, tracks, departure classes, audits, provenance, footer. |
| `src/lib/actions.ts` | ~130 | Maps `ActionSpec[]` + session state into `next` / `more`, including the blocked-means-no-button rule. |
| `src/lib/palette.ts` | ~55 | Product accents, origin-bucket accents, rule tones. Values are `var(--…)` references only. |
| `src/styles/tokens.css` | ~215 | Verbatim design-system token file. |

### Rewrite — Vue-specific

| File | Notes for the React version |
|---|---|
| `src/stores/crm.ts` | Pinia store. State shape is in section 5.7 — keep it exactly. Becomes a reducer/context or Zustand store. |
| `src/styles/app.css` | Tailwind v4 `@theme` block mapping DS tokens to utilities. **Reusable as-is** if you stay on Tailwind v4 — read its header comment before changing import order. |
| `src/components/*.vue` (11 files) | Chip, SectionLabel, FactGrid, StageDots, ConfirmStrip, NavRail + `drawer/` (CaseDrawer, StageList, ActionCard, EvidenceTab, CommunicationTab, AuditTab). Translate; the Tailwind class strings carry the spacing and can be lifted directly. |

### Not built yet

- `TopBar.vue` — 60px header: screen title + subtitle, 280px search input, freshness pill.
- The five screens: `TodayScreen`, `SitesScreen`, `ExtensionsScreen`, `PendingScreen`, `AutomationScreen`.
- `EventCard` — the stream card.
- `App.vue`, `main.ts`, `README.md`.

### Verification status

**None. The app has never been started and no screenshot exists.** Do not treat any of the above as working code; treat it as a reviewed specification in TypeScript. `pnpm --dir local-crm typecheck` has not been run either.

---

## 4 · Screens

Left nav fixed **232px**. Content column designed for ~854px, so both wide tables scroll horizontally rather than compressing columns.

### 4.1 Today (default)

Two columns, `flex`, `gap: 20px`, page padding `20px 24px 28px`. Left `flex: 1; min-width: 520px`. Right `flex: 1; min-width: 320px`.

**Filter row.** `registrations` / `grants` / `expiries` / `everything` pills with counts. `position: sticky; top: 0; z-index: 6`, negative margins `-20px -24px 16px -24px` with matching padding so its background covers the full column width while scrolling. **Hard requirement — it must never scroll out of the viewport.**

**Stream.** Grouped by day. Each group: a 74px right-aligned date gutter (mono, semibold, relative line under it), a 1px vertical rule, then that day's cards.

**Event card.** `display: flex; gap: 11px; padding: 12px 14px`, 1px `var(--border)`, `var(--radius-md)`, white, `cursor: pointer`, hover `border-color: var(--border-strong)`, `transition: border-color var(--t-base)`. Contents: 9px status dot (solid past, hollow 2px ring when scheduled) · hostname in mono semibold + event-type chip · one sentence of what happened · a mono micro meta line · the lifecycle rail (section 5.1).

**Right column, four cards** — the first three are `byApp`, `steps`, `gaps` from the dataset; the fourth is the scheduled block (section 6.1):

1. **New this month, by app** — "against the skill's own baselines". Dot, app name (mono), count, note. `unverified: true` renders the note in danger red.
2. **Ingested contacts** — per-app split bar, solid = `welcome`, grey = `lapsed`. Footer: every `first_seen_at` is the bootstrap timestamp, not an acquisition date.
3. **No data source yet** — the `gaps` list, rust-bordered card.
4. **Scheduled** — count, next three upcoming days, then the "Then …" line.

### 4.2 Sites · 4.3 Extensions · 4.4 Pending assignment · 4.5 Automation

Grids with a header row. **Padding lives on the grid element only, never on the cells** — that is what keeps header and data columns aligned. Both wide grids get `overflow-x: auto` with explicit column floors, never percentage widths.

- **Sites** — 4 stat tiles, then rows: Client · Cloud ID · Apps · Extensions · Activity. Grid `minmax(170px,1.6fr) 96px minmax(110px,0.9fr) minmax(150px,1.2fr) 100px`, `min-width: 696px`.
- **Extensions** — two sections. "Who keeps asking": Client · Grants · Active · Spaces · Window, grid `minmax(160px,1.5fr) 76px 76px minmax(180px,1.4fr) minmax(140px,1.1fr)`, `min-width: 706px`. Then "Where grants come from": five origin cards, `repeat(auto-fit, minmax(280px,1fr))`, 3px left bar in the bucket's accent.
- **Pending assignment** — the unresolved grants, then a fixed explanatory card: there is no pending queue on the Welcome side, because a licence row with no cloud ID is rejected at transform.
- **Automation** — eight rule cards, `repeat(auto-fit, minmax(340px,1fr))`, 3px left bar by tone, badge chip, bullet items, mono audit footer.

Exact markup for all five is in the prototype: Today 81–179, Sites 182–216, Extensions 219–262, Pending 265–297, Automation 300–327.

---

## 5 · Rules the design is built around

Each of these is load-bearing. A violation produces a screen that looks correct and misinforms the operator.

### 5.1 The lifecycle rail — `skip` is not `todo` and not `done`

6px dots, `gap: 3px`, `box-sizing: border-box`, then an 11px mono label.

| Dot state | Rendering | Means |
|---|---|---|
| `done` | solid `--color-success` | genuinely completed |
| `now` | solid `--color-blue-600`, or `--accent-drawio-500` when the case is stalled | where it sits |
| `open` | solid `--accent-drawio-500` | unresolved, may be before or after the current stage |
| `skip` | transparent, 1px `--gray-300` ring | **never entered** |
| `todo` | solid `--gray-200` | not reached |

**Do not paint stages green because they precede the current one.** Grant cases legitimately sit at `applied` with `checking` and `ready-to-grant` never entered — no eligibility check ever ran. That must read hollow, not passed.

**One function owns per-stage state.** `lifecycleOf()` in `src/lib/lifecycle.ts`. The list rail and the drawer both read it. Do not let the two derive stage state independently.

**Label.** Stage name, position, total — `blocked · 3 of 8`. An `open` stage *after* the current one takes over the label (repeat grants read `already-applied · 7 of 7`). An `open` stage *before* it appends `· N unresolved earlier`. Implemented in `stageLabel()`.

The four state machines are in `lifecycleOf()`; the branch-states line under each is in `LifecycleView.branches`.

### 5.2 Blocked means no button

When a case carries blockers, every write-class action is suppressed **everywhere** in the drawer — not greyed, not confirm-gated: the button is absent and the row reads `Held while the case is blocked.` Read-only actions (readback, open ticket) stay live. Write-class keys: `revoke, feedback, regrant, release, internal, migrate, schedule` (`WRITE_ACTIONS`). Implemented in `buildActions()`.

The Only-next-step block renders its blockers as bullets and **no button at all** in that state.

### 5.3 Grant lifecycle position is derived, never stored

KV carries `status: "active"` plus an `expiresAt` and nothing else. `grantState()` resolves, in order:

1. `kind === 'test marker'` → synthetic e2e grant
2. domain starts `(` → `needs-details` — the cloud ID resolves to no site in the export
3. origin does not match `/^ZEN-\d+$/` → `outside the request flow`
4. an earlier grant exists for the same domain + space → `already-applied`
5. otherwise → `applied, unverified`

### 5.4 Communication tracks — the count differs per case, and that is the point

- **Welcome — 3 tracks.** Email delivery / Contact reply / Site-level signal. Keeping them apart is what stops a delivered email being read as site usage.
- **Extension — 2 tracks.** Requester / Site Contact. The Site Contact track exists and is **empty**: the grant endpoint notifies nobody.
- **Retention — 1 track.** Site Contact only. The end user is never a recipient of this platform.
- **Ingest run — 1 track.** "No external recipient."

`sent`, `delivered` and `replied` are **always separate rows**. A posted reply is not an acknowledgement, and delivery is not a reply.

### 5.5 Conditional fact rows appear only on mismatch

`typed domain` and `typed space` render only when what the requester typed disagrees with what resolved. A `flag` row renders only when the JSM pull recorded one. **Never render a row that repeats its neighbour.**

### 5.6 Facts the copy is built on — preserve them

- KV key shape is `license:<cloudId>:<spaceKey>:<accountId>`. There is **no audit table**: `ExtensionAction` holds 0 rows in production, 1 in staging, and no row for any of the 37 grants. A replay cannot be told from a first grant, and no readback has ever been compared against the intended target.
- There is **no persisted expiry event**. Expiry rows are derived from `expiresAt` at read time, reconstructed each load.
- 15 of 16 JSM requesters carry a `qm:` account id — filed from the portal while not signed in, so the identity is a **self-asserted email address**.
- **No ticket carries a customer-authored comment.** 13 of 16 sit in "Waiting for customer". Do not render this as "replied".
- ZEN-1206's only comment was authored by "Automation for Jira" with `isVendorReply: null`. The UI must say authorship is **unconfirmed**, not "we replied".
- `isSiteAdmin` and `siteContactNotified` are `null` for every ticket — not obtainable from the JSM REST API. Render as unknown, **never as false**.
- Welcome mail cannot be delivered at all: sending domain unverified at Resend, unsubscribe and preference URLs are literal placeholders, two merge tags render as raw tokens, no run-history table exists. **0 touchpoints exist for any contact.**
- Migration 0025 (eligibility columns + run log) was written and **never applied**. Local D1 is at 0024, production at 0023.

### 5.7 State shape — keep it

```
screen   'today' | 'sites' | 'extensions' | 'pending' | 'automation'
filter   'all' | 'registered' | 'granted' | 'expired'
selected selected event id, or null (drawer open when non-null)
tab      'evidence' | 'comms' | 'audit'
confirming  '<eventId>:<actionKey>' awaiting confirmation, or null
done     { '<eventId>:<actionKey>': timestamp }
query    search text (see section 6.3)
```

### 5.8 Interaction and motion

Card click → open drawer, reset to Evidence. Backdrop or ✕ → close, clearing any pending confirm. Action button → if confirm-gated, reveal the **inline** amber confirm strip with Confirm / Cancel — **never a modal, never `window.confirm`**; on confirm, stamp a timestamp and render the result inline, and the button is gone.

Transitions are colour-only. No scale, no springs, **no entry animation except the drawer slide** (`lc-in`, 180ms ease-out, `translateX(12px)` → none).

Nothing in this app performs a real write. Every action result is a rendered string.

### 5.9 Tokens, type, copy

Colour, type, spacing, radii and shadows come from `tokens.css`. Use that file; do not transcribe values.

- Mono for **every** identifier, date, count and key path. Weights 500 / 600 only. `--tracking-label` on uppercase micro-labels.
- Danger `--color-danger` for **every** unknown and problem value.
- Amber (`--accent-drawio-*`) means blocked or unresolved. Rust (`--accent-plantuml-*`) is confirm strips and "no data source yet".
- 4pt grid. `--radius-md` 6px, `--radius-lg` 8px. `--shadow-xl` on the drawer only. 1px borders throughout. No blur, no glass, no inner shadow.
- Sentence case everywhere. Plain and matter-of-fact. State names render verbatim in mono (`ready-to-send`, `needs-details`) — they are identifiers, not prose.
- **Icons: Heroicons v2 outline, stroke-width 1.5, only.** The design ships two inline paths (✕ and a magnifier); the nav's five are also Heroicons v2 outline and are already in `NavRail.vue`. No icon font, no images, no illustrations.

Three colours are **not** in the design system — they were introduced by this design and appear as literals in `Chip.vue`, and nowhere else: `dia` chip `#F8F0FE / #5B21A6 / #EBD9FB`, `failed` chip `#FDECEA / #8C2417 / #F7D4CF`, `sent` chip `#E9F7F1 / #1B6B4C / #CDEBDF`. A fourth, `#F6FBF8`, is the completed-action card background in `ActionCard.vue`.

---

## 6 · Defects in the source prototype, and how they were resolved

You will hit all three. These are deviations from the literal prototype, each justified against the written spec.

### 6.1 `byApp`, `steps` and `gaps` are referenced but never provided

The template reads `{{ byApp }}` (line 133), `{{ steps }}` (149) and `{{ gaps }}` (168). `renderVals()` returns none of them, so all three right-rail cards render empty in the prototype.

Resolved by adding them to the dataset. Numbers come from `private/local-data/lifecycle/real-data-handoff-2026-08-29.md`:

- `byApp` — lite 16 (baseline 15–20), full 3 (baseline 1–3), asyncapi 2 (baseline ~1 per half-year, marked **unverified**), diagramly 0 (baseline ~2). The asyncapi figure is 2 and not 6: four of the six NEW rows are `LEGACY_FREE` with 51–453 seats, which are pre-existing tenants surfacing, not acquisitions.
- `steps` — per app, welcome / lapsed: lite 825 / 76, full 116 / 357, asyncapi 15 / 15, diagramly 3 / 0. Total 1,407.
- `gaps` — four items: run history, touchpoints, per-contact eligibility, grant audit.

### 6.2 Scheduled events are computed, then dropped

`EVENTS` deliberately emits future-dated expiry rows, and a comment says so: *"Expiries in the future are shown as scheduled rather than hidden."* `PAST` then filters them out, and `feed` reads only `PAST`, so the hollow-dot and tinted-card treatment the written spec requires is unreachable.

The prototype also computes `aheadCount`, `ahead` and `aheadRest` (lines 921–944) and renders none of them. Their own comment states the intent: *"the stream shows what has happened; grants that have not run out yet are scheduled, so they sit in their own block and are counted separately."*

Resolved by building that block — a fourth right-rail card showing the count, the next three upcoming days, and the "Then …" line. The stream stays past-only, so the filter counts are unchanged. `scheduledEvents()`, `scheduledHead()` and `scheduledRest()` in `derive.ts`.

Two follow-on fixes in that code: `ahead.what` no longer parses the space key back out of the rendered sentence (the event carries `space`), and the "test marker and an operator-issued grant" clause is now read off the grants' `kind` instead of being asserted.

### 6.3 The header search input is not wired

The prototype renders a 280px input with placeholder `Search clients, cloud IDs, spaces…` and no state behind it. The written spec's State block omits search entirely.

Resolved by wiring it — a dead control in an operator tool is a defect. It filters the current screen's rows (`query` in the store; `feed`, `sites`, `tenants` all honour it). If you would rather match the prototype exactly, delete the input as well as the state; do not ship the input inert.

### One more, smaller

`ISO()` is called on `'28 Aug 03:04 UTC'` for the ingest event, and its third whitespace token is read as a 2-digit year, producing `2003:04-08-28`. The dataset now carries `ingest.runDay` (`'28 Aug'`) separately from `ingest.runAt` (`'28 Aug 03:04 UTC'`).

Also note `acts.filter(a => a.key !== 'preview')` at prototype line 1272: the Welcome case defines a "Preview the welcome email" action and then removes it before rendering. That is intentional and preserved — with the ESP unverified there is nothing a rendered preview could be checked against.

---

## 7 · Data and privacy — read before touching the dataset

`docs/policies/client-privacy.md` forbids real tenant hostnames, `cloudId`s, customer page titles and customer contact identities in **any** public-repo file. The prototype's arrays hold all four (real subdomains, truncated real cloud IDs, and 16 real requester email addresses in `JSM`). **They must not be committed.**

The arrangement in place:

- `src/data/placeholder.ts` — committed. Identity-free, shape-faithful. Every count, date, licence type, origin bucket, repeat-grant collision and unresolved cloud ID matches the real extraction, because the screens are built around those structures. Only identities are substituted.
- `src/data/local/dataset.ts` — git-ignored (see `local-crm/.gitignore`), default-exports a `Dataset`, and wins when present. Build it from `private/local-data/lifecycle/real-data-handoff-2026-08-29.md`.
- The loader in `src/data/index.ts` prefers the override and otherwise uses the placeholder. `Dataset.placeholder` says which is loaded — surface it in the UI if you add a banner.

Structural properties the placeholder preserves, which the screens depend on — keep them if you regenerate it:

- 21 registrations: 16 lite, 3 full, 2 asyncapi, 0 diagramly.
- 37 grants across 19 tenants, 11 active on 2026-08-29, 22 per-user / 15 space-wide.
- One tenant holds 9 grants across 6 spaces; 5 of them issued the same day by an A/B experiment. Three tenants account for 16 of the 37.
- 2 grants carry `(not in export)` — the cloud ID matches nothing. They are the entire Pending-assignment screen.
- Repeat grants exist on the same domain + space, which is what exercises `already-applied`.
- 15 of 37 grants carry a `ZEN-####` origin; 16 JSM tickets exist; exactly one (`ZEN-1206`) is in `jsmUnconfirmedAuthor`.
- One grant is a `test marker` running to 31 Dec 2027; one is operator-issued to 06 Apr 2027.
- Sites = union of registration domains and grant domains = 39, with exactly one overlap.

---

## 8 · Stack

Keep the app self-contained under `local-crm/`, port **7331**, loopback only.

Already in place and reusable if you stay on Vite + Tailwind v4: `vite.config.ts`, `postcss.config.js`, `tsconfig.json`, `index.html`, `src/styles/app.css`. Swap `@vitejs/plugin-vue` for `@vitejs/plugin-react` and replace the Vue devDependencies in `local-crm/package.json`.

`local-crm` is listed in the root `pnpm-workspace.yaml`. `pnpm install` has been run once.

`src/styles/app.css` maps design-system tokens onto Tailwind utilities via `@theme`. **Read its header comment before reordering the imports** — `tokens.css` is imported *after* Tailwind on purpose, so the DS values win for `--font-sans`, `--font-mono`, `--radius-md/-lg/-full`, `--shadow-xl` and the blue ramp. The DS blue and gray ramps are the Tailwind ramps, so `bg-blue-50`, `text-blue-800` and `border-gray-300` are already the design's colours. Names in `@theme` differ from the DS names deliberately: `--color-success: var(--color-success)` would be circular.

If you drop Vite, replace `import.meta.glob` in `src/data/index.ts` with your bundler's optional-import equivalent. Do not replace it with a `try/catch` that swallows a real error.

---

## 9 · Definition of done

1. `pnpm --dir local-crm typecheck` clean.
2. `pnpm --dir local-crm dev` serves on `127.0.0.1:7331`.
3. **Open it in a browser and screenshot all five screens plus the drawer in all three tabs.** Look at the shots. The previous session shipped none of this verified — do not repeat that.
4. Spot-check against the rules in section 5, specifically:
   - a grant card's rail shows hollow dots at `checking` and `ready-to-grant`, not green;
   - a Welcome case drawer shows the amber Only-next-step block with bullets and **no button**, and `release` / `internal` read "Held while the case is blocked";
   - a repeat grant's label reads `already-applied · 7 of 7`;
   - the Today filter row stays pinned while the stream scrolls;
   - the Sites and Extensions grids scroll horizontally below ~700px without the header drifting out of alignment;
   - every unknown is red, and no cell is blank or zero where the value is unknown.
5. Confirm no real tenant hostname, cloud ID or contact address is in any committed file: `git diff --cached | grep -iE 'atlassian\.net|@[a-z0-9-]+\.(com|net|vn|au|bg)'`.

---

## 10 · Open questions for the owner

1. **Where should this live long term?** It is at `local-crm/` beside `forge-console/`, on the current branch. It arguably belongs on `feat/lifecycle-crm` next to the backend it reads. Not decided.
2. **Real queries.** Every row is currently static. Making the console truthful needs: the four data-source queries, a real KV readback endpoint, an `ExtensionAction` audit table (absent), a persisted expiry event (absent), and migration 0025 applied before any eligibility or run-log UI can be honest.
3. **The `suppressed` column.** `remove-suppressed.md` in the design project argues it has no requirement behind it and proposes migration `0026` to replace it with `welcome_state='blocked' / block_reason='backlog'`. Unrelated to the UI, but it changes the wording of the "held as backlog" copy if it lands.
