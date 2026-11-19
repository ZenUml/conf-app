# Enterprise Bundle checkout path — design

Status: draft, rev 3, 2026-11-20 (Melbourne). Owner decision needed on the items marked **[owner]**.

Rev 2: Phase 1 now opens checkout through a `*.zenuml.com` redirect, because a production test
showed that Forge shows no external-page dialog for our own domain (see "Dialog test" below).
Rev 1 assumed the dialog could not be removed. Rev 3: the redirect is a 3-second handoff page, not a bare 302. High-fidelity screens: Figma frame 06.13.

## Problem

The Lite paywall produces purchase intent but no purchases. Measured 2026-10-21 to 2026-11-19
(Mixpanel project 3373228, internal sites excluded; Stripe live account):

```
Bundle button clicked      18 sites / 40 users / 77 clicks
        │  Atlassian "Opening external page on buy.stripe.com" dialog
        ▼
Stripe Checkout opened      2 sites / 5 sessions (plus 2 internal test sessions)
        │  no field filled in any session (customer_details = null)
        ▼
Paid                        0 (no charges in the window)
```

| Stage | Loss | Evidence |
|---|---|---|
| Click to Checkout Session | 16 of 18 sites | Mixpanel `paywall_bundle_cta_clicked` vs Stripe `GET /v1/checkout/sessions` by `client_reference_id` |
| Session opened to any input | 5 of 5 sessions | Stripe: `status: expired`, `customer_details: null` |
| One site, one space | Opened Checkout 4 times in 15 days, never typed | Stripe sessions with the same `client_reference_id` |

Earlier window (2026-08-07 to 11-12): 119 clicks, 17 sessions (6 internal), 0 paid.

Since 2026-11-13 (`4577c1fe`) the page banner has no Bundle button (Forge pageBanner guideline:
no upsell). The path is now banner → Plan and usage page → Bundle. 145 users reached Plan and
usage from the banner after that change; 2 clicked Bundle there.

## Dialog test (production, 2026-11-20)

Called the bridge function behind `router.open` (`callBridge('navigate', {url, type: 'new-tab'})`)
from a macro iframe on the production site zenuml.atlassian.net:

| URL | Atlassian dialog | `router.open` promise |
|---|---|---|
| `https://zenuml.com/docs/` | **None**; the new tab opened at once | resolved `true` |
| `https://buy.stripe.com/...` | "Opening external page on buy.stripe.com" | Cancel → rejected `Error: cancelled` |
| `https://example.com/` | "Opening external page on example.com" | Cancel |

- Observed: our own domain opens with no dialog; Stripe and an unrelated domain get the dialog.
- Inferred (not documented by Atlassian): hosts listed in `permissions.external.fetch.client`
  (`https://zenuml.com`, `https://*.zenuml.com`) skip the dialog.
- Observed: Cancel rejects the promise. `openUrl` (`src/model/globals/forgeGlobal.ts`) neither awaits
  nor catches it today, so the outcome is lost.

## Causes (ranked by evidence)

| # | Cause | Status |
|---|---|---|
| C1 | The Stripe URL triggers Atlassian's external-page dialog. Only **Continue** opens Checkout. | Observed (test above). Per-user drop at the dialog is **not measured**; most of the 16-of-18 loss is likely here. |
| C2 | Checkout asks for "Confluence Domain" (default text `your-company.atlassian.net`) and "Confluence Space" again. The webhook already reads both from `client_reference_id` (`functions/api/stripe-webhook.ts`), so these fields carry no information. | Observed in session objects (`custom_fields`, not prefilled). |
| C3 | Merchant shown is the legal entity name, not "ZenUML". | Observed on lite-stg checkout. Effect on drop-off is a guess. |
| C4 | Tax is added on top for some locations (AU: $299 → $328.90). The button says `$299/yr/space`. | Observed (`amount_total` 32890 on AU test sessions). |
| C5 | Companies that need an invoice, PO or vendor onboarding cannot use a card-only page. | Inferred from repeated opens without input. Not verified. |
| C6 | `success_url` and `cancel_url` are `https://stripe.com`. A buyer who pays lands on Stripe's site, not back in Confluence, with no confirmation that the space is unlocked. | Observed. Does not explain the drop (nobody reached payment), but it breaks the first purchase. |

## Design

Three phases. Each phase ships and is measured on its own.

```
Before:  Unlock ─▶ router.open(buy.stripe.com/…)                      ─▶ [dialog] ─▶ Stripe
Phase 1: Unlock ─▶ router.open(conf-lite.zenuml.com/bundle-checkout?…) ─▶ handoff page (3 s) ─▶ Stripe Payment Link
Phase 2: Unlock ─▶ router.open(conf-lite.zenuml.com/bundle-checkout?…) ─▶ server creates
                                                                         Checkout Session ─▶ 302 ─▶ Stripe
```

### Phase 1 — open checkout through our domain (no Stripe key)

1. **Redirect endpoint** `GET /bundle-checkout` (Pages Function on the Lite backend host,
   `conf-lite.zenuml.com` in production, `conf-stg-lite.zenuml.com` on staging):
   - Query: `ref` (the existing `<domain>__<spaceKey>` value, same sanitising as
     `src/utils/paywall/enterpriseBundleCheckout.ts`) and `surface`.
   - Validates `ref` against `^[A-Za-z0-9_-]{1,200}$`; on failure answers 400 with a short HTML page.
   - Answers `200` with a short **handoff page** (owner decision, 2026-11-20), not a bare `302`:
     a summary card (space and site, $299 per year plus tax where applicable, what the space gets,
     card payment by Stripe with no Confluence admin needed), a 3-second countdown with a progress
     bar, a **Stop** link that pauses it, and a **Continue to Stripe now** button. When the countdown
     ends, or on Continue, the page goes to the fixed Payment Link with `client_reference_id=<ref>`.
     The target is a constant, so this is not an open redirect. The page also says that Stripe may
     show the registered company name (C3). Nothing to fill in, so it adds no click.
   - Why not a bare `302`: the 5 sessions that reached Checkout had no input at all, so trust and
     price clarity at the moment of payment may matter (inferred). Why not a page that waits for a
     click: one extra step (the dialog) lost 16 of 18 sites. The page's own drop is measured by
     `bundle_checkout_continued` against `bundle_checkout_redirected`.
   - Records `bundle_checkout_redirected` server-side (see Analytics) before redirecting. This gives
     an exact count of users who passed the click, which the Payment Link alone cannot give.
   - Trust: `ref` comes from the client, exactly as `client_reference_id` does today, so this step
     adds no new trust. A wrong `ref` still only lets someone pay for a space. Signing the ref is
     Phase 2 (the new tab carries no Forge FIT, so the server cannot check identity here).
   - Add `/bundle-checkout` to `public/_routes.json` (see `functions/CLAUDE.md`), or the path serves
     static HTML.
2. **Frontend:** `enterpriseBundleCheckout.ts` builds the redirect URL from `BACKEND_API_BASE_URL`
   instead of the Stripe URL. `PlanUsage.vue` `purchaseSpace()` and `UpgradePrompt.vue` keep calling
   `openUrl`. Make `openUrl` return the `router.open` promise and record a rejection (only in case a
   host still shows the dialog).
3. **Plan and usage copy (C4):** under the Unlock button:
   "Opens secure Stripe checkout in a new tab. $299 per space per year, plus tax where applicable.
   Card payment, no Confluence admin needed."
4. **Payment Link edit [owner] (C2, C6):** remove the two custom fields; set the after-payment
   redirect to `https://zenuml.com/bundle/thanks` (or the Plan and usage page). Stripe dashboard
   change on a live Payment Link; the webhook already uses `client_reference_id`.
5. **Public business name [owner] (C3):** Stripe Settings → Public details → "ZenUML". Statement
   descriptor likewise. Account setting; no code.

No Forge manifest change: `https://*.zenuml.com` is already in `external.fetch.client`, and that
is the list the dialog test depends on.

Validation: Storybook (copy), Forge tunnel on lite-stg (click Unlock: no dialog, Stripe opens with
the right `client_reference_id`), then CI-deployed staging, per the repo's UI validation order.

### Phase 2 — server-created Checkout Session

Same redirect endpoint, but it creates a Checkout Session instead of using the Payment Link:

- Frontend first calls `POST /api/bundle-checkout` with the Forge FIT. The server takes cloudId and
  site from the FIT (never from the client), takes `spaceKey` from the body, and returns a short-lived
  signed token (HMAC, about 10 minutes).
- The frontend opens `/bundle-checkout?t=<token>`. The endpoint verifies the token, creates the
  Checkout Session (`mode: subscription`, the existing price, `metadata.cloudId`,
  `metadata.spaceKey`, `client_reference_id`, `success_url` back to Plan and usage, `automatic_tax`,
  `tax_id_collection`), and answers `302` to `session.url`.
- Needs a restricted Stripe key with Checkout Session write only, stored as a Pages secret
  (`wrangler pages secret put`; bakes at deploy). **[owner]** approves creating the key.
- Webhook path unchanged: it already prefers `metadata` and falls back to `client_reference_id`.
- Makes the owner items 4 and 5 of Phase 1 code-controlled (no custom fields, our `success_url`).

### Phase 3 — invoice path for companies (C5)

A "Pay by invoice" option on Plan and usage: collects billing company, billing email and optional
PO number, and the backend creates a Stripe customer and an invoice (`collection_method:
send_invoice`, 30 days). Space is unlocked when `invoice.paid` arrives (new webhook event).
Build only if Phase 1–2 data shows sessions still opened with no input, or a buyer asks for an
invoice.

## Analytics (first commit of the feature branch)

| Event | Trigger | Key properties |
|---|---|---|
| `bundle_checkout_redirected` | `/bundle-checkout` serves the handoff page or the 400 page (Phase 1, server-side) | `feature_area: upgrade`, `surface`, `client_reference_id`, `outcome: served \| invalid_ref` |
| `bundle_checkout_continued` | Handoff page leaves for Stripe (Phase 1, page script) | `feature_area: upgrade`, `surface`, `client_reference_id`, `trigger: auto \| button`, `stopped_first` |
| `bundle_checkout_open_result` | `router.open` rejects after a Bundle click (Phase 1, client-side) | `feature_area: upgrade`, `surface`, `outcome: declined \| error` |
| `bundle_checkout_session_created` | Phase 2 endpoint creates a session | `surface`, `client_reference_id`, `outcome: created \| failed`, `error_kind` |
| `bundle_checkout_returned` | Plan and usage loads from `success_url` (Phase 2) | `client_reference_id`, `space_paid` (after status refresh) |

Volume: bounded by Bundle clicks, about 80 a month, so under 300 events a month in all. No session
replay source added. Well under both caps (1,000,000 events, 20,000 replays).

## Success measures

| Measure | Baseline (10-21..11-19) | Target 30 days after Phase 1 |
|---|---|---|
| Checkout opened per Bundle click (sites) | 2 / 18 | ≥ 80% (`bundle_checkout_redirected` / clicks) |
| Sessions with any customer input | 0 / 5 | ≥ 1 in 3 |
| Paid Bundles | 0 | ≥ 1 |

## Out of scope

- Putting a purchase control back on the page banner (Forge pageBanner guideline).
- Price changes.
- The Marketplace (Full) upgrade path, which needs a site admin and is billed by Atlassian.

## Open questions

1. Is the "no dialog for `external.fetch.client` hosts" rule stable? It is observed, not documented.
   The client-side rejection event in Phase 1 would show a regression.
2. Is "ZenUML" allowed as the Stripe public business name for this legal entity? **[owner]**
3. Should the invoice path (Phase 3) be built before there is a request for it? **[owner]**
