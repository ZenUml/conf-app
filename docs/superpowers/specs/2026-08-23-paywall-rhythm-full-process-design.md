# Paywall extension closed loop — seven-day unblock, product learning, and admin outreach

**Date:** 2026-08-23  
**Base:** `feat/paywall-rhythm-enhanced` (W1 + W2)  
**Product classification:** C — B2B embedded plugin. The blocked user is usually doing real work but is not the buyer, so the flow must unblock the user and create a credible path to the site administrator.

## 1. Objective

Build and demonstrate the complete Lite paywall-to-extension process:

1. preserve the existing warning and three metered continues;
2. offer a first, automatic seven-day extension when the user is blocked;
3. collect five short, high-value answers in about one minute;
4. resume editing immediately after the server grants the extension;
5. notify the registered Marketplace technical contact or a reviewed administrator with a branded adoption message;
6. show the whole process in Storybook, with every stage labelled `Implemented` or `Concept` until its production slice lands.

The extension is a procurement and communication buffer, not a permanent free tier. It must solve the immediate interruption without hiding the limit or promising unlimited renewal.

## 2. Product and pricing baseline

- The Lite paywall is scoped by Confluence Space and triggers above 100 ZenUML macros.
- The Enterprise Bundle offer used in this flow is USD 299/year/Space.
- Existing diagrams remain viewable; the blocked action is editing or creating.
- A paid license always outranks an extension. Confluence remains the system of record for diagram bodies.
- The existing W1/W2 rhythm remains the pre-extension buffer: warning, three continues, tiered copy, final-continue commitment, and the space investment mirror.

## 3. Implementation boundary at design time

| Capability | Status | Evidence / intended slice |
|---|---|---|
| Warning banner before the block | Implemented | `PaywallWarningBanner.vue` and stories |
| Three continue attempts and 3/2/1/0 beats | Implemented on W1/W2 branch | `continueAttempts.ts`, `UpgradePrompt.vue` |
| Space investment mirror | Implemented on W1/W2 branch | `UpgradePrompt.vue` |
| Per-space checkout and Marketplace CTA | Implemented | `UpgradePrompt.vue` |
| Existing extension action | Implemented only as a prefilled JSM link | `buildExtensionRequest.ts`; replaced by this design |
| Five-question extension intake | Concept | extension slice |
| Automatic first seven-day user+Space grant | Concept | extension slice |
| Daily Marketplace contact resolution | Concept | contact-cache slice |
| Branded direct admin email through Resend | Concept | notification slice |
| Expiry reminder and repeat-request handling | Concept | lifecycle slice |

Storybook must preserve these labels. `Implemented` means a stage uses production-backed behavior; `Concept` means an inert local fixture with no external side effect.

## 4. User journey

### 4.1 Entry

1. An over-limit Lite Space shows the existing warning and metered continues.
2. When continues are exhausted, the paywall explains that existing diagrams are safe and offers `Get a 7-day extension` alongside purchase/upgrade paths.
3. Before the questions begin, disclose: `ZenUML will use these answers to arrange temporary access and will notify your organisation's registered technical or site contact.`

The user is not asked to find, confirm, view, or edit the contact email. Contact resolution is ZenUML's responsibility.

### 4.2 Five-question intake

The flow targets one minute. All answers are structured; `not_sure` is available where uncertainty is legitimate.

1. **Current task** — architecture/solution design, design review, technical documentation, incident review, understanding an existing system, team/cross-team communication, or other coded category.
2. **Diagram audience** — self, same development team, architect/Tech Lead, manager/engineering lead, another team, security/platform/governance, or broad documentation readers. This is the primary product-learning question.
3. **AI and diagrams** — which AI coding tools are used and whether they are used to create or maintain Mermaid, ZenUML, or other diagram-as-code. This is one compact conditional step, not an AI survey.
4. **Workflow constraints** — whether a required diagram process or template exists, and whether cloud AI may receive code or related material. Answers are coded, including `not_sure`.
5. **Unblock need** — `self`, `space`, or `site`, plus urgency: `today`, `this_week`, or `planning_ahead`.

The requested scope informs the terminal upgrade path and administrator message. It does not broaden the first temporary grant beyond the authenticated requester in the current Space.

### 4.3 Grant and resume

1. The backend authenticates the requester and validates the Space and paywall state.
2. The request and coded answers are persisted with an idempotency key.
3. If the user has never received an automatic extension for this Space, the backend atomically grants exactly seven days.
4. The UI shows the exact expiry date/time, confirms the current Space, and returns directly to editing.
5. Concurrent or replayed submissions return the same grant and cannot extend its expiry.

The first-version repeat rule is deliberately conservative: one automatic seven-day grant per user+Space. A later request is accepted and routed for human review, but the UI does not promise another automatic extension. Future data may justify a different second/third-extension policy.

### 4.4 Expiry and paid activation

- Send an appropriate reminder before expiry to the requester and, where routing permits, the administrator. Reminder timing and frequency must be bounded and testable.
- When the grant expires, server-side entitlement checks restore the paywall unless a paid license is active.
- If a paid Space or Site entitlement appears, stop extension reminders and show confirmed activation only after a positive license read.

## 5. Storybook journey

Use a persistent journey rail plus one focused stage. The groups are:

1. `Paywall` — warning and real W1/W2 3/2/1/0 states.
2. `Extension intake` — disclosure and five questions.
3. `Granted` — exact seven-day expiry and return-to-editor state.
4. `Admin outreach` — automatic versus manual contact routing and branded email preview.
5. `Expiry / repeat` — reminder, expired, and manual-review repeat request.
6. `Upgrade` — Space checkout, Site Marketplace path, and confirmed paid activation.

Each stage includes a visible `Implemented` or `Concept` badge and a short explanation. Controls include `Back`, `Next`, `Reset`, and direct stage navigation.

- W1/W2 stages reuse the real `UpgradePrompt` and existing mocks.
- Concept stages are story-only components or fixtures imported by `*.stories.ts`.
- No story calls Stripe, Marketplace, Resend, JSM, Forge, D1, support, or Mixpanel.
- All tenants, users, Spaces, pages, and email addresses are placeholders.
- An inventory panel tells reviewers what is implemented and what is not.

## 6. Persistence and entitlement model

### 6.1 Extension request

Add a `PaywallExtensionRequest` record containing operational identifiers, not diagram content:

- request/idempotency identifier;
- authenticated account identifier, tenant/cloud identifier, and Space key/id;
- macro count and paywall state at request time;
- coded answers to the five questions;
- requested unblock scope and urgency;
- request state, timestamps, and routing outcome;
- link to the resulting grant, if any.

### 6.2 Extension grant

Add a `PaywallExtensionGrant` record with:

- requester + Space uniqueness for the first automatic grant;
- `grantedAt`, `expiresAt`, reason, and status;
- source request and audit timestamps;
- no client-controlled expiry.

The entitlement check is server authoritative. It returns only the minimum grant state required by the frontend. An active paid entitlement wins; an active matching user+Space grant temporarily permits editing; an expired or mismatched grant does not.

## 7. Daily Marketplace contact resolution

Reuse the daily backend schedule to precompute contact resolution in D1. Extension submission must not wait on Marketplace.

### 7.1 Machine cache

`MarketplaceContactResolution` stores:

- tenant lookup identifiers;
- encrypted technical-contact email and optional name;
- masked operator display;
- `direct_customer`, `partner`, `uncertain`, or `missing` classification;
- machine-readable reason codes and source freshness;
- refresh/last-seen timestamps.

The paywall frontend never receives the contact address.

### 7.2 Human override

`MarketplaceContactOverride` stores an operator decision (`approved`, `partner`, `suppress`), optional encrypted replacement contact, audit reason/operator, and optional expiry. An active override wins and is never overwritten by refresh.

### 7.3 Routing rules

- Use Marketplace partner details, contact/domain reuse, known-reseller operational data, conflicting/missing data, and freshness together; do not trust one heuristic.
- Do not use billing contact as the primary candidate.
- Fresh `direct_customer` or approved override can receive automatic notification.
- Partner, uncertain, missing, conflicting, or stale results go to human review.
- Contact uncertainty never blocks the user's first eligible extension.

## 8. Administrator notification — Resend first

The external administrator notification is a ZenUML-branded transactional email, not a JSM participant update.

- Keep Google Workspace for primary mailboxes, inbound replies, and Google identity.
- Use Resend's transactional API for programmatic sending and delivery events.
- Keep DNS with Cloudflare and add only the required SPF, DKIM, and DMARC records when operationally approved.
- Initial sender candidate: `notifications@zenuml.com`; use a monitored Google Workspace address as Reply-To.
- JSM may record an internal support/audit item or manual-review task, but JSM is not a prerequisite for the recipient notification.
- MXroute and a Google Workspace migration are outside this feature.

The message frames the event as active adoption:

- the Space has passed 100 macros and has sustained use;
- a team member needed uninterrupted editing and received seven days;
- start/end time and approximate macro count;
- requested scope and urgency, without exposing private research answers;
- USD 299/year/Space Enterprise Bundle and a clear purchase/contact path.

Do not characterize the requester as violating a policy. Do not include AI-tool, cloud-policy, template, or audience answers in the administrator email unless a later explicit product decision permits it.

### 8.1 Delivery correlation

Store an internal notification identifier, provider message identifier, template/version, request/grant link, routing state, and timestamps. Resend webhook handling must verify authenticity, be idempotent under replay, and map delivered/clicked/failed events to the internal record. Provider identifiers and recipient PII do not enter Mixpanel.

## 9. Analytics plan — must land before feature behavior

Use existing `paywall_triggered` and current checkout/Marketplace CTA events where their semantics already match. Register the complete extension-program event vocabulary in `src/utils/analytics/catalog.ts` and `src/utils/analytics/types.ts` as the first production-feature commit:

| Event | Trigger | Key properties |
|---|---|---|
| `paywall_extension_started` | User enters the intake | `feature_area`, `surface`, `entry_source`, `attempts_remaining` |
| `paywall_extension_question_answered` | A coded answer is committed | `question_id`, `step_index`, coded answer fields only |
| `paywall_extension_granted` | Backend creates or returns the eligible first grant | `outcome`, `scope`, `urgency`, `extension_days`, `is_replay` |
| `paywall_extension_repeat_requested` | An ineligible repeat is accepted for review | `scope`, `urgency`, `prior_grant_count`, `routing_outcome` |
| `paywall_extension_expiring` | Bounded pre-expiry reminder becomes due/shown | `days_remaining`, `channel`, `scope` |
| `paywall_extension_expired` | Grant crosses its expiry | `extension_days`, `paid_entitlement_active` |
| `paywall_admin_contact_routed` | Resolver chooses automatic/manual/suppressed | `routing_outcome`, non-identifying `reason_codes`, `cache_age_hours`, `override_used` |
| `paywall_admin_notification_sent` | Provider accepts the email | `template_version`, `routing_outcome`, `attempt_number` |
| `paywall_admin_notification_delivered` | Verified provider event reports delivery | `template_version`, `delivery_latency_bucket` |
| `paywall_admin_notification_clicked` | Verified provider event reports CTA click | `template_version`, `cta_kind` |
| `paywall_admin_notification_failed` | Send or delivery exhausts retries | `failure_stage`, stable `error_code`, `attempt_number` |

No email, name, tenant/domain, account ID, provider message ID, raw/free-form answer, or questionnaire text enters Mixpanel.

## 10. Success measures

- paywall reach by site/Space;
- intake start/completion and first-grant rate;
- continued editing after grant;
- first versus repeat extension distribution;
- administrator delivery, click, and reply rates;
- extension-to-upgrade conversion and time-to-upgrade;
- correlations between coded task/audience/AI/workflow answers and outcomes;
- support volume, complaints, and apparent abandonment after the paywall.

These form a lightweight conversion view; a full CRM is not required for version one.

## 11. Errors, privacy, and operational safety

- Persist the request before notification. A notification failure never revokes an eligible grant.
- Marketplace refresh failure retains the prior record, marks it stale, and routes new outreach to review.
- Encryption failure never falls back to plaintext.
- Resend failure records a retryable state with redacted logs; retries are bounded and idempotent.
- Contact and survey data stay in operational storage with explicit retention, access, and deletion rules.
- No real tenant/contact data appears in public fixtures, source, screenshots, test output, or Storybook.
- Never claim activation or delivery until the authoritative entitlement/provider state confirms it.

## 12. Verification

### Automated

- Story interactions traverse every group, navigation control, status badge, and representative branch.
- Real W1/W2 stages expose the existing `UpgradePrompt` test IDs.
- Intake tests cover five-question order, coded answers, back navigation, disclosure, and no premature price.
- Grant tests cover authentication, one automatic grant per user+Space, exact seven-day expiry, concurrency, replay, mismatch, expiry, and paid-license precedence.
- Contact tests cover direct, partner/reseller, reuse, missing, conflict, stale, and override precedence.
- Scheduler failure injection proves contact refresh cannot stop existing scheduled work.
- Resend adapter and webhook contract tests cover redaction, authenticity, replay, idempotency, retries, delivery, click, and failure states without a live send.
- Public routes are allowlisted in `public/_routes.json`, authenticated, input-validated, and return JSON rather than Pages HTML.
- Targeted tests, full unit suite, `pnpm build:lite`, and `pnpm build-storybook` pass.

### UI evidence

Use a real browser against local Storybook and capture:

- full rail with mixed `Implemented`/`Concept` stages;
- real W1/W2 3/2/1/0 states;
- all five questions and disclosure;
- automatic grant, exact expiry, and editor return;
- automatic/manual administrator-routing and branded email previews;
- reminder, expiry, repeat/manual-review, and paid activation states.

Tests alone cannot mark these UI assertions passed.

### Unattended boundaries

No overnight run may send customer email, create JSM tickets, change DNS/mail configuration, set external secrets, perform paid checkout, deploy production, or merge. These remain explicitly unverified until an approved isolated environment or morning operator action supplies evidence.

## 13. Delivery order

1. Revise the interactive Storybook journey to this seven-day process.
2. On a production-feature branch, make the analytics catalog/types the first commit.
3. Implement the five-question request, D1 request/grant records, atomic first seven-day grant, server-side entitlement, and editor return.
4. Implement the daily Marketplace contact cache, classifier, overrides, and hot-path resolver.
5. Implement the Resend adapter, branded template, internal notification records, and verified webhooks with all external calls mocked.
6. Implement bounded expiry reminders, expiry handling, repeat-to-manual routing, and confirmed paid-activation closure.

If the available budget cannot finish every slice, leave completed work reviewable and tested in this order. Never mix a partially enforced grant path into production UI.

## 14. Superseded ideas and explicit non-goals

- No separate one-time three-day abandoned-checkout bridge in phase one; the seven-day extension is the deliberate unblock mechanism.
- No eight-question flow; use five compact questions.
- No JSM participant dependency for administrator notification.
- No user confirmation or editing of the resolved administrator email.
- No automatic Space-wide or Site-wide temporary entitlement in phase one; the first grant is user+Space.
- No guaranteed repeated automatic extension; repeats enter review until evidence supports a new rule.
- No Google Workspace migration, MXroute migration, DNS changes, or live Resend setup in unattended implementation.
- No personal shame, violation language, failure-history copy, or shared-screen pressure.
- No contact PII, raw survey answers, or diagram content in analytics.
