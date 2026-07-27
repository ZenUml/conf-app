# Deeplink serving → per-variant Cloudflare Pages (retire the standalone Worker)

**Date:** 2026-07-28
**Status:** Design (brainstorming approved; pending spec review → writing-plans)
**Related:** #360 (autoConvert matcher — merged), #399 (standalone Worker + mint — open), #404 (autoConvert E2E — open)

## Problem

The embed deeplink feature has two halves:

- **In-Confluence autoConvert** — pasting `https://<deeplink-host>/d/<cloudId>/<contentId>` converts to the embed macro. Shipped (#360, merged, staging-verified). It is a client-side **URL pattern match** in the editor; it does **not** fetch the host.
- **Out-of-Confluence serving** — when the same link lands in Slack / email / a browser bar, a page must resolve it (preview / expired / instruction) and serve the unfurl image. Today this is a **standalone Cloudflare Worker** on `confluence.zenuml.com` (`workers/confluence-deeplink/`, on branch #399; deployed to prod manually; never publicly released).

The standalone Worker is a separate deploy unit from the per-variant backends: shared blast radius across variants, a separate deploy + secret to maintain, and a domain disconnected from each variant's Pages project. The mint endpoint (`functions/deeplink-ticket.ts`) is already a Pages function.

## Goal

Fold the deeplink serving (`/d/`, `/i/`, `/`) into each variant's Cloudflare Pages Functions, so that:

- each variant serves its own deeplinks from its own Pages project (release independence, blast-radius isolation),
- deeplink serving + mint + KV + signing secret live in **one** unit per variant,
- the standalone Worker is retired.

## Verified facts that shape the design (2026-07-27/28)

1. **Nothing is published.** The mint endpoint (`/deeplink-ticket`) is not deployed on any backend (all return `200 text/html` SPA-fallback), so **no production deeplink has ever been minted or shared**. Only manual-demo links exist on `confluence.zenuml.com`. → No legacy links to preserve; the domain scheme is a **free choice**.
2. **Each variant's Pages backend already has its own domain** — the Forge `connect` remote's `baseUrl: ${BACKEND_API_BASE_URL}`: lite = `conf-lite.zenuml.com`, full = `conf-full.zenuml.com`. The host is a **Forge env variable**, so repointing is `forge variables set` — **no manifest change / version bump**.
3. **diagramly has no own Pages project** — it shares `conf-lite` (functions are identical across variants; the Forge frontend is served by Forge's CDN, so the Pages deploy is backend-only). `release.yml` documents the intent to split dedicated `conf-diagramly` / `conf-asyncapi` projects **before GA**.
4. **asyncapi is a special case and out of scope.** It ships no `confluence.zenuml.com` autoConvert matcher (it uses `zenuml-asyncapi-embed-macro`). Its prod backend host `zenapi.zenuml.com` is a live **Connect Worker** (Cloudflare project `asyncapi-confluence-prod`) that serves legacy Connect tenants and **proxies** `/forge-*` `/api/*` to the conf-lite Pages backend — not a clean Pages domain.
5. **The Pages `_middleware` is an allowlist** (`AUTHENTICATED_PATHS` = `/diagramly`, `/metrics-cache`, `/forge-custom-content`, `/forge-upload-attachment`): everything else is served **public** with no auth. → `/d/` `/i/` are public with **no** middleware change; `/deeplink-ticket` must be **added** to `AUTHENTICATED_PATHS`.
6. **A Pages project can own multiple custom domains** (kept in reserve; not required by this design).

## Decisions

### Domain scheme — reuse each variant's backend domain (zero new domains)

| Variant | Deeplink host | Notes |
|---|---|---|
| lite | `conf-lite.zenuml.com` | reuse backend domain; already attached to conf-lite Pages |
| full | `conf-full.zenuml.com` | reuse backend domain; already attached to conf-full Pages |
| diagramly | `conf-lite.zenuml.com` (shared) | rides conf-lite for now; gets its own host when `conf-diagramly` splits pre-GA |
| asyncapi | — | no deeplink (out of scope) |

The `confluence.zenuml.com` standalone Worker is **retired** once all matchers repoint.

**Tier visibility is intentional, not a leak.** A Lite user sharing `conf-lite.zenuml.com/d/...` surfaces the free tier — an accepted freemium growth signal. But the hostname is a **weak** vehicle: Slack hides the raw URL behind the unfurl card, and in-Confluence the link becomes a macro with no URL shown. So the **real upgrade lever is a deliberate CTA on the Lite `/d/` preview page**, which we fully control. Scoped as a growth item below.

### Architecture — identical shape per variant, in `functions/`

Ported from `workers/confluence-deeplink/src/index.ts`:

- `functions/d/[cloudId]/[contentId].ts` — the three-state `/d/` page: fresh preview (diagram PNG + Open-in-Confluence + og:image), live-ticket-but-expired-image (expired page + button), and no-usable-ticket (static instruction page). Token verify + structural validation as in the Worker.
- `functions/i/[token].ts` — the `/i/` preview PNG (KV lookup by the payload-derived image key; 404 after KV TTL).
- `functions/deeplink-ticket.ts` — mint (already exists on #399; ships with each variant now).
- `public/_routes.json` — add `/d/*`, `/i/*`, `/deeplink-ticket`.
- `functions/_middleware.ts` — `/d/` `/i/` public by default; add `/deeplink-ticket` to `AUTHENTICATED_PATHS`.
- Per Pages project: bind the deeplink **KV** namespace; set **`DEEPLINK_SIGN_SECRET`** (`wrangler pages secret put`, same value the mint + serve share).
- **Privacy:** no request-path logging (customer cloudId/contentId), matching the Worker's discipline; static HTML only, `noindex` + `X-Robots-Tag` on `/d/`.
- `src/utils/embedDeeplink.ts` `DEEPLINK_RE` → **multi-host** (accept every live deeplink host, since variants now differ).
- **Lite `/d/` preview page: add an upgrade CTA** (growth).

### Manifest matcher changes

Each variant's `manifest.yml` autoConvert matcher → its own deeplink host (lite → `conf-lite.zenuml.com`, full → `conf-full.zenuml.com`, diagramly → `conf-lite.zenuml.com`). This is a **minor** Forge version (auto-upgrades, no admin consent). The mint URL built in `deeplink-ticket.ts` → the variant's host.

### Rollout — incremental, staging-first

`confluence.zenuml.com` can only retire once **all three** matchers point elsewhere; until then keep the Worker live (or point `confluence.zenuml.com` at conf-lite Pages as a transitional catch-all).

- **Phase 1 — lite (+ diagramly, which shares conf-lite):** add the functions + routes + KV/secret to `conf-stg-lite` then `conf-lite`; repoint lite's matcher to `conf-lite.zenuml.com` (and diagramly's too **if** it ships the standard embed matcher — confirm during planning; either way diagramly is served by conf-lite Pages); add the Lite preview CTA. Validate on `conf-stg-lite` (curl the 3 states; run the #404 autoConvert E2E, now expecting `conf-lite.zenuml.com`). Cut prod.
- **Phase 2 — full:** same on `conf-stg-full` then `conf-full`; matcher → `conf-full.zenuml.com`.
- **Phase 3 — retire the Worker:** once lite/full/diagramly all serve from Pages, un-deploy `workers/confluence-deeplink` and drop the `confluence.zenuml.com` DNS record. Keep the code in-repo (history). Re-scope or close #399.

diagramly's **own** host waits for the `conf-diagramly` split (pre-GA); until then its deeplinks ride `conf-lite.zenuml.com` — a temporary same-host cross-brand condition, documented and accepted.

### Testing

- Reuse the checked-in autoConvert E2E (`tests/insert/embed-deeplink-autoconvert.spec.ts`, #404) after each matcher change — make the expected host **read from the active profile** rather than hard-coding it, so one spec covers all variants.
- Port the Worker's unit tests (`workers/confluence-deeplink/src/index.spec.ts`, 19 cases: routing, three states, security gates, expiry boundary, `/i/` key derivation) to the Pages functions.
- curl each staging deeplink host for the 3 states + the unfurl (`og:`) tags.

### Out of scope

- **asyncapi** deeplinks — no matcher; its prod host is a Connect Worker + proxy, not clean Pages. Revisit only if/when `conf-asyncapi` splits and asyncapi gains a deeplink matcher.
- The `conf-diagramly` / `conf-asyncapi` project splits themselves (separate pre-GA work).
- Per-brand vanity domains (the earlier `confluence.diagramly.ai` idea) — deferred; reuse backend domains now.

## Cloud changes needing explicit approval (per cutover)

Attaching/removing custom domains, `wrangler pages secret put DEEPLINK_SIGN_SECRET`, KV namespace binding, retiring the Worker + dropping the `confluence` DNS record. Each staging/prod deploy is CI/CD per policy.
