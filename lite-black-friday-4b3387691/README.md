# Lite Black Friday visual evidence

The baseline is Storybook at `cfaca7461` (desktop 1100 × 950). The merge base for the candidate is `5658cd0e6`; the two components and Storybook configuration have no changes between those revisions. The candidate is `4b338769136f492e8b30cd0e7e126a26b9bce126` (desktop 1150 × 1000 CSS pixels; screenshot dimensions can expand to include full content). The centered content uses the same fixed widths. Only fictional Storybook fixture data is included.

Open the following stories with the default args. For the candidate, run Storybook with `VITE_PREVIEW_BUNDLE_BLACK_FRIDAY=true`.

| Story ID | Baseline | Candidate |
| --- | --- | --- |
| `plan-and-usage-planusage--space-purchases` | [Plan and usage](plan-usage-before.png) | [Plan and usage](storybook-plan.png) |
| `viewer-fullscreenrecoverygate--edit-choose-use` | [Edit paywall](paywall-before.png) | [Edit paywall](storybook-edit.png) |
| `viewer-fullscreenrecoverygate--expired` | [Fullscreen paywall](fullscreen-before.png) | [Fullscreen paywall](storybook-fullscreen.png) |

The offer shows US$149.50 for year one, then US$299 per space per year. Paid and unknown license rows have no purchase action. Both recovery dialogs keep their original actions and show the offer above the actions.

The same candidate was verified in Forge Tunnel and on [CI-deployed Lite Staging](https://github.com/ZenUml/conf-app/actions/runs/45341226535). Live Staging Plan and usage opened Stripe with the expected space reference and prefilled promotion code. The Staging recovery dialogs used browser-local test responses for usage and recovery status. No payment was attempted. Component and backend tests cover price, automatic promotion entry, and expired offer handling separately from the live checks.
