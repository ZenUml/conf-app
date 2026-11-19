# Enterprise Bundle checkout path — design

Status: draft, 2026-11-20 (Melbourne). Owner decision needed on the items marked **[owner]**.

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

## Causes (ranked by evidence)

| # | Cause | Status |
|---|---|---|
| C1 | `router.open` shows Atlassian's external-link confirmation before Stripe loads. Only **Continue** creates a session. | Observed on lite-stg (2026-11-13). Per-user drop at the dialog is **not measured**. |
| C2 | Checkout asks for "Confluence Domain" (default text `your-company.atlassian.net`) and "Confluence Space" again. The webhook already reads both from `client_reference_id` (`functions/api/stripe-webhook.ts`), so these fields carry no information. | Observed in session objects (`custom_fields`, not prefilled). |
| C3 | Merchant shown is the legal entity name, not "ZenUML". | Observed on lite-stg checkout. Effect on drop-off is a guess. |
| C4 | Tax is added on top for some locations (AU: $299 → $328.90). The button says `$299/yr/space`. | Observed (`amount_total` 32890 on AU test sessions). |
| C5 | Companies that need an invoice, PO or vendor onboarding cannot use a card-only page. | Inferred from repeated opens without input. Not verified. |
| C6 | `success_url` and `cancel_url` are `https://stripe.com`. A buyer who pays lands on Stripe's site, not back in Confluence, with no confirmation that the space is unlocked. | Observed. Does not explain the drop (nobody reached payment), but it breaks the first purchase. |

## Design

Three phases. Each phase ships and is measured on its own.

### Phase 1 — remove friction we own (no new backend)

1. **Payment Link edit [owner]:** remove the two custom fields; set the after-payment redirect to
   `https://zenuml.com/bundle/thanks` (or the Plan and usage page). Stripe dashboard change on a live
   Payment Link; the webhook already uses `client_reference_id`.
2. **Public business name [owner]:** Stripe Settings → Public details → "ZenUML". Statement
   descriptor likewise. Account setting; no code.
3. **Plan and usage copy:** before the click, state what happens next:
   "Opens Stripe checkout in a new tab. Confluence asks you to confirm the external page.
   $299 per space per year, plus tax where applicable. Card payment, no Confluence admin needed."
4. **Measure the dialog (C1):** spike whether `router.open` resolves, rejects or does nothing when
   the user picks Cancel in the Atlassian dialog. If it reports the outcome, emit it (event below).
   If it does not, record that and rely on the Stripe session count.

### Phase 2 — server-created Checkout Session

Replace the static Payment Link URL with `POST /api/bundle-checkout` (Pages Function):

- Input: trusted identity from the FIT (cloudId, site) plus the requested `spaceKey`. Never trust a
  domain sent by the client.
- Creates a Checkout Session (`mode: subscription`, the existing price) with `metadata.cloudId`,
  `metadata.spaceKey`, `client_reference_id`, `success_url` back to Plan and usage,
  `automatic_tax`, and `tax_id_collection`.
- Returns the session URL; the frontend opens it with `router.open`.
- Needs a restricted Stripe key with Checkout Session write only, stored as a Pages secret
  (`wrangler pages secret put`; bakes at deploy). **[owner]** approves creating the key.
- Webhook path unchanged: it already prefers `metadata` and falls back to `client_reference_id`.
- Gives an exact session-created count per click, closing the measurement gap in C1.
- Add `/api/bundle-checkout` to `public/_routes.json` (see `functions/CLAUDE.md`).

No Forge manifest change: the browser still opens a Stripe URL, and the backend call goes to
`*.zenuml.com`, which is already in egress.

### Phase 3 — invoice path for companies (C5)

A "Pay by invoice" option on Plan and usage: collects billing company, billing email and optional
PO number, and the backend creates a Stripe customer and an invoice (`collection_method:
send_invoice`, 30 days). Space is unlocked when `invoice.paid` arrives (new webhook event).
Build only if Phase 1–2 data shows sessions still opened with no input, or a buyer asks for an
invoice.

## Analytics (first commit of the feature branch)

| Event | Trigger | Key properties |
|---|---|---|
| `bundle_checkout_open_result` | `router.open` settles after a Bundle click (Phase 1, only if the spike shows it reports an outcome) | `feature_area: upgrade`, `surface`, `outcome: opened \| declined \| error`, `client_reference_id` |
| `bundle_checkout_session_created` | `/api/bundle-checkout` returns a session (Phase 2) | `surface`, `client_reference_id`, `outcome: created \| failed`, `error_kind` |
| `bundle_checkout_returned` | Plan and usage loads from `success_url` (Phase 2) | `client_reference_id`, `space_paid` (after status refresh) |

Volume: bounded by Bundle clicks, about 80 a month, so under 300 events a month in all. No session
replay source added. Well under both caps (1,000,000 events, 20,000 replays).

## Success measures

| Measure | Baseline (10-21..11-19) | Target after Phase 2, 30 days |
|---|---|---|
| Sessions per Bundle click (sites) | 2 / 18 | ≥ 50% |
| Sessions with any customer input | 0 / 5 | ≥ 1 in 3 |
| Paid Bundles | 0 | ≥ 1 |

## Out of scope

- Putting a purchase control back on the page banner (Forge pageBanner guideline).
- Price changes.
- The Marketplace (Full) upgrade path, which needs a site admin and is billed by Atlassian.

## Open questions

1. Does `router.open` report the user's choice in the external-link dialog? (Phase 1 spike.)
2. Is "ZenUML" allowed as the Stripe public business name for this legal entity? **[owner]**
3. Should the invoice path (Phase 3) be built before there is a request for it? **[owner]**
