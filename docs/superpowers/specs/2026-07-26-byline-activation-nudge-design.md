# Byline activation nudge — full context, evidence, and design

**Status (v3):** byline mechanics validated on `lite-dev` (dev deploys 16.128.0–16.132.0);
dialog UX approved 2026-07-26 — AI-generated diagram of the current page, deeplink completion.
**Sequencing assumption:** **#360 ships first** — the activation flow is its missing producer
(§6b), and it adds two cheap items to #360's release scope.
**Decision:** build this; `#334` editor-templates and the demo-page port are out (evidence below)
**Supersedes:** the 2026-07-26 v1/v2 drafts of this file

---

## 1. What this is

A `confluence:contentBylineItem` entry (**"View as diagram"**, AI-sparkle icon) that appears **only** on pages
in spaces that already use our diagrams, aimed at readers who see colleagues' diagrams but have
never created one. Its icon is a **play-once** animated GIF that draws the eye on first paint and
then rests. Clicking opens a dialog that **AI-generates a diagram of the page the user is
reading** — never a blank editor, never a tutorial — and completes via a diagram deeplink pasted
into any Confluence page (#360). Zero per-view compute by construction.

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
| **v4 (final)** | **Dialog = AI-generated diagram of the current page; completion = deeplink paste** | User proposal, 2026-07-26: the page the user is reading IS the prompt — no templates, no wizard, no language picker. UX review added release gates (§6b) and swapped completion to deeplink-primary once the user set the sequencing assumption that #360 ships first |

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
      entityPropertyExists:   # the demand signal: this team already uses diagrams
        entity: space
        propertyKey: zenuml-space-uses-diagrams
```

**Space property writer:** the existing `lite-macro-count-daily` scheduled job already does a
full per-space macro inventory daily — add one property write per qualifying space
(threshold e.g. ≥3 diagrams; exact bar is a launch-tuning knob). **Skip spaces at or near the
Lite paywall cap** — the nudge must never point at a space that would answer a first create
with an upgrade prompt. Marginal cost ≈ zero. Written via ordinary REST; verified the
condition evaluator reads it.

## 6b. The dialog — approved v2 flow (2026-07-26)

```
Reading page → "View as diagram" byline (AI sparkle, loop=1 animation)
  → ONE CLICK, no consent step → Loading ("Reading this page…" → "Drawing it as a
    diagram…", aria-live, cancellable)
  → high confidence:  "This page, as a diagram" + "Just a preview — nothing has
                       been saved. Feel free to make it yours."
     low  confidence:  honest fallback + a relevant example        ← gate 1
  → preview actions: PRIMARY "Use this diagram" (saves directly — edit is OPTIONAL, per the
    original proposal; a good draft must not be forced through the editor), SECONDARY
    "Edit diagram" (the normal editor; 92% completion backs this), plus an always-visible
    quiet steer row ("Want something different? Describe it (optional)" + Generate again)
  → Save (current space)
  → Completion screen:
      PRIMARY   "Copy diagram link"
                helper: Paste it into any Confluence page — it becomes the diagram
                + 2-second inline paste demo animation (plays once)
      SECONDARY "No page in mind? Create one with this diagram" (draft page — stall-breaker)
  → user opens any page → Edit → ⌘V → Embed macro appears (#360 autoconvert)
```

**Two release gates (both cheap, neither needs research):**

1. **Low-confidence fallback.** The byline shows on *every* page of a qualifying space —
   meeting notes and link lists included. A bad first diagram is worse than a blank page.
   Gate on the generator's `confidence` field; below threshold show an honest "this page
   doesn't describe a process — try an architecture or API page" plus a keyword-picked example.
2. **Paywall exclusion** — encoded in the space-property writer above.

**No per-interaction consent (decision 2026-07-26):** the T&C already covers page-content
processing, and an upfront "Generate?" decision defeats the zero-pressure entry — the whole
point is *look first, decide never*. Transparency is carried by the loading copy ("Reading
this page…"), which states what is happening at the moment it happens. Rovo (data stays in
Atlassian) remains an enterprise *enhancement*, not the v1 backend.

**Regeneration is one always-visible affordance.** A quiet steer row sits under the preview —
optional input + a single "Generate again" button. No reveal step (an earlier "Not quite
right?" trigger was cut: a control that only uncovers another control is ceremony), and only
one generate-labelled control exists. Same-input rerolls reproduce the miss, hence the steer.
If the user edited first, regeneration needs a discard confirm.

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
  a teacher. We own zenuml.com; one Cloudflare Pages route.

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

1. **Aide co-display.** `zenuml-byline-aiaide` is unconditional today — a new user in a
   qualifying space would see **both** chips. Either gate Aide on the inverse condition or
   accept two entries. Not yet decided.
2. **Icon asset.** AI visual language: four-point sparkle, blue→purple gradient
   (Atlassian-Intelligence-adjacent), ~19×14, play-once, calm final frame. NOTE: a gradient
   cannot fit the 255-char two-colour data-URI budget — this icon almost certainly requires a
   `permissions.external.images` entry (minor version); `resource:` icons are reported broken
   for byline.
3. **Threshold** for `zenuml-space-uses-diagrams` (≥N diagrams, freshness window) + the
   paywall-cap exclusion rule (§6).
4. **Generation backend.** v1 = own backend (`/ai-generate-title` and Diagramly AI infra are
   precedents) behind the consent gate; Rovo as enterprise enhancement later. Prompt +
   structured output schema (`diagramType`, `diagramSource`, `title`, `confidence`) owned by us.
5. **Confidence threshold + fallback examples** — needs a small eval set of real page types
   (process doc / architecture doc / meeting notes / link list).
6. **Dialog build.** `GetStarted.vue` (15 KB + stories) is the starting shell; the flow in §6b
   is the spec. Consent copy, loading skeleton, error states (timeout / quota / unparseable
   output), focus management, keyboard path.
7. **Content-level suppression (nice-to-have):** `entity: content` display conditions could
   hide the byline on pages that already contain our macros (where it is noise). Platform
   supports it; **untested** — verify like §4 before relying on it.
8. **Rollout**: #360 first (with its two added scope items, §6b) → dev → staging spaces →
   Lite-only initially (it has the gap and 91% of views).

## 9. Analytics (events precede code — project rule)

| Event | Trigger / key props |
|---|---|
| `activation_nudge_shown` | dialog resource first paint (byline render itself is not observable to us without cost) |
| `activation_nudge_clicked` | byline clicked → dialog opened |
| `activation_generation_succeeded` / `_failed` | props: `diagram_type`, `confidence`, `duration_ms`, failure reason |
| `activation_low_confidence_fallback` | gate 1 fired instead of a generated diagram |
| `activation_diagram_edited` | user modified the generated draft before save |
| `activation_completed` | props: `path: copy_link \| draft_page` |
| `activation_nudge_dismissed` | dialog closed without creating |
| `macro_create_succeeded` (existing) | the activation event |
| `embed_autoconvert_*` (existing, #360) | closes the loop: link minted here → pasted there |

**Success metric:** shown → clicked → generation ok → save → completed, segmented by space and
by `confidence`. **Baseline to move: viewer→try = 12.9% (Lite, 90d).** Even +1 pt ≈ ~180 new
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
