# User Onboarding Strategy — closing the install→discovery gap

**Date:** 2026-07-16
**Status:** Proposal for discussion
**Problem:** Most tenants install the app (admin-driven), but the site's end users never learn it exists. Installation ≠ activation. We need in-product distribution: the app must introduce itself to end users after the admin installs it.

## Framing

This is a B2B2C discovery funnel per tenant:

```
Install (admin) → 1st user discovers → 1st macro created → diagram seen by colleagues → more creators
```

Today the funnel leaks at step 2: the only built-in discovery surface is the macro browser / slash menu, which only works if a user already searches for "diagram". Everything below is about adding discovery surfaces, ranked by leverage and grounded in infrastructure we already have.

## What we already have (assets to build on)

| Asset | State | Relevance |
|---|---|---|
| Demo-page pipeline (`createDemoPage` resolver, enrollment KV, hourly `scheduledTrigger`, `diagramly-demo-page` page property, `is_demo_page` analytics enrichment) | Shipped, diagramly-only, operator-triggered | The core onboarding artifact already exists; it just isn't wired to installs and isn't in lite/full builds |
| Single `pageBanner` host with central priority (`decidePageBanner`: paywall > csat > none) | Shipped | An `onboarding` choice can slot in at lowest priority with zero new modules |
| Get Started page (`zenuml-get-started-settings`, `useAsGetStarted: true`) | Shipped (ZenUML variants) | The one surface Confluence shows the **admin** post-install — currently a static feature tour with no "tell your team" action |
| Advocacy-copy pattern (`advocacy_message_copied`, "Copy admin message" in paywall UI) | Shipped | Same mechanic, opposite direction: paywall asks users to nag admins; onboarding asks admins to announce to users |
| `pageCaptureFn` on `avi:confluence:updated:page` | Shipped | Content-intent detection (e.g. Mermaid/PlantUML code fences in pages) can piggyback on this existing trigger — **no** new page-view trigger |
| Install trigger `avi:forge:installed:app` → `/forge-installed` | Shipped | The hook point for install-time onboarding automation |

## Channels, ranked

### 1. The rendered diagram itself (highest leverage, lowest cost)

Every rendered macro is already in front of the exact audience we want: colleagues of the creator. Today a viewer sees a diagram with no hint of what made it or that they could make one too.

**Proposal:** a small, unobtrusive attribution affordance on the viewer surface — e.g. a hover-only footer or an entry in the existing viewer toolbar / fullscreen modal: *"Made with ZenUML — create your own"* → opens a short how-to (insert via `/` menu). Show only to users who have never created a macro (localStorage flag, same cheap-predicate pattern as `decidePageBanner`); permanently dismissible; suppressed on paid Full tenants if we judge it off-brand there.

Why first: zero new manifest modules, no consent implications, reaches every viewer of every diagram, and it compounds — each new creator produces more diagrams that recruit more creators.

### 2. Demo page, generalized (the artifact) + onboarding banner (the discovery)

The 2026-05-18 spike spec's own conclusion still holds: *"the page is the artifact, the banner is how anyone finds it."*

- **2a.** Extend the demo-page pipeline from diagramly to lite/full (un-strip the modules for those variants; content per variant). Keep it operator/admin-triggered initially.
- **2b.** Add an `onboarding` choice to `decidePageBanner`, priority **below** paywall and CSAT: shown to users who have never created a macro, links to the tenant's demo page (or a 30-second insert walkthrough if no demo page exists). Hard rules: cheap localStorage-only predicate on the hot path, dismiss = permanent, capped impressions (e.g. max 3, ≥7 days apart), suppressed entirely once the tenant has ≥N distinct creators.
- **2c.** Only after 2a+2b are proven: wire `avi:forge:installed:app` to auto-create the demo page for new installs (behind a kill switch, honoring the existing opt-out marker semantics). Per the spike spec, auto-creation without the banner produces an artifact nobody finds — ship them as a pair.

### 3. Admin as distribution channel (Get Started revamp)

Post-install, the admin is the only human we can reliably reach — Confluence surfaces our Get Started page to them. Make announcing a one-click job:

- **"Announce to your team" kit:** a copy-ready announcement message (Slack/Teams/email flavored) — reusing the advocacy-copy mechanic — plus a one-click **"Create a demo page in a space"** button (the existing admin resolver, exposed here for all variants).
- Reframe the page from feature tour to checklist: ① create the demo page ② copy the announcement ③ insert your first diagram.

### 4. Content-intent detection ("we read your content")

`pageCaptureFn` already sees page bodies on update. Detect Mermaid/PlantUML fenced code blocks stored as plain code:

- **Phase A (analytics only):** count tenants/pages with diagram-as-code blocks not using our macros → sizes the opportunity, no UX risk.
- **Phase B (suggestion):** for high-signal tenants, a targeted nudge (banner variant or byline item): *"This page has Mermaid code — render it as a live diagram."* This is the space-tailored value proposition the diagramly CONTEXT called for, at much lower cost than AI-generated demo content.

### 5. Editor-intent surfaces (cheap hygiene)

- Audit macro-browser metadata: titles, descriptions, icons, and search keywords ("flowchart", "UML", "sequence", "architecture", "ERD", "swagger", "wireframe"…). Users search by task, not by brand.
- Later, evaluate a `confluence:contextMenu` module (select text → "generate a diagram from this") — verify module availability and version impact before committing.

## Measure first (per the analytics-first hard rule)

Before any build, define the tenant activation funnel and baseline it:

- **North-star:** distinct macro creators per tenant per month (breadth, not volume).
- **Activation rate:** % of new installs with ≥1 `create_macro` within 14 days; time-to-first-create.
- **Dormancy segmentation:** installs (Forge platform list) with no creation signal. Caveat from ops experience: absence of Mixpanel `macro_viewed` is *not* proof of zero usage (client-side blocking); classify dormancy with server-side signals too.
- **New events (register in `catalog.ts`/`types.ts` as the first commit of each feature):**
  - `onboarding_banner_shown` / `_dismissed` / `_cta_clicked` (surface=page_banner)
  - `viewer_attribution_shown` / `_clicked` (surface=viewer)
  - `announce_kit_copied` (surface=get_started, channel property)
  - `demo_page_created` (source=manual|install_trigger) — `is_demo_page` enrichment already exists for downstream engagement
  - `codefence_opportunity_detected` (server-side, phase A of channel 4)
- Success criterion for every surface: it must move activation rate or creators-per-tenant, not just impressions.

## Sequencing

1. **Phase 0 — instrument:** funnel dashboard + baseline; dormant-tenant list. (No product risk; enables every later go/no-go.)
2. **Phase 1 — admin-side, cheap:** Get Started revamp + announce kit; demo-page pipeline enabled for lite/full (manual trigger).
3. **Phase 2 — end-user surfaces:** viewer attribution CTA; onboarding banner (paired with demo page).
4. **Phase 3 — automated & intelligent:** install-triggered demo page behind kill switch; code-fence detection (analytics → suggestion).

## Risks & guardrails

- **Banner fatigue / brand damage:** tenant-wide surfaces can annoy paying customers. Guardrails: strict caps, permanent dismiss, suppress on activated tenants, consider suppressing promotional surfaces on Full.
- **Forge Functions cost:** never reintroduce `avi:confluence:viewed:page`-class triggers (the 2026-06 incident: ~98% of billed GB-seconds). All new end-user logic must be client-side with localStorage-cheap predicates, or piggyback on existing triggers.
- **Versioning:** adding/changing modules and egress stays a **minor** version for our Connect-migrated apps (auto-upgrade); adding **scopes** is major. Design all onboarding features to require no new scopes.
- **Privacy:** content detection stays within the existing `pageCaptureFn` policy surface; no client-identifying data in public repo artifacts.
- **Demo-page quality:** "a bad demo is worse than no demo" — auto-creation ships only after manual-mode content is validated per variant.
