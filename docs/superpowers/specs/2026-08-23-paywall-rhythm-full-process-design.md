# Paywall rhythm full process — Storybook, bridge, extension intake, and admin outreach

**Date:** 2026-08-23  
**Base:** `feat/paywall-rhythm-enhanced` (W1 + W2)  
**Product classification:** C — B2B embedded plugin. Users arrive mid-task and are usually not the buyer, so the question/reward rhythm belongs across the lifecycle rather than before first value.

## 1. Outcome

Show and eventually implement the complete Lite paywall rhythm without hiding which parts exist:

- W1 and W2 remain production-backed: three metered continues, tiered copy, the last-continue commitment beat, and the space-level investment mirror.
- W3 is a one-time three-day bridge offered after an unpaid checkout return.
- W4 is a voluntary extension/intake flow that learns how the team uses AI and diagrams, determines the required unblock scope and timing, then routes the request to the organisation's Marketplace technical contact.
- Storybook presents the whole W1–W4 journey with an always-visible `Implemented` or `Concept` badge on every stage.
- Marketplace contact resolution is precomputed daily and stored in D1. A paywall submission never waits for Marketplace.
- Definite customer contacts receive automatic JSM outreach. Partner, reseller, missing, stale, and ambiguous contacts enter human review before external mail.

The paywall remains at the peak-intent action: an over-limit user attempting to edit or create. No questionnaire appears at entry.

## 2. Current implementation boundary

| Capability | Status at design time | Evidence |
|---|---|---|
| Warning banner before the block | Implemented | `PaywallWarningBanner.vue` and stories |
| Three continue attempts | Implemented on W1/W2 branch | `continueAttempts.ts` |
| Tiered 3 / 2 / last / exhausted beats | Implemented on W1/W2 branch | `UpgradePrompt.vue` |
| Space investment mirror | Implemented on W1/W2 branch | `UpgradePrompt.vue` |
| Direct per-space checkout and Marketplace CTA | Implemented | `UpgradePrompt.vue` |
| Stripe webhook space-license activation | Implemented | `functions/api/stripe-webhook.ts` |
| Existing extension action | Implemented as a prefilled JSM link | `buildExtensionRequest.ts` |
| Unpaid-checkout detection and three-day bridge | Concept | W3 |
| Guided extension/intake questionnaire | Concept | W4 |
| Daily Marketplace contact cache | Concept | backend slice |
| Automatic JSM request + participant routing | Concept | backend slice |
| Payment confirmation candy | Concept | closure slice |

The Storybook journey must preserve these labels even if production slices land later. A production-backed badge means the stage renders or wraps a real shipped component. A concept badge means a Storybook-only fixture with no live side effect.

## 3. End-to-end lifecycle

### 3.1 Prelude

1. **Candy / warning:** an active author sees the existing over-limit warning banner before a hard block.
2. **Paywall:** the user attempts an edit or create in an over-limit Lite space. This action-intent moment opens the paywall.

### 3.2 W1 + W2 — implemented rhythm

1. **Three remaining:** space investment mirror first; neutral continue copy; purchase, advocacy, and extension rails remain available.
2. **Two remaining / loss preview:** explain that new edits pause after the remaining allowance.
3. **Last remaining / commitment:** collapse the modal to three degrees of yes: unlock now, ask the admin, or use the final continue.
4. **Exhausted:** existing diagrams remain visible and safe; editing requires purchase or extension.

### 3.3 W3 — one-time checkout bridge

1. The user opens the existing `$299/year/space` checkout.
2. The product observes an unpaid return. Detection mechanics must be implemented explicitly; Storybook simulates the transition and does not claim it already exists.
3. **Candy:** offer a one-time three-day bridge for that space so work can resume while the team decides.
4. On acceptance, show the exact expiry time and resume editing.
5. On bridge day two, show a warning that the bridge ends tomorrow and present the space/site decision paths.
6. At expiry, route the user to W4 or purchase. The bridge is never silently renewable.

### 3.4 W4 — voluntary intake with a 3:1 rhythm

The user has explicitly requested an extension, so up to eight short steps are acceptable. There is no price during the questions.

#### Questions 1–3 — learn the working context

1. Which AI coding tools do you currently use? Multi-select known tools plus `Other`; free-form `Other` text is stored operationally but never sent to Mixpanel.
2. Do you use those tools to create or update diagrams? `often`, `sometimes`, `not_yet`.
3. Does your team require diagrams in a defined workflow? Multi-select diagram/process categories.

**Candy — authority/future-template slot:** reflect that ZenUML can adapt diagram workflows to the tools the team already uses. The first version reflects answers only. A later version may insert a relevant template recommendation here without changing the flow.

#### Questions 4–6 — scope and urgency

4. Does the team use diagram templates? `standard_templates`, `informal_examples`, `none`.
5. Who needs to be unblocked? `self`, `space`, `site`.
6. When must work resume? `today`, `this_week`, `planning_ahead`.

**Candy — reassurance:** existing diagrams are safe; the answers are preparing the shortest route for the selected scope and timing.

#### Questions 7–8 — duration and notification

7. How much temporary access would help? `one_day`, `three_days`, `one_week`. This informs routing and does not promise approval.
8. Review the scope, urgency, and requested duration. The screen discloses: ZenUML will contact the organisation's registered technical or site contact to coordinate access.

The user does not confirm, view, or edit the admin email. Contact identification is ZenUML's responsibility and the sales opportunity created by the unblock request.

### 3.5 Terminal routing

- **Self:** temporary bridge or reviewed personal extension. The system must state the expiry.
- **Space:** immediate `$299/year/space` checkout or a reviewed temporary extension.
- **Site:** Marketplace Full plan, with outreach to the registered technical contact.

Price appears only on this terminal screen.

### 3.6 Closure

After confirmed payment or activation, show a candy state that:

- confirms which scope is unlocked and until when;
- celebrates uninterrupted team work without personal praise or shame;
- returns the user directly to editing;
- never declares success before the license check confirms activation.

## 4. Storybook design

### 4.1 Presentation

Use approach A: a persistent grouped journey rail plus one focused stage.

The rail groups `Prelude`, `W1 + W2`, `W3`, `W4`, and `Closure`. Each stage shows:

- W number and beat type;
- `Implemented` (green, solid) or `Concept` (amber, dashed);
- a short explanation of what is real;
- progress within the current group.

Controls: `Back`, `Next`, `Reset`, and direct stage navigation. Real CTA clicks may advance the journey, but the shell also supplies explicit simulation controls for external transitions such as `Return without payment` and `License activated`.

### 4.2 Isolation

- W1/W2 stages reuse the real `UpgradePrompt` component and its existing Storybook mocks.
- The warning prelude may reuse `PaywallWarningBanner` where its synchronous storage gate remains deterministic.
- W3/W4/closure use story-only Vue components or fixtures imported only from `*.stories.ts`.
- No story calls Stripe, Marketplace, JSM, Forge, D1, support, or Mixpanel.
- All tenant, page, user, and email values are placeholders such as `example-tenant` and `admin@example.com`.

### 4.3 Review inventory

A status/inventory panel lists the same implementation boundary as section 2. This satisfies the requirement to tell reviewers what is implemented and what is not without relying on documentation outside Storybook.

## 5. Daily Marketplace contact resolution

### 5.1 Scheduler

Reuse `workers/cron-aggregate`, which already runs daily at 02:00 UTC and binds the shared D1 database.

The Marketplace refresh runs as an isolated step:

- its failure is caught and recorded without preventing existing analytics aggregation and retention;
- it uses the Marketplace bulk license export once per run;
- Marketplace credentials are Worker secrets and never enter Forge, client bundles, source, or D1;
- production deployment and secret creation remain outside unattended implementation.

### 5.2 Machine resolution table

Add `MarketplaceContactResolution`:

| Column | Purpose |
|---|---|
| `clientDomain` primary key | Runtime lookup key |
| `cloudId` | Marketplace/D1 reconciliation |
| `contactEmailCiphertext` | Application-encrypted technical contact email |
| `contactEmailMasked` | Operator-safe display |
| `contactNameCiphertext` | Optional encrypted contact name |
| `classification` | `direct_customer`, `partner`, `uncertain`, `missing` |
| `reasonCodes` | JSON array of machine-readable evidence |
| `sourceLicenseType` | Source/debug context |
| `sourceUpdatedAt` | Marketplace source freshness |
| `refreshedAt` | Successful classifier run |
| `lastSeenAt` | Retention control |

No contact address is returned to the paywall frontend.

### 5.3 Human override table

Add `MarketplaceContactOverride`:

| Column | Purpose |
|---|---|
| `clientDomain` primary key | Tenant |
| `decision` | `approved`, `partner`, `suppress` |
| `replacementEmailCiphertext` | Optional human-selected internal contact |
| `reason` | Audit note |
| `reviewedBy` | Internal operator identifier |
| `updatedAt` | Audit timestamp |
| `expiresAt` | Optional re-review date |

An active human override always wins over the daily machine result and is never overwritten by refresh.

### 5.4 Classification

Use evidence, not a single heuristic:

- Marketplace `partnerDetails` associated with the license;
- technical-contact identity matching partner details;
- a known-reseller domain maintained in private operational data;
- the same contact domain appearing across multiple unrelated customer sites;
- direct-customer evidence such as a unique contact domain and absence of partner signals;
- missing or conflicting source data;
- cache freshness.

Do not use billing contact as the primary candidate. Existing operational evidence shows billing contacts are often resellers. The recipient-facing message calls the person the `registered technical contact`, not a verified site admin.

### 5.5 Hot path

On extension submission:

1. Persist the request and answers with an idempotency key.
2. Resolve contact from an active override, otherwise the daily cache.
3. Auto-outreach only for a fresh `direct_customer` result or an explicit `approved` override.
4. Route `partner`, `uncertain`, `missing`, stale (older than 36 hours), or conflicting results to human review.
5. Accept the user's request even when outreach is held. Contact uncertainty is not a user-facing error.

## 6. JSM-first outreach

JSM owns notification, reply, participant, ticket-history, and approval state.

- Automatic route: create one request and add the requester plus registered technical contact as participants.
- Manual route: create an internal review item with the candidate and evidence; hold external mail until an operator decides.
- Use an idempotency key so retries do not create duplicate JSM requests or duplicate mail.
- A purpose-specific address should be reserved: `extensions@support.zenuml.com`. Connect it as a JSM sender/reply-to when operational setup is approved.
- Resend is not required for v1. It remains an option for later branded transactional messages, not a second source of ticket truth.

The user sees disclosure, not a confirmation gate: `ZenUML will contact your organisation's registered technical or site contact to coordinate access.`

The admin receives only the unblock summary needed to act:

- tenant/space context;
- requested scope;
- urgency;
- requested duration;
- self, space, and site actions.

AI-tool, template, and process-discovery answers remain internal unless the requester explicitly writes them into a shared note.

## 7. Analytics plan — must land before feature code

Production slices add catalog/type registrations as the first commit of each feature branch. Storybook never emits these events.

| Event | Trigger | Key properties |
|---|---|---|
| `paywall_checkout_returned` | Product receives a checkout return without confirmed payment | `feature_area`, `surface`, `action_type`, `checkout_outcome`, `bridge_eligible`, `bridge_already_used` |
| `paywall_bridge_offered` | Eligible unpaid-return state renders | upgrade context, `bridge_days`, `offer_reason` |
| `paywall_bridge_accepted` | User activates the one-time bridge | upgrade context, `bridge_days`, `expires_at_day` (date only) |
| `paywall_bridge_warning_shown` | Day-two warning renders | upgrade context, `days_remaining` |
| `paywall_bridge_expired` | Bridge transitions to expired | upgrade context, `bridge_days` |
| `paywall_extension_flow_started` | User enters W4 | upgrade context, `entry_source`, `attempts_remaining` |
| `paywall_extension_question_answered` | A coded question answer is committed | `question_id`, `step_index`, coded answer fields; no free text |
| `paywall_extension_flow_completed` | User reaches terminal routing | `unblock_scope`, `urgency`, `requested_duration`, coded workflow attributes |
| `paywall_extension_request_submitted` | Intake persistence succeeds/fails | routing-safe context, `outcome`, `unblock_scope`, `urgency`, `requested_duration` |
| `paywall_admin_contact_routed` | Backend chooses automatic or manual routing | `routing_outcome`, non-identifying `reason_codes`, `cache_age_hours`, `override_used` |
| `paywall_admin_outreach_succeeded` | JSM request/participants are created | `routing_outcome`, `jsm_channel`, no issue key or contact identifiers |
| `paywall_admin_outreach_failed` | JSM operation exhausts retries | `failure_stage`, `error_code`, no raw response or identifiers |
| `paywall_payment_confirmation_shown` | Confirmed activation candy renders | `unblock_scope`, `activation_source`, `surface` |

No email address, name, domain, JSM issue key, raw survey answer, or free-form text may enter Mixpanel.

## 8. Error handling and safety

- Marketplace refresh: retain the prior row, mark/report staleness, and route stale results to manual review.
- Encryption/decryption failure: never fall back to plaintext; route manual and alert operationally.
- Extension persistence failure: keep answers client-side long enough to retry; do not claim the request was submitted.
- JSM failure: preserve the internal request with `outreach_pending`/`outreach_failed`; retry idempotently.
- Payment return without license activation: show pending state and poll boundedly; never show the success candy early.
- Storybook: all external functions are inert mocks and reset between stories.
- Client privacy: no real tenant/contact values in public fixtures, docs, screenshots, or test output.

## 9. Testing and evidence

### 9.1 Automated

- Story interaction tests traverse the full route, Back/Next/Reset, direct rail navigation, status badges, and representative branches.
- W1/W2 journey stages assert they contain the real `UpgradePrompt` test IDs.
- W3 tests cover eligibility, one-time use, expiry, and stale/replayed return handling.
- W4 tests cover coded answers, 3:1 candy placement, scope routing, no-price-before-terminal, disclosure, and retry-safe persistence.
- Classifier tests cover direct, partner, known reseller, reused contact domain, missing, conflict, stale, and active override precedence.
- Cron tests prove Marketplace refresh failure does not stop analytics aggregation.
- JSM adapter tests prove idempotency, participant payloads, PII redaction, and failure state transitions.
- `pnpm test:unit`, `pnpm build:lite`, and `pnpm build-storybook` must pass.

### 9.2 UI evidence

Storybook UI is verified in a real browser. Required captures:

- whole lifecycle rail with mixed Implemented/Concept badges;
- real W1/W2 component at 3, 2, 1, and 0 attempts;
- W3 bridge offer, active, warning, and expired states;
- W4 first three questions, first candy, scope/urgency group, second candy, duration/review, terminal routes;
- automatic versus manual contact-routing explanation;
- payment-confirmation candy.

A unit or Storybook interaction test alone cannot mark these UI assertions passed.

### 9.3 External verification boundaries

- Marketplace reads are safe for staging/read-only verification when credentials are preflighted.
- Overnight execution must not send customer email, create JSM tickets, set secrets, deploy production, or merge automatically.
- CI-triggered staging deploys are allowed when the branch pipeline provides them.
- Actual JSM delivery, custom email-domain setup, and production Marketplace refresh are morning-queue items unless an existing isolated staging system can prove them without writing an external tracker.

## 10. Delivery slices

Keep the existing W1/W2 branch coherent. Follow-up production work is split so analytics remains the first commit of each feature branch:

1. **Storybook full journey** — stacked on W1/W2; no production behavior and no analytics emission.
2. **Daily contact resolution cache** — D1 schema, classifier, cron refresh, override/read service, tests.
3. **W4 intake and JSM routing** — analytics first, persistence/API, UI, routing adapter, tests.
4. **W3 checkout bridge** — analytics first, eligibility/persistence/return path/UI, tests.
5. **Payment confirmation candy** — analytics first, activation confirmation and editor return.

If the overnight budget cannot finish all slices, complete them in this order and leave each branch in a reviewable, tested state rather than mixing partially implemented production behavior into W1/W2.

## 11. Explicit non-goals

- No 15–25-step consumer questionnaire.
- No personal shame, failure-history copy, or shared-screen pressure.
- No questionnaire before first value or on the initial paywall impression.
- No blind email to billing contacts.
- No promise that one-day/three-day/one-week access is approved merely because it was requested.
- No Marketplace/JSM credential or contact data in Forge localStorage, client bundles, Storybook, Mixpanel, or source control.
- No production deployment or automatic merge as part of the overnight run.
