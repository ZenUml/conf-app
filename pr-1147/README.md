# PR 1147 evidence: Lite page banner without checkout button

- Baseline: origin/main 48eeb5f9. Candidate: branch fix/page-banner-no-checkout.
- Capture: Storybook (PRODUCT_TYPE=lite, port 6016), stories `Page banner/PaywallWarningBanner` -> `Space admin` and `Shown`; headless Chrome, 1100x60 viewport. BEFORE = the same stories with origin/main's PaywallWarningBanner.vue.
- Fixtures: tenant `example-tenant`, space `ENG`, 120 of 100 macros.
- red.log: new spec case fails on origin/main code (`expected true to be false`). green.log: spec passes after the change (14 tests).
- Limits: Storybook only. Forge Tunnel not run. Staging checked by CI only.
