# Byline activation nudge — full context, evidence, and design

**Status (v5):** byline mechanics validated on `lite-dev` (dev deploys 16.128.0–16.132.0);
dialog UX approved 2026-07-26 — **pre-generated, human-curated** diagram of the current page
served from cache, deeplink completion. The `entity: content` gate — v5's
critical dependency — is now **verified both directions** (§4).
**Sequencing assumption:** **#360 ships first** — the activation flow is its missing producer
(§6b), and it adds two cheap items to #360's release scope.
**Decision:** build this; `#334` editor-templates and the demo-page port are out (evidence below)
**Supersedes:** the 2026-07-26 v1/v2 drafts of this file

---

## 1. What this is

A `confluence:contentBylineItem` entry (**"View as diagram"**, AI-sparkle icon) that appears **only** on pages
in spaces that already use our diagrams, aimed at readers who see colleagues' diagrams but have
never created one. Its icon is a **play-once** animated GIF that draws the eye on first paint and
then rests. Clicking opens a dialog that reveals **a pre-generated, human-reviewed diagram of the page
the user is reading** — never a blank editor, never a tutorial, never unreviewed AI output —
and completes via a diagram deeplink pasted into any Confluence page (#360). The byline only
exists on pages where a curated diagram is ready. Zero per-view compute by construction.

Philosophy (kept verbatim from the originating proposal): *the AI is not replacing the editor;
it is removing the blank page.* Don't teach — demonstrate. Never ask the user to choose a
diagram language (72% use mermaid; the type is an implementation detail the AI selects).

## 2. How the idea evolved (three pivots, all user-driven)

| Iteration | Shape | Why it changed |
|---|---|---|
| v0 | Special pasted link shows a guide animation | Never-users don't *have* the link — it needs a champion to seed it. Payload also wrong: a "guide" converts worse than an editable diagram (viewer create-CTA already proven dead) |
| v1 | Byline dialog for users who never created a macro | Reaches every page view with zero seeding — but per-user animation control forces `dynamicProperties` = a Forge function on **every content view** (cost, §5) |
| v2 | Animated icon, click to cancel, per-user | `entity: user` display condition doesn't work (§6); and `loop=1` GIF makes "click to cancel" unnecessary — the icon quiets itself |
| v3 | Two conditional byline items gated by a space-level property | User: "never created" is far too broad — most Confluence readers never need a diagram and the nudge would never stop for them. The demand signal is the **space** (the team already uses diagrams), not the individual |
| v4 | Dialog = AI-generated diagram of the current page; completion = deeplink paste | User proposal, 2026-07-26: the page the user is reading IS the prompt — no templates, no wizard, no language picker. UX review added release gates (§6b) and swapped completion to deeplink-primary once the user set the sequencing assumption that #360 ships first |
| **v5 (final)** | **Pre-generated & curated: the backend prepares diagrams offline for selected diagram-less pages in high-density spaces; runtime serves the reviewed result from cache behind theatrical loading. No regenerate — dissatisfaction routes to Edit** | User, 2026-07-26: the aha moment cannot tolerate generation variance — bet on curated quality. Also collapses the low-confidence gate entirely: unsuitable pages simply never get a byline |

## 3. Why byline won the activation bake-off

Every alternative was measured and lost:

| Candidate | Verdict | Evidence |
|---|---|---|
| Demo page (port to Lite) | Out | Genuinely never ran — only **4** real demo-page diagrams exist in D1 (the "1,646" were default-template titles). Its target (installs with zero inserts) is unmeasured and cold |
| Editor templates (#334) | **Out — both markets measured tiny** | Settled unedited defaults ≈ **1–2%** of content (the earlier "49%" was a filter artifact — see the `query-forensics` skill); editor completion is already **92%** (2,286 started → 2,099 succeeded, Lite 90d) |
| Deeplink autoconvert (#360) as activation | Frozen | Receiver-only (no link producer exists, domain unresolved); cross-space reuse demand unproven either way |
| **Byline nudge** | **Build** | Only option with a measured, large, warm audience at zero run cost |

**The audience (Mixpanel, 90d, unique users):**

| | Lite | Full |
|---|---:|---:|
| Viewed a macro | **17,780** | 2,139 |
| Tried to create | 2,286 | 293 |
| Succeeded | 2,099 | 267 |
| Viewer → try rate | **12.9%** | 13.7% |

Honest framing: 12.9% is **not a crisis** (healthy versus 90-9-1 participation norms).
This is a **zero-cost growth lever on a warm audience**: ~15,500 Lite viewers per quarter
sit in diagram-using spaces (byline's gate, by construction) and have never pressed create.
Every convert feeds the Lite→Full paywall funnel. Lite carries 91% of all macro views and,
since the demo-page pipeline is stripped from it, has **no activation mechanism at all**.

## 4. Verified platform facts (all tested live on lite-dev, 2026-07-26)

| Fact | How verified |
|---|---|
| Animated GIF **animates** in the byline | 2-frame red/blue GIF deployed (16.128.0); screenshots 600 ms apart show centre pixel flip |
| **`loop=1` is honoured** — plays once, parks on final frame | Frames at t=0/3/6 s identical after first pass. Make the *last* frame the calm one |
| `icon` accepts `data:` URI but is capped at **255 chars** | 358-char URI → hard lint error; 16×16 two-colour GIF fits (234 chars) |
| Icon renders ≈ **19×14**, not square | Element screenshot measurement — draw assets for that ratio |
| `displayConditions` are enforced on `contentBylineItem` | With no properties set, both gated items disappeared from the byline |
| `entityPropertyExists` + `entity: space` works | Space property written via ordinary REST (`/rest/api/space/SD/property/...`) → item appeared on next load |
| **`entity: content` condition works — BOTH directions** | 16.133.0 probe: property `zenuml-prepared-diagram` stamped via v2 REST (`/api/v2/pages/{id}/properties`) → byline appeared on that page only (control page: hidden, unconditional Aide visible on both); property deleted (HTTP 204) → byline disappeared |
| Sibling conditions = implicit AND; `and:` array form **rejected** | Lint: "property must be object" for the array form; sibling form passes and deploys |
| Two byline items coexist, independently gated | Deployed both (16.130.0–16.131.0); each obeyed its own condition |
| **`entity: user` condition does NOT work** (as written) | User property written for the *viewing* user via REST, reads back HTTP 200, both gated items ignore it. Docs are silent on whose user it is and whether the app must write it (asApp) — untested, dropped as marginal |
| `dynamicProperties` exists: per-user `title`/`icon`/`tooltip`, re-invoked after dialog close | Docs (payload carries `principal.accountId`); community reports `resource:` icons break there — use `data:` URI |
| Scopes `read/write:user.property:confluence` already granted | `manifest.yml` lines 105/135 — shipping this is a **minor** version, no admin re-consent |
| Existing `zenuml-byline-aiaide` ships in Lite/Full/Diagramly | Rendered on lite-dev ("Aide Lite (Development)"); the manifest comment claiming Diagramly-only is **wrong** |

## 5. The cost wall (why no per-user variant, why no KV)

`dynamicProperties` = one Forge function invocation per **content view** (not per macro view).
Measured base (D1 `DailyBehaviorCounter`, 2026-04, last full month of page-view telemetry):
**4,152,322 views/month across 850 tenants**. Against the 100,000 GB-s/month free tier @512 MB:

| Assumed duration | GB-s/month | vs free tier |
|---|---:|---:|
| 100 ms | 207,500 | 2.1× |
| 200 ms | 415,000 | 4.2× |
| 300 ms | 622,500 | 6.2× |

Invocations are measured; duration/memory are assumptions — but even the optimistic case
busts the tier, and this exact shape was already an incident once
(`remote-page-behavior-trigger` ≈ 98% of all GB-s, disabled in PR #234).

**Cloudflare KV does not help**: the cost is the *invocation*, not the storage, and the
condition evaluator can only read **Confluence entity properties** anyway.
`displayConditions` are evaluated by Confluence server-side; with no `dynamicProperties`
declared there is **no function to invoke — per-view cost is zero by construction**.
`loop=1` is the other half: "stop animating after engagement" needs no per-user state
because the icon stops itself.

## 6. The design

```yaml
confluence:contentBylineItem:
  # existing item — decide co-display policy (§8.1)
  - key: zenuml-byline-aiaide
    ...
  - key: zenuml-byline-newuser
    resource: main            # dialog route: activation flow (§6b)
    title: View as diagram    # zero-pressure invitation to LOOK, not a task; brand names mean nothing to a first-timer
    icon: <AI-language sparkle, blue→purple gradient, play-once, ~19×14, calm final frame>
    tooltip: See a diagram drawn from this page
    viewportSize: fullscreen
    displayConditions:
      entityPropertyExists:   # gate: a curated diagram EXISTS for this page
        entity: content       # ✅ VERIFIED 2026-07-26 both directions (§4)
        propertyKey: zenuml-prepared-diagram
```

(The space-gate fallback documented in earlier drafts is no longer needed — the content
gate verified cleanly.)

**Preparation pipeline (offline):** piggybacks on `lite-macro-count-daily`, which already
inventories every space daily. Selection: high-density spaces → pages with no diagrams →
diagrammable score. Excluded at selection: spaces at/near the Lite paywall cap (the nudge must
never point where a first create answers with an upgrade prompt). Approved diagrams stamp the
page's content property and land in our backend cache keyed by pageId; the dialog fetches
that cache behind ~2 s of loading theatre.

## 6b. The dialog — approved v2 flow (2026-07-26)

```
OFFLINE (batch pipeline, runs beside lite-macro-count-daily):
  high-density spaces → pages with NO diagrams, scored diagrammable
  → AI pre-generates → HUMAN/CURATED REVIEW → approved:
      content property stamped on the page + result cached in our backend
  (paywall-capped spaces excluded at selection time)

RUNTIME:
  Reading a PREPARED page → "View as diagram" byline (AI sparkle, loop=1;
    gated by the content property, so unsuitable pages never show it)
  → ONE CLICK, no consent step → Loading ("Reading this page…" → "Drawing it as a
    diagram…", aria-live, cancellable) — a REAL backend call answered from cache;
    ~2 s of theatre that communicates "drawn from your page"
  → "This page, as a diagram" + "Just a preview — nothing has been saved."
    Curated quality: no low-confidence path exists at runtime.
  → preview actions: PRIMARY "Use this diagram" (saves directly — edit is OPTIONAL),
    SECONDARY "Edit diagram" (the normal editor; 92% completion backs this)
  → Save (current space)
  → Completion screen:
      PRIMARY   "Copy diagram link"
                helper: Paste it into any Confluence page — it becomes the diagram
                + 2-second inline paste demo animation (plays once)
      SECONDARY "No page in mind? Create one with this diagram" (draft page — stall-breaker)
  → user opens any page → Edit → ⌘V → Embed macro appears (#360 autoconvert)
```

**Release gates:**

1. **Curation replaces the low-confidence gate.** Quality is enforced at *targeting time*
   (only reviewed diagrams ever get a byline), not at runtime. A bad first diagram is worse
   than a blank page — so no unreviewed output is ever shown. Start with manual review at
   pilot scale; automate judging only after the approval-rate data says it is safe.
2. **Paywall exclusion** — encoded in the pipeline's page-selection step.

**No per-interaction consent (decision 2026-07-26):** the T&C already covers page-content
processing, and an upfront "Generate?" decision defeats the zero-pressure entry — the whole
point is *look first, decide never*. Transparency is carried by the loading copy ("Reading
this page…"), which states what is happening at the moment it happens. Rovo (data stays in
Atlassian) remains an enterprise *enhancement*, not the v1 backend.

**No regenerate (decision 2026-07-26).** We bet the curated result is good enough;
dissatisfaction routes to Edit, which is also the deeper engagement we actually want. This
removed the steer row and, with it, the last piece of runtime generation UX. (Two earlier
iterations — a "Not quite right?" reveal trigger, then an always-visible steer row — were
each cut within a day; the lesson stands: every optional affordance on the preview screen
taxed the happy path.)

**Why deeplink completion is primary (given #360 ships first):** the activation flow is
#360's missing *producer* — every activated user mints a link and learns the paste workflow,
bootstrapping the diagram-as-asset model. The paste friction is paid down by the inline demo
animation, and the draft-page secondary catches the "which page?" stall.

**What this adds to #360's release scope (both cheap, both mandatory):**

- **Copy as `text/plain` ONLY** — a `text/html` flavour gets eaten by Confluence's paste
  handling before autoconvert can match (verified during #360 testing).
- **Stand up an instruction page at `confluence.zenuml.com/d/*`** — activation puts these URLs
  in novices' hands; they *will* click them and paste them into Slack. A static page saying
  "paste this link into any Confluence page to embed the diagram" turns the dead domain into
  a teacher. **BUILT 2026-07-26 (PR #399, grill decisions):** standalone minimal Worker
  `workers/confluence-deeplink/` (not a Pages route — zero coupling to the backend projects);
  OG meta tags own the Slack unfurl (unauthenticated crawler → can never leak diagram content);
  no request logging / observability off / `noindex` because `/d/*` paths identify customer
  sites (client-privacy policy); root 302→zenuml.com. **Release gate is mechanical, not
  procedural:** anything merged to `main` rides the next release train unconditionally, so
  #360 sits in **draft** until the Worker is deployed and `curl` verifies 200 + OG tags on
  the real domain. The prod deploy creates the `confluence` DNS record (custom_domain=true) —
  a cloud change requiring explicit approval.
  Settled in the same grill: the **bare path is plain identifiers, not a capability token**
  (cloudId + contentId; possession grants nothing — Confluence auth gates rendering), and the
  path has **no TTL by design** (the pasted link IS the macro's stored config; expiry would
  rot pages). Gate cleared 2026-07-26: Worker live on the real domain, #360 un-drafted.
  Known issue accepted: lite + full co-installed on one tenant register the same matcher
  pattern; cross-app winner untested, custom content is app-namespaced so a wrong-app match
  fail-softs into the orphan path. Low probability; revisit only on real-world signal.

**Ticketed preview — Worker v2 design (settled 2026-07-26, ships WITH the mint side, i.e.
the activation completion screen; #360 unaffected):** the Slack unfurl card is only useful
to a receiver if it shows the diagram itself, but serving content unauthenticated forever
would turn the link into a permanent capability. Resolution — *the address is permanent,
the capability is momentary*:

- Link shape gains an optional ticket: `/d/<cloudId>/<contentId>?t=<128-bit-random>`.
  `DEEPLINK_RE` and the autoConvert matcher already tolerate query params (verified) —
  pasting into Confluence is path-based and never expires.
- **Mint** (completion-screen "Copy for Confluence", Forge-token-authed backend call): the
  minter is looking at the diagram with read permission — client uploads the current PNG
  render; backend writes KV `img:<token>` (PNG, **expirationTtl = 600s — physical deletion,
  not signature logic**) and `ticket:<token>` (site domain + pageId, tiny, no TTL).
- **Fresh ticket (<10 min)** → preview page: the PNG + "Open in Confluence" button;
  `og:image` serves the PNG → the Slack unfurl card IS the diagram. Slack's image proxy
  caches it, so the message keeps displaying the image after our source expires — the
  capability window collapses to the moment of sharing (crawler fetches within seconds).
  Honest caveat: Slack's cache is observed behavior, not contract; a rare eviction+refetch
  breaks the image in old messages.
- **Expired image, live ticket** → "preview expired" page + the permanent Open-in-Confluence
  button (target from the ticket, NOT resolved from cloudId — no public reverse-resolver;
  only deliberately-shared links redirect, same trust model as a native Confluence share URL
  which exposes the hostname in the link itself). Copy addresses the receiver: "open it in
  Confluence, or ask for a freshly copied link" (receivers can't regenerate).
- **No ticket** → the v1 instruction page.
- Do NOT burn expiry text into the PNG: the image already delivered to Slack never
  disappears (their cache), so "expires soon" on the image would be false. The expiry note
  lives in `og:description` and the expired page.
- 10-minute TTL is deliberate (user decision): links are for instant sharing; a paste
  delayed past the window degrades to the generic card and the page explains regeneration.

**Technical notes settled by review:** cross-space paste within a tenant works (viewer checks
cloudId only; fetch runs as the viewing user, who has read on the source space by construction);
the saved diagram is custom content in the current space, referenced by every pasted Embed —
born as a *citable asset*, which quietly bootstraps the A-group model; cross-tenant paste
fail-softs (verified) and the instruction page explains the rest.

## 7. Rejected on evidence (do not relitigate without new data)

1. **Per-user animation via `dynamicProperties`** — cost wall (§5).
2. **`entity: user` suppression condition** — evaluator can't see REST-written user
   properties (§4); only worth revisiting via an asApp write if suppression proves necessary.
3. **Cloudflare KV as the flag store** — unreachable by the evaluator (§5).
4. **"User never created" as the gate** — targets people with no need; nudge never stops for them.
5. **Demo-page port / editor templates** — §3.
6. **Infinite-loop animation** — needless; `loop=1` verified.

## 8. Open items (the actual remaining work)

**RUNTIME SLICE BUILT 2026-07-26** — branch `feat/byline-activation-nudge` (commits
7801b39b / e104da21 / 3758dd7e; ultracode: recon → parallel impl → 10-finding adversarial
review, all fixed; 1958 unit tests green, vue-tsc clean). Built: manifest byline module +
displayConditions gate + per-variant strip (yq-verified ship-matrix: lite/full ship only
`newuser`, asyncapi neither, diagramly both); backend `functions/activation-prepared.ts` +
D1 `PreparedDiagram` + routes/middleware; `BylineActivationDialog.vue` (prepared + has-content
modes) + moduleKey routing + the `Sequence.vue` `readOnly` seam that stops the silent-save
defect; `ActivationPrepared` service; gated e2e + reusable property seed/remove helpers.

Remaining:

1. ~~`entity: content` display condition~~ — **VERIFIED 2026-07-26** (§4). ~~Dialog build~~ /
   ~~icon~~ — **BUILT** (item 6 below; a static `resource:` PNG works — the "resource icons
   broken for byline" claim was wrong, the sibling Aide uses one; animated play-once GIF is
   polish, not a blocker).
2. **Preparation pipeline (the main remaining backend).** Page selection scorer, generation
   backend, cache store, content-property stamping. The runtime READ side is done — this is
   the WRITE side. `POST /activation-prepared` and the property-stamp REST call are the
   interfaces it must hit; the pilot hand-seeds both (helper shipped).
3. **Curation workflow.** Manual review first; track approval rate.
4. **Aide co-display — RESOLVED in code:** the strip drops `zenuml-byline-aiaide` from
   lite/full entirely, so only `newuser` ships there — no double chip. Diagramly keeps both
   (Aide is its feature); `newuser` there is property-gated and harmless.
5. **Draft-page secondary — DEFERRED (needs a live spike).** Recon: autoConvert on
   API-created page content is unverified, and hand-authoring the ADF extension node has no
   in-repo precedent. v1 completion ships copy-link only; the "Create a page" secondary waits
   on a spike.
6. ~~**Dialog build.**~~ **BUILT** as `BylineActivationDialog.vue` (not from GetStarted — its
   own state machine: loading theatre → preview/list → completion; error/cache-miss/
   capture-miss/mint-fail all degrade gracefully).
   - **"Edit diagram" nested-modal — needs a live probe.** `openModal` from inside a
     `viewportContainer:modal` byline is untested (recon open question); the code path exists
     and is flagged inline. Probe on lite-dev before relying on it.
   - **Graph/OpenAPI preview — guarded off for v1.** DiagramPortal renders only sequence/
     mermaid/plantuml; a curated graph payload routes to a graceful miss. Pipeline must target
     the renderable types until a graph viewer is added to the preview.
7. **Rollout**: #360 first (draft-gated on the deeplink Worker, already live) → verify the
   byline on lite-dev (deploy this branch + seed a property; e2e ready) → hand-curate a pilot
   batch → measure vs the 12.9% baseline → scale curation.

## 9. Analytics (events precede code — project rule)

| Event | Trigger / key props |
|---|---|
| `activation_nudge_shown` | dialog resource first paint (byline render itself is not observable to us without cost) |
| `activation_nudge_clicked` | byline clicked → dialog opened |
| `activation_served` | curated diagram delivered from cache; props: `diagram_type`, `prepared_age_days` |
| `activation_cache_miss` | should be ~impossible by construction — any volume here is a pipeline bug |
| `activation_diagram_edited` | user modified the generated draft before save |
| `activation_completed` | props: `path: copy_link \| draft_page` |
| `activation_nudge_dismissed` | dialog closed without creating |
| `macro_create_succeeded` (existing) | the activation event |
| `embed_autoconvert_*` (existing, #360) | closes the loop: link minted here → pasted there |

**Success metric:** shown → clicked → served → save → completed, segmented by space.
**Pipeline metrics (offline):** pages selected, generation yield, **curation approval rate**
(the number that decides whether review can ever be automated). **Baseline to move: viewer→try = 12.9% (Lite, 90d).** Even +1 pt ≈ ~180 new
creators/quarter. Register names in `src/utils/analytics/catalog.ts` + `types.ts` as the
first commit.

## 10. Related artifacts

- `query-forensics` skill — why every earlier "% abandoned" number was wrong, and the
  D1 schema traps (dual code fields, appId mixed semantics) hit while producing the
  evidence in §3.
- Experiment deploys: dev env versions 16.128.0 (GIF anim), 16.130.0 (two conditional
  bylines), 16.131.0 (implicit-AND composed condition), 16.132.0 (restored clean).
- Funnel query: Mixpanel project 3373228, insights `e5804544` (90d, unique users).
- PR #234 — the prior per-page-view cost incident this design must never repeat.
