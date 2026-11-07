# PR 1085: placement picker evidence

- **BEFORE:** `before-byline-writes-immediately.jpg` is `lite-stg` while another branch's build, with no picker code, was deployed there. Add to page shows "Adding…" and appends straight away.
- **AFTER, CI-deployed staging at `a7a538c2`** (Lite `16.1582.0`, `lite-stg`, live bundle confirmed to contain the picker): `staging-banner-picker.jpg`, `staging-byline-picker.jpg`, `staging-page-changed.jpg`, `staging-placed-and-revealed.jpg`. The page-changed case was produced by editing the neighbouring heading through the REST API while the picker was open.
- **Escape, at `0b9f579f`:** `storybook-escape-cancels.jpg` (Storybook) and `dev-escape-closed.jpg` (dev environment `yanhui` on `whimet4`, `19.103.0`, after clicking inside the picker and pressing Escape).

**Limits:** no Forge Tunnel run; dev-environment deploys were used in its place. Stored positions were read from the page ADF over REST. Viewport about 1564x784.
