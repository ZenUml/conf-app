# PR #1228 evidence

BEFORE: origin/main c23337f8. AFTER: 849b6cab (branch feat/bundle-checkout-handoff).

| File | What |
|---|---|
| before-plan-usage.jpg | Storybook `Plan and usage/PlanUsage` SpacePurchases, main's PlanUsage.vue |
| after-plan-usage.jpg | Same story, branch |
| after-plan-usage-opened.jpg | Same story after clicking Unlock on ENG |
| impl-handoff.png | `handleBundleCheckoutPage` output (fixture ref `example-tenant__ENG`), countdown state |
| impl-nojs.png | Same page, scripts blocked: "Checkout is ready" + link |
| impl-invalid.png | Bad ref: 400 page |

Storybook: local dev server, Chrome, 800 px wide, fixture data. Handoff renders: handler HTML rendered in headless Chrome. Fictional tenant only.

## Forge tunnel (lite-dev, internal dev site, development env)

Branch 849b6cab served by Vite through `forge tunnel`, browser signed in as the Forge account.

| File | What |
|---|---|
| tunnel-before-click.jpg | Plan and usage on lite-dev: new help copy (proves tunnel serves branch code) |
| tunnel-after-click.jpg | After Unlock on SD: no Atlassian "Opening external page" dialog; row shows "Checkout opened in a new tab"; new tab opened at `https://conf-stg-lite.zenuml.com/bundle-checkout?ref=lite-dev__SD&space=SD&surface=plan_usage&click=<uuid>` |

## CI staging (conf-stg-lite, PR validation run 44633339125, 849b6cab)

- staging-handoff.jpg: live handoff page, fictional ref example-tenant__ENG.
- After 6 s the tab was on buy.stripe.com/...?client_reference_id=example-tenant__ENG (auto countdown). Stripe page not captured: it shows a personal saved card.
- curl: page 200 with CSP nonce, no-store, noindex, no-referrer; /go 302 to the Payment Link; bad ref 400.
