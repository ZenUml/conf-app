# Paywall Extension Flow Phased Implementation Plan

Date: 2026-05-31
Last updated: 2026-06-02 (Phase 3 reworked from in-app editor banner to Forge page banner)

## Context

Lite tenants on the CSS paywall can currently continue without upgrading after hitting the space diagram limit. A pilot tenant shows high Mermaid activity, broad viewing, concentrated editing, and repeated paywall friction. We want to convert this friction into support/admin/upgrade intent without abruptly blocking active work.

The first release should not depend on Space Admin validation. Anyone can request an extension through Jira Service Desk. Space Admin targeting can improve copy and routing later.

## Product Rules

- Each user gets 15 continue attempts per space after the space reaches the hard limit.
- Attempts do not reset automatically.
- An active license or support-granted extension unlocks the whole space, so remaining attempts no longer matter.
- For v1, remaining attempts are localStorage-based friction, not authoritative entitlement. This is acceptable for B2B rollout because the goal is to stop casual infinite dismissal and create support/admin intent. If gaming becomes visible, move attempt state to backend.
- Local storage must not control entitlement, license, or support-granted extension state.
- The paywall warning banner must not compete with the CSAT banner. Only one banner-class surface should be visible. (Both are now `confluence:pageBanner` modules, so this coordination is implemented in Phase 3 — see CSAT coordination there.)

## Phase 1: Request Extension CTA

Goal: add the conversion path without changing paywall enforcement.

- Add `Request extension` to the existing paywall modal.
- Open the Jira Service Desk request link in a new tab.
- Generate request text for the user to paste into the form.
- Copy request text to clipboard when possible; otherwise show a copy action.
- Keep the current `Continue without upgrading` behavior unchanged.
- Track `extension_request_clicked`.
- Roll out behind a feature flag.

Request content should include:

- client domain
- space key
- macro count and limit
- user account ID
- page ID
- macro type
- product type and app version
- short reason: the space reached the Lite diagram limit and needs a temporary editing extension while the team reviews upgrade options

## Phase 2: 15 Continue Attempts

Goal: stop infinite dismissal while preserving a reasonable grace path. In v1 this is intentional product friction, not strict enforcement.

- Store attempt state in localStorage per `clientDomain + spaceKey + userAccountId`.
- Default remaining attempts to 15 when the user first hits the hard limit.
- Decrement only when the user chooses continue.
- Show the count inline on the continue action: `Continue editing without upgrading (15)`.
- Explain the meaning via tooltip/focus title: `You have 15 temporary continue attempts left before editing is blocked for you in this space.`
- At 0 attempts, remove `Continue without upgrading` and show `Request extension to continue editing`.
- Keep `Request extension`, `Copy message for admin`, and upgrade actions visible.
- Ignore local attempt limits if the space has an active license or support-granted extension.
- If localStorage is unavailable or corrupted, default to 15 remaining attempts rather than blocking.
- Track `paywall_continue_used` and `paywall_attempts_exhausted`, including `storage_source: "local_storage"`.

LocalStorage key:

- `paywallContinueAttempts:<clientDomain>:<spaceKey>:<userAccountId>`

State fields:

- `remainingAttempts`
- `firstTriggeredAt`
- `lastUsedAt`
- `exhaustedAt`

Backend responsibilities remain:

- Determine whether the space is paid.
- Determine whether support has granted an extension.
- Unlock the whole space when paid or extended.

Future escalation:

- If analytics or support signals show users gaming localStorage, replace the local attempt store with backend/D1 state using the same key dimensions.

## Phase 3: Paywall Warning Page Banner

Goal: warn active editors before the hard modal interrupts editing, by reaching them **while they browse the space — before they open the editor.**

**Surface decision (reversal of the original plan).** This phase uses a Confluence **Forge page banner** (`confluence:pageBanner` module), reusing the CSAT banner infrastructure, **not** an in-app banner inside the macro/editor surface. The earlier plan specified an in-app editor banner and listed a page banner as a non-goal "unless the in-app banner proves insufficient." It has: an in-editor banner only fires *after* the user has already opened the editor and committed to editing, which is too late to be a warning. The target — the person who edits diagrams but usually cannot buy a license — needs to be reached while viewing.

Detailed implementation design: `docs/superpowers/specs/2026-06-02-paywall-page-banner-design.md`.

### Targeting (localStorage, no backend call on the banner path)

- When a ZenUML macro renders (viewer or editor), `useCustomerSuccessService` writes a per-space marker:
  `paywallWarning:<clientDomain>:<spaceKey>:<userAccountId>` = `{ severity, macroCount, spacePaid, updatedAt }`.
- The page banner reads that marker on later page loads (cross-load signal, same pattern as CSAT's `csatPending`) and decides visibility with no backend call.
- **Scope is space-wide** — every page in a warning-zone space, not per-page. The audience has already encountered the paywall, so a space-wide reminder is not a surprising nag, and per-page relevance filtering is not worth its cost.

### Eligibility

Show iff all of:

- space has 85–99 diagrams (the warning band; 100+ remains the hard modal's job, not the banner)
- the user has rendered a ZenUML macro in the space (captured by the marker)
- the space is not paid/extended (`spacePaid === false`)
- the user has not dismissed within the current suppression window

Do not require Space Admin detection in v1.

### Dismissal (pulled forward from Phase 4 — a page banner cannot ship without persistent dismissal)

- **Snooze, not kill.** Dismiss `×` → quiet for **7 days**, then the banner returns because the underlying problem is unchanged.
- **CTA clicks do not change suppression.** A user who clicked Request extension but is still pending keeps seeing the banner until it is granted or they explicitly dismiss.
- The only thing that truly clears the banner is the space becoming licensed/extended (reflected as `spacePaid`/`severity` in the targeting marker), never a user click.
- Dismissal state: `paywallBanner:<clientDomain>:<spaceKey>:<userAccountId>` = `{ dismissedAt, lastShownAt, showCount }`.
- Not doing: a "dismiss forever" option, or a dismissal-reason survey.

### Copy (neutral, reassuring — the user is not blocked yet)

- `This space is approaching the ZenUML Lite diagram limit (N of 100). Editing may be disabled soon. Existing diagrams still render.`

### CTAs (exactly two + dismiss)

- `Request extension` (primary) — opens Jira Service Desk + copies request text; self-serve relief and a qualified lead.
- `Copy admin message` (secondary) — copies advocacy text to forward to a space admin; the revenue path.
- Dismiss `×` (7-day snooze).
- No `Upgrade` button — most editors cannot complete an upgrade, so it dead-ends; the Upgrade CTA already lives in the paywall modal for when they try to edit.

### CSAT coordination (required — the warning is now itself a page banner)

The warning banner and the CSAT banner are both `confluence:pageBanner` modules. To keep only one banner-class surface visible, the **CSAT route defers to the paywall banner**: if the paywall banner is eligible for this space/user, CSAT `view.close()`s for that load.

### Analytics

Track `paywall_banner_shown` and `paywall_banner_dismissed`, plus `advocacy_message_copied` and `extension_request_clicked` from this surface, all with `surface: "page_banner"`.

## Phase 4: Remaining Banner Fatigue And Priority

Note: the core localStorage dismissal, the 7-day (85–99) suppression window, and paywall>CSAT priority were **pulled forward into Phase 3**, because a page banner cannot ship without persistent dismissal and the two page banners collide immediately. Phase 4 now covers what remains.

Goal: finish fatigue handling and the full banner-priority order.

- 100+ band: shorter **24-hour** suppression window (applies once a 100+ banner band is in scope; Phase 3 ships the 85–99 band only).
- Attempts exhausted: do not rely on banner dismissal; the paywall modal/gate controls required action.
- Multi-show fatigue: use `showCount` / `lastShownAt` to taper repeated displays.
- Full banner priority order:
  1. restore/recovery banners
  2. paywall warning banner
  3. CSAT feedback banner
  (paywall > CSAT is implemented in Phase 3; fold in restore/recovery precedence here.)
- Keep dismissal windows tunable from data (see Phase 6).

## Phase 5: Space Admin Personalization

Goal: improve targeting after the core flow is live.

- Add current-user Space Admin validation using the existing `SpaceAdminResolver`.
- Do not rely only on `space_admin_count`; that telemetry proves admins exist but does not identify whether the current user is one.
- Track `is_space_admin` on banner/modal events.
- Personalize copy:
  - Space Admin: `Request an extension or upgrade this space to keep editing available.`
  - Non-admin: `Request help from support or ask a space admin to upgrade this space.`
- Consider showing the banner earlier or more prominently to validated Space Admins.

## Phase 6: Operational Rollout

Goal: validate conversion without causing accidental churn.

- Enable for a small CSS cohort first, with the pilot tenant as the primary candidate.
- Monitor:
  - support ticket volume
  - `extension_request_clicked`
  - `admin_message_copied`
  - attempt exhaustion
  - save volume before and after rollout
  - paywall continued-editing rate
  - advocacy copy rate
- Tune:
  - attempt count
  - dismissal windows
  - warning threshold
  - CTA ordering
  - copy

## Non-Goals For First Release

- No automatic extension approval.
- No procurement-owner discovery.
- No hard dependency on Space Admin validation.
- ~~No global Forge page banner unless in-app banner proves insufficient.~~ **Resolved in Phase 3:** the in-app editor banner proved insufficient (it only fires after editing begins), so the warning is now a Forge page banner.
- No per-page relevance filtering for the page banner — space-wide is intentional (the audience has already hit the paywall).
- No CTA-click-based suppression — only an explicit dismiss snoozes.
- No `critical` (100+) page banner in Phase 3 — the hard modal owns that band.
- No weekly reset of attempts.
- No authoritative backend attempt counter in v1.
