# Customer Recovery Workflow — Phase 1 Discovery

Internal, repo-owned workflow to find customers who **previously paid, stopped
paying, still have access, and still show product usage**, then prepare
**Gmail drafts** (never auto-send) for manual review, track follow-up state,
detect replies, and recommend next actions.

This document is the **Phase 1 discovery deliverable**. It maps what data
already exists in this codebase, what is missing, the recommended
implementation path, and the risks/assumptions that change the rest of the
plan. No production access logic was modified to produce it.

> **Scope note (read first):** the runtime code and its data store handle
> client-sensitive material (contact emails, draft bodies that name real
> customers, per-tenant recovery notes). Per
> [`docs/policies/client-privacy.md`](../../docs/policies/client-privacy.md),
> that material **must not** live in the public repo. This README is a design
> doc with placeholders only, so it is fine here. **The code + `data/` for
> Phases 2–14 must live in the `private/` submodule** (`ZenUml/conf-app-private`).
> See [Placement decision](#0-placement-decision-blocks-phases-214).

---

## 0. Placement decision (blocks Phases 2–14)

The plan's suggested location is `tools/customer-recovery/` in the public repo.
That is safe for *this README* but **not** for the code/data, because:

- `recoveryStateStore.ts` persists `data/recovery-cases.json`, which contains
  `contactEmail`, `accountName`, per-customer notes, and reply summaries —
  all real client data.
- `emailGenerator.ts` / `gmailDrafts.ts` produce draft bodies that name real
  customers.

The client-privacy hard rule (`CLAUDE.md` → "Client privacy — no client names
in public files") forbids committing any of that to the public repo, and git
history makes a leak irreversible.

**Recommendation:** put the workflow under the private submodule, mirroring the
plan's structure, e.g. `private/tools/customer-recovery/` (the private project
already ships a TypeScript toolchain — `private/package.json`, `tsconfig.json`,
`vitest.config.ts`). Keep only this README (placeholder design doc) in the
public repo as a pointer.

This is the one decision that reshapes every later phase, so it is the open
question to settle before Phase 2.

---

## 1. Available data sources

### 1a. Two distinct billing layers (this is the crux)

There are **two unrelated notions of "paid"** in this product. The recovery
tool's `billingStatus` must be sourced from layer A; layer B is a narrower
secondary signal.

| | **Layer A — Marketplace app subscription** | **Layer B — Space licenses (Stripe)** |
|---|---|---|
| What it is | The Atlassian Marketplace subscription for the whole install (the real "paying customer") | A Lite-only "buy this one space" purchase |
| Source of truth | Atlassian **Marketplace Reporting API**, vendor `1215266` | Cloudflare KV `SPACE_LICENSE_KV` (`license:<cloudId>:<spaceKey>`) |
| Called from app runtime? | **No** — fetched externally (vendor portal / CLI) | Yes — `functions/api/space-license.ts`, `functions/api/space-status.ts` |
| Auth | Basic auth `FORGE_EMAIL:FORGE_API_TOKEN` (from `.env.forge.local`), **or** a logged-in `marketplace.atlassian.com` vendor session (the `weekly-meeting` skill uses session cookies via Playwright) | `ADMIN_API_SECRET` bearer (`functions/api/space-license.ts:34,196`) |
| "Stopped paying" means | License transitioned paid-tier → `cancelled` / **Legacy Free** (lapsed) | Record `expiresAt < now` or `status: 'inactive'` |
| Created/updated by | Atlassian billing | Stripe webhook `functions/api/stripe-webhook.ts` (`checkout.session.completed`, sets `expiresAt = now + 365d`, `paymentReference = session.id`) |

**For "previously paid, stopped paying", Layer A is the primary source.**
"Legacy Free" is the canonical lapsed/non-paying status (see
`reference_legacy_free_license` memory; `private/src/data/full-app-non-payers.json`
is a materialized non-payers list).

### 1b. Pre-materialized client profiles (the highest-leverage source)

`private/client-profiles/data/<tenant>.json` — **19 profiles today**, refreshed
by private tooling. Each profile is ~90% of the plan's `RecoveryCandidate`
already assembled. Schema (keys):

```
domain, hostname, generatedAt
identity   { displayName, company, country, sector, verified, industry, contact, ... }
licenseStatus, appVariant, isLite
forgeInstallation { found, firstInstall, note }
kv         { totalMacros, spacesWithMacros, spacesOver100, activeSpaces, ... }
mixpanel   { macroViewedTotal, macroViewed90d, macroViewed30d, by_macro_type,
             firstSeenDate, lastSeenDate, peakDay, projectId, dailySeries }
d1         { analyticsEventFact, note }
license    { source, licenseType, licenseLabel, paying, seats, tier, addonKey, status, records }
arr        { potentialUsd, tierBand, currentUsd }
```

Mapping to the plan's model:

| Plan field | Profile field |
|---|---|
| `accountName` / company | `identity.company` / `identity.displayName` |
| `contactEmail` | `identity.contact` |
| `domain` | `domain` / `hostname` |
| `billingStatus` | derive from `license.paying` + `license.licenseLabel` (e.g. "Legacy Free") |
| `lastPaidAt` | not directly present → from Marketplace license `records` |
| `usage.lastSeenAt` | `mixpanel.lastSeenDate` |
| `usage.diagramViews30d` | `mixpanel.macroViewed30d` |
| `usage.activeUsers30d` | `d1.analyticsEventFact` (distinct users) |
| `appVariant` (lite/full/diagramly) | `appVariant` / `isLite` |

So the cleanest v1 treats these profiles as the **normalized candidate source**,
with the live integrations below as the refresh mechanism behind them.

### 1c. Usage signals (live, queryable today)

- **Mixpanel** project `3373228`. Events: `macro_viewed` (views; old name
  `view_macro`), `macro_create_succeeded` + `macro_save_succeeded` (edits).
  Tenant key = `client_domain` (**bare subdomain, no `.atlassian.net`**).
  Tracking began ~2026-04-18. Query via
  `.claude/skills/mixpanel/scripts/mp_query.py` (auth from `.env.mixpanel`), or
  the local DuckDB export workspace (`duckdb-mixpanel` skill). Exclude internal
  domains (`zenuml`, `*-stg`, `lite-dev`, `dia-stg`, `diagramly`, `whimet`).
- **Cloudflare D1** (`conf-zenuml-prod`). `AnalyticsEventFact` (clientDomain =
  **full hostname with `.atlassian.net`**) → last-seen, distinct active users,
  per-tenant 30d activity. `AtlassianInstance` maps `cloudId ↔ clientDomain`.
  ⚠️ `UserBehaviorEvent.page_viewed` is Confluence-wide, **not** macro-specific
  — do not use it as a usage proxy (`docs/analytics/reference.md`).
- **Join rule:** Mixpanel `client_domain` (bare) vs D1 `clientDomain`
  (full hostname) differ — strip `.atlassian.net` before joining.

### 1d. Access / entitlement (how "still has access" is enforced)

Evidence (`src/composables/useCustomerSuccessService.ts`,
`src/utils/paywall/*`):

- **Full / Diagramly:** no restrictions, ever (`useCustomerSuccessService.ts:148`).
- **Lite:** a **metered soft-paywall**, and only when the `CUSTOMER_SUCCESS_SERVICE`
  feature flag is enabled for the domain AND the space is unpaid AND the space
  has ≥100 macros. Even then: viewing is never gated, saves are not blocked at
  the persistence layer, and the "Continue editing (15)" counter is
  `localStorage`-keyed (resets on browser switch).

**Conclusion:** access is **soft-enforced everywhere**. A non-paying tenant
keeps working. This is exactly the recovery scenario — and it means
`accessStillEnabled` is **effectively always `true`** for this product. See
[Risks §4](#4-risks--assumptions).

### 1e. Gmail (the approval + reply boundary)

- **No Gmail code in the repo** (`grep` for gmail/googleapis/nodemailer in
  `src/`, `functions/`, `scripts/` → empty). This is correct; the boundary is
  an MCP.
- The **Gmail MCP** (`mcp__claude_ai_Gmail__*`) is available to the agent
  runtime (deferred tools). It is the intended draft-creation + thread-read
  surface. v1 reply detection and draft creation go through it; if it is
  unavailable in a given run, fall back to writing local `.md`/`.eml` drafts.

### 1f. Prior art to reuse (don't reinvent)

- `weekly-meeting` skill — already fetches 30-day Marketplace revenue and
  **new / large / lost customers**. "Lost customers" ≈ the recovery candidate
  feed. Reuse its Marketplace fetch.
- `extend-space-license` skill + `private/paywall/space-license-extension-runbook.md`
  + `scripts/grant_extension.py` — already **drafts a customer-facing reply**
  with the right non-accusatory tone. Reuse as the tone reference for
  `emailGenerator.ts` and `prompts/`.
- `private/src/data/full-app-non-payers.json`, `paywall-enrolled.json` —
  existing materialized lists.

---

## 2. Missing data / gaps

| Gap | Detail | Mitigation |
|---|---|---|
| **Contact email is not in public code** | `ForgeInstallation.installerAccountId` exists but no Atlassian API call resolves account → email. | Use `identity.contact` from private client-profiles; for the long tail, the Marketplace license report rows carry technical/billing contact details. |
| **No `lastPaidAt` field anywhere** | Neither D1 nor KV stores a "last paid" date for Layer A. | Derive from the Marketplace license `records` (status transitions). |
| **No "stopped paying" event in D1** | Payment state for Layer A lives only in the external Marketplace report; Layer B lives in KV with `expiresAt`. There is no install-time row that flips to "lapsed". | Treat the Marketplace report (or `full-app-non-payers.json`) as the lapsed-payer feed; reconcile each scan. |
| **Marketplace API is not wired into runtime** | Vendor `1215266` data is fetched manually/externally. | `billingSource.ts` shells out to the Marketplace Reporting API with `FORGE_EMAIL`/`FORGE_API_TOKEN` Basic auth (the `extend-space-license` skill shows the exact `curl`). |
| **`accessStillEnabled` is not a meaningful discriminator** | Product soft-enforces; nearly always `true`. | Hardcode `true` for Full/Diagramly; for Lite, optionally record whether the CSS flag + over-limit conditions would gate — but do not rely on it to filter candidates. |
| **No TS script runner installed** | `tsx` is not a dependency; public repo runs TS only via vite/vitest/wrangler. Existing standalone scripts are `.mjs`. | If code lands in `private/`, reuse its `vitest`/`tsconfig`; otherwise add `tsx` as a devDep or write `.mjs`. |

---

## 3. Recommended implementation path

1. **Settle placement** (§0) — recommend `private/tools/customer-recovery/`.
2. **`customerSources.ts` = read `private/client-profiles/data/*.json`** as the
   primary normalized source (19 high-value tenants today). This sidesteps the
   contact-email gap and the multi-source join for v1.
3. **`billingSource.ts`** — derive `billingStatus` from each profile's
   `license.paying` + `license.licenseLabel` ("Legacy Free" → `expired`/`cancelled`).
   Add a refresh path that calls the Marketplace Reporting API (vendor `1215266`,
   `FORGE_EMAIL`/`FORGE_API_TOKEN`) for tenants not yet profiled. Set
   `accessStillEnabled = true` (justified in §4).
4. **`usageSource.ts`** — primary read from profile `mixpanel.*` + `d1.*`;
   refresh path via `mp_query.py` (Mixpanel `3373228`) and `wrangler d1` /
   the DuckDB export. Candidate qualifies only if `mixpanel.lastSeenDate` is
   within `--days` (default 30).
5. **`recoveryStateStore.ts`** — JSON file store at
   `data/recovery-cases.json` (in private), per the plan. No DB in v1.
6. **`scan.ts`** — load profiles → filter (`billingStatus ∈ {unpaid, cancelled,
   expired}` AND recent usage) → upsert cases → Markdown report. Drafts only
   behind `--create-drafts`.
7. **`emailGenerator.ts` + `prompts/`** — reuse the `grant_extension.py` tone.
   Output `{subject, body, internalReason}`; `internalReason` stays in the case,
   never in the draft.
8. **`gmailDrafts.ts`** — create **drafts only** via the Gmail MCP; fall back to
   local draft files when the MCP is absent.
9. **`sync.ts` + `report.ts`** — thread/reply polling via the Gmail MCP;
   follow-up cadence per Phase 10; pause on reply (`needs_review`).

This ordering makes `scan` → `report` work end-to-end against real (private)
data on day one, with live refresh layered in behind the same adapter
interfaces.

---

## 4. Risks & assumptions

1. **`accessStillEnabled` is effectively always true.** The product does not
   revoke access on non-payment (soft enforcement). The plan's candidate filter
   `... && accessStillEnabled === true` is therefore nearly a no-op. Keep the
   field for model completeness, but the real discriminators are
   **billingStatus + recent usage**. (Evidence: `useCustomerSuccessService.ts:148`,
   `Persistence.ts` has no pay-gate, `continueAttempts.ts` is localStorage-only.)
2. **Privacy is a hard rule, not a preference.** Code + `data/` must be private
   (§0). The public repo gets only this design doc.
3. **Two billing layers must not be conflated** (§1a). Sourcing `billingStatus`
   from Stripe/KV (Layer B) instead of the Marketplace report (Layer A) would
   mislabel most customers, since KV only covers Lite per-space buyers.
4. **Profiles are a curated subset (19), not the full lapsed-payer universe.**
   v1 runs against them; full coverage requires the Marketplace report refresh
   path. The scan must `log()` that it only covered profiled tenants until the
   refresh path lands — no silent truncation.
5. **Two `clientDomain` formats** (Mixpanel bare vs D1 full hostname) — a join
   bug here silently zeroes usage. Normalize explicitly.
6. **Mixpanel history starts ~2026-04-18.** 30d windows are fine now; longer
   look-backs hit the empty pre-tracking region.
7. **Credentials are gated.** Marketplace (`FORGE_*`), Mixpanel (`.env.mixpanel`),
   and `ADMIN_API_SECRET` are real secrets — adapters read them from env, never
   hardcode, and live refreshes need an explicit go-ahead per deploy discipline.

---

## Data-source quick map

| Need | Source | Access |
|---|---|---|
| Candidate list (curated) | `private/client-profiles/data/*.json` | file read |
| Candidate list (full lapsed) | Marketplace Reporting API, vendor `1215266` / `full-app-non-payers.json` | `FORGE_EMAIL:FORGE_API_TOKEN` Basic auth |
| Billing status (Layer A) | profile `license.*` / Marketplace report | file / API |
| Billing status (Layer B) | `SPACE_LICENSE_KV`, `/api/space-status` | `ADMIN_API_SECRET` |
| Last seen / views | profile `mixpanel.*`; Mixpanel `3373228` | file / `mp_query.py` |
| Active users 30d | profile `d1.*`; D1 `AnalyticsEventFact` | file / `wrangler d1` |
| Contact email | profile `identity.contact` | file (private) |
| cloudId ↔ domain | D1 `AtlassianInstance` | `wrangler d1` |
| Draft creation / reply detection | Gmail MCP (`mcp__claude_ai_Gmail__*`) | MCP, drafts only |
| Tone reference | `scripts/grant_extension.py`, `extend-space-license` skill | file |
