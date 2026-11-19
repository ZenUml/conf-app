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
