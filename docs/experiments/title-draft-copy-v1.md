# Title-draft offer copy experiment v1

Status: implementation; the experiment starts only when the enabled build reaches Lite production.

## Question and scope

Does a reader-benefit headline and an explicit preview action increase the proportion of eligible Lite users who open a title-based diagram preview?

Only the native entry flag's title, description and primary action change. Offer eligibility, the existing Forge rollout, page and user cooldowns, timing, diagram generation, preview, editing and saving remain unchanged. Full, Diagramly and AsyncAPI do not reach this Lite-only offer.

| Field | A (control) | B (treatment) |
| --- | --- | --- |
| Title | A diagram for this page is ready | Help readers understand this page |
| Description | ZenUML sketched it from the page title. Nothing changes until you add it. | Preview a draft diagram based on the page title. Your page stays unchanged until you add it. |
| Primary action | See diagram | Preview diagram |
| Secondary action | Not now | Not now |

This tests the copy package as a whole. It does not isolate the effect of the headline from the button label.

## Assignment and controls

- Experiment ID `title-draft-offer-copy`, version `1`.
- Assign authenticated accounts deterministically, approximately 50/50, using the versioned experiment key and account ID. The same account stays in one group across sites, pages, browser storage and refreshes. Do not randomize per display.
- Create a new exposure ID only when showing the entry flag. Keep that attribution immutable through callbacks and the preview iframe. Existing or malformed modal contexts without a complete valid attribution remain unassigned.
- Lite already has ten Forge flags (the Console limit, verified 2026-11-11). Use `VITE_TITLE_DRAFT_COPY_EXPERIMENT_ENABLED`, following the existing build-constant precedent. Enabled builds run the experiment; disabled builds show the exact original copy without experiment attribution. Stopping this experiment requires rebuilding and releasing; the existing `title-draft-enabled` flag still controls the whole offer.
- Do not place account IDs, page titles, diagram source or customer identifiers in new analytics fields. Existing standard identity/context enrichment remains unchanged.

## Events defined before runtime implementation

The first branch commit registers the properties and event semantics in `src/utils/analytics/catalog.ts` and `types.ts`.

| Event | Trigger | Required experiment properties when assigned |
| --- | --- | --- |
| `title_draft_flag_shown` | Native entry flag successfully shown | experiment ID/version, variant, exposure ID; existing feature and page context |
| `title_draft_not_now` | User clicks Not now | same exposure attribution |
| `title_draft_preview_opened` | User clicks the entry flag's preview action | same exposure attribution |
| `title_draft_preview_mounted` | Actual preview iframe mounts | same exposure attribution, surface modal, explicit page ID |
| `title_draft_preview_rendered` | SVG is present after the DOM update | same exposure attribution |
| `title_draft_preview_render_failed` | Preview rendering fails | same exposure attribution |
| `title_draft_add_clicked` | User clicks Add to page | same exposure attribution |
| `title_draft_added` / `title_draft_add_failed` | Add operation completes with success/failure | same exposure attribution; existing failure reason |
| `title_draft_preview_closed` | Preview closes without added/already-added outcome | same exposure attribution and existing close reason |

Keep existing event meanings, sampling and preview replay behavior. A flag-shown event proves the host accepted the flag, not that the user read it. A preview-opened event proves the action callback ran, not that the preview rendered. Successful rendering and uploaded/retrievable replay are separate signals.

## Analysis contract

Use only production Lite customer events with the exact experiment ID/version and valid attribution; exclude internal/test sites. The primary randomization and analysis unit is an authenticated account. Repeated displays do not create independent participants. Check exposure balance and accounts appearing in both groups before evaluating the outcome. Report tenant concentration as a diagnostic.

Primary metric: fraction of exposed accounts with a matching preview-opened event within 24 hours of their first experiment exposure. Join account + experiment + variant + exposure ID, and wait 24 hours after the last enrolled account before final analysis. Also report per-display CTR descriptively, never treat correlated displays as independent users.

Secondary funnel: mounted, rendered, render-failed, Add clicked and added, each joined to its exposure. Report added per exposed account as well as added per preview; a change in the mix of clickers can change the latter. Record Not now and close reasons as diagnostics.

Planning baseline was measured on 2026-11-11: over the preceding 24 hours, 655 customer flag-shown events, 615 exposed accounts, ten preview-opened events; nine clicked accounts could be joined to an exposure inside that window. Use approximately 1.46% as a provisional planning baseline, not as a stable long-run estimate.

Predeclared first target: detect approximately a doubling, from 1.46% to 2.93%, with a two-sided 5% significance threshold and 80% power, about 3,150 total independent exposed accounts split evenly. Enroll for at least 14 complete days and until both groups have approximately 1,575 accounts, then allow the 24-hour outcome window to mature. This is a planning approximation; do not declare a winner from daily significance peeking. If the sample cannot detect the observed difference, report inconclusive. Detecting a 50% improvement needs roughly 10,500 total accounts and a longer run.

Do not auto-select a winner or automatically extend this into more variants. CTR improvement alone does not prove more diagrams were added.

## Ordered validation

1. Unit tests: stable assignment, broad distribution, exact A/B copy, disabled fallback, legacy/malformed context, unchanged eligibility, and consistent attribution across callbacks/iframe outcomes.
2. Storybook: desktop representations of both native flags sharing the exact production copy constants. State explicitly that native Confluence chrome is represented, not rendered by Forge here.
3. Forge Tunnel: same committed candidate, actual native flag, visible local Vite source; check chosen cohort matches account and remains stable on repeat, then click preview and verify attribution in the real iframe.
4. CI-deployed Staging: successful candidate deployment, confirm its visible build, repeat actual host flag/preview checks and received analytics.
5. Production: Diagramly canary before Lite on the same commit, production smoke and focused checks. Confirm Lite's actual assignment and received attributed events before reporting that the experiment is live.

Existing diagram creation/edit persistence is unchanged; this experiment's focused checks cover the offer-to-preview path. Regression suites retain create/edit coverage.
