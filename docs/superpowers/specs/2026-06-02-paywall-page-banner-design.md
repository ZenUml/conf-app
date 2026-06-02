# Paywall Warning — Page Banner Redesign

Date: 2026-06-02
Branch: `feat/paywall-page-banner` (from `main`, not stacked on `feat/paywall-phase3-warning-banner`)
Relationship: detailed implementation design for **Phase 3** of `2026-05-31-paywall-extension-flow-plan.md` (that plan has been reconciled to match this page-banner decision)

## Problem

The shipped Phase 3 banner (`feat/paywall-phase3-warning-banner`) mounts `PaywallWarningBanner` inside the **editor** (`Workspace.vue`). It only appears once the user has already opened the editor — i.e. once they have already committed to editing. A warning that fires *after* the user starts editing is too late to be a warning.

The target user is **the person who edits diagrams** in a Lite space that is approaching its limit. That user usually cannot buy a license themselves; the banner's job is to convert their friction into action by someone who can (request a support extension, or forward an upgrade ask to a space admin). To do that, the warning must reach them **while they are browsing the space — before they open the editor**.

A Confluence **page banner** reaches the user on normal page views, with no editor open. That is the surface this redesign moves to.

## Spec reversal (deliberate)

The earlier plan said, in Phase 3:

> "Use an in-app banner inside the macro/editor surface, **not** a global Forge page banner." (line 83)
> "No global Forge page banner unless in-app banner proves insufficient." (line 165)

This design reverses that. The in-app editor banner *is* insufficient, for the reason above: it only fires after editing begins. The "unless in-app banner proves insufficient" escape hatch in the original plan is exactly the condition we have hit. The page banner is the correct surface.

## Audience assumption

Every tenant we are targeting has **already encountered the paywall**. A space-wide reminder is therefore not a surprising nag — they know the situation. This justifies the simplest scoping (show on every page in a warning-zone space) rather than per-page relevance filtering.

## Architecture

Reuse the existing CSAT page-banner infrastructure verbatim. Two sides, coordinated only through CDN-origin `localStorage` (the same origin both the macro iframe and the page-banner iframe load from).

```
WRITE side — runs when a ZenUML macro renders (viewer OR editor), any page in the space
  useCustomerSuccessService.refresh()
    → already fetches /api/space-status + macro count, already computes `severity`
    → NEW: persist a per-space targeting marker (see schema below)

READ side — runs on EVERY Confluence page load (page-banner module mounts globally)
  forgeIndex.ts: if moduleKey === 'zenuml-paywall-warning-banner'
    → read the targeting marker + the dismissal marker from localStorage (NO backend call)
    → view.close() unless the visibility gate passes
    → otherwise mount PaywallWarningBanner.vue
```

No backend call on the banner path. Visibility is decided purely from `localStorage`, exactly like CSAT's `csatPending` fast-exit. The marker is populated as a side effect of normal macro rendering and read on a later page load (cross-load signal, same pattern as CSAT).

### Why two single-writer markers (not one)

The targeting fields are written by the **macro** iframe; the dismissal fields are written by the **banner** iframe. If both lived in one key, concurrent read-modify-write from two iframes could clobber each other. Each key therefore has exactly one writer:

**Targeting marker** — written only by `useCustomerSuccessService` (macro render):
```
paywallWarning:<clientDomain>:<spaceKey>:<accountId>
{
  "severity": "none" | "warning" | "critical",
  "macroCount": 90,
  "spacePaid": false,
  "updatedAt": "2026-06-02T00:00:00.000Z"
}
```
When the computed severity drops below warning (count < 85) or the space becomes paid, the writer sets `severity: "none"` so the banner stops.

**Dismissal marker** — written only by the banner (show / dismiss):
```
paywallBanner:<clientDomain>:<spaceKey>:<accountId>
{
  "dismissedAt": "2026-06-02T00:00:00.000Z" | null,
  "lastShownAt": "2026-06-02T00:00:00.000Z",
  "showCount": 1
}
```

Both keys reuse the `clientDomain:spaceKey:accountId` shape and the `normalizeKeyPart` (encodeURIComponent + `'unknown'` fallback) helper already established in `src/utils/paywall/continueAttempts.ts`. Extract a shared key-builder so the macro-side write and the banner-side read derive identical keys.

### Visibility gate (read side)

Show the banner iff **all** of:
1. targeting marker exists and `severity === "warning"` (85–99 — Phase 3 scope)
2. `spacePaid === false`
3. not dismissed within the suppression window: `dismissedAt` is null, or `now - dismissedAt > 7 days`

Otherwise `view.close()` immediately (no Vue mount, no analytics) — same inactive-path discipline as CSAT.

On show: set `lastShownAt = now`, increment `showCount`, fire `paywall_banner_shown`.

`critical` (100+) is intentionally out of scope here — that remains the hard paywall modal's job. The page banner never competes with the modal.

## Dismissal model (decided)

**Snooze, not kill.** Dismiss `×` → quiet for **7 days** (the Phase 4 window for the 85–99 band), then the banner returns because the underlying problem is unchanged. The only thing that *truly* clears the banner is the space becoming licensed or extended (reflected as `spacePaid`/severity in the targeting marker) — i.e. the problem actually being solved, never a user click.

**CTA clicks do not change suppression** (the chosen option). A user who clicked "Request extension" but is still pending keeps seeing the banner until either it is granted (marker flips → banner stops) or they explicitly dismiss. Rationale: simplest model; CTA-clickers who did not complete the flow should still be reminded. Windows are explicitly tunable later with data (original plan Phase 6).

Explicitly **not** doing: a "dismiss forever" option (kills the nudge while the problem is unsolved), or a dismissal-reason survey (friction, near-zero v1 value — intent is read from CTA click-through and dismiss rates).

## Actions / CTAs

A non-buyer editor has exactly two viable levers; keep exactly those two plus dismiss:

| CTA | Behaviour | Why |
|---|---|---|
| **Request extension** (primary, filled) | Opens Jira Service Desk + copies request text | Self-serve, immediate relief, low commitment — and a qualified lead (captures space + user + intent) |
| **Copy admin message** (secondary, ghost) | Copies advocacy text to forward to a space admin | The actual revenue path — escalates to whoever owns the purchase |
| **Dismiss `×`** | 7-day snooze (see above) | Respect the user without losing the nudge |

No "Upgrade" button here — most editors cannot complete an upgrade, so it dead-ends; the Upgrade CTA already lives in the paywall *modal* for when they actually try to edit. Action density is capped at one primary + one secondary + dismiss to avoid choice paralysis.

**Reassurance copy is retained** ("existing diagrams still render"). At 85–99 the user is not blocked; the failure mode is panic ("did my diagrams break?"). Stating nothing is broken yet preserves trust during the nudge.

These map to the CTAs and analytics already built in `PaywallWarningBanner.vue`; the component is reused.

## CSAT collision (new, must handle)

The warning banner and the CSAT banner are now **both** `confluence:pageBanner` modules, so on a load where both are eligible we would stack two banners — violating the original plan's "only one banner-class surface should be visible" (line 18) and Phase 4's priority order (paywall > CSAT).

Coordination: the **CSAT route defers to the paywall banner**. Before mounting, `csatBanner` checks the paywall visibility gate (same `localStorage` read); if the paywall banner would show for this space/user, CSAT calls `view.close()` for this load. The paywall route does not need to know about CSAT. This is a required part of *this* change because moving the warning to a page banner is what introduces the collision.

## Component & file changes

- **Reuse** `PaywallWarningBanner.vue` (re-created on this clean branch). Replace its in-memory `dismissed` ref with reads/writes against the `paywallBanner:` dismissal marker, and gate visibility on the markers rather than on `useCustomerSuccessService` reactive state (the page-banner iframe has no live macro context).
- **New** `src/routes/paywallBanner.ts` — mirrors `src/routes/csatBanner.ts`: init context, mount the component.
- **New** shared marker module `src/utils/paywall/warningBanner.ts` — key-builder + read/write/parse helpers for both markers, mirroring `continueAttempts.ts` (defensive parse, best-effort write).
- **Edit** `src/forgeIndex.ts` — add a `moduleKey === 'zenuml-paywall-warning-banner'` branch with the fast-exit gate, ahead of the generic macro path (mirror the CSAT branch).
- **Edit** `src/routes/csatBanner.ts` (or its forgeIndex branch) — add the paywall-defers check.
- **Edit** `src/composables/useCustomerSuccessService.ts` — after computing severity, write the targeting marker (and clear it when below warning / paid).
- **Edit** `manifest.yml` — add a second `confluence:pageBanner` entry: `key: zenuml-paywall-warning-banner`, `resource: main`.

## Analytics (plan first, per repo rule)

Reuse the existing events; add a property to distinguish placement from the old editor banner:

- `paywall_banner_shown` — on gate pass / mount
- `paywall_banner_dismissed` — on `×`
- `advocacy_message_copied` — on "Copy admin message"
- `extension_request_clicked` — on "Request extension"

Add property `surface: 'page_banner'` (replacing the editor banner's `ui_component: 'banner'`) so page-banner performance is separable in Mixpanel. Register any new property in `src/utils/analytics/types.ts`; event names already exist in `catalog.ts`. Per repo rule, the analytics edit is the **first commit** of the implementation.

## Edge cases & risks

- **Identity availability in the page-banner context** — the gate needs `clientDomain`, `spaceKey`, `accountId` from the `pageBanner` Forge context. CSAT proves domain + account are available; **`spaceKey` from the page-banner context must be verified** during implementation. If unavailable, fall back to a domain+account-scoped marker (coarser, still per-tenant-per-user).
- **Identity derivation must match across iframes** — the macro-side write and banner-side read must produce identical keys. Mitigated by the shared key-builder.
- **Staleness** — the targeting marker reflects the *last* macro render in the space; it can lag the true count. Acceptable for v1 (the original plan accepts localStorage as non-authoritative friction). It refreshes on the next macro render.
- **First-ever visit** — before any macro renders in the space there is no marker, so no banner. Acceptable: the target is repeat users who have already hit the paywall.
- **localStorage unavailable/corrupt** — fail closed (no banner) on the read side; best-effort, swallow on the write side. Never throw into the page-banner path.

## Testing strategy

- **Unit** — marker key-builder, parse/round-trip, and the visibility gate (warning shows; none/critical/paid/within-window all close) in `src/utils/paywall/warningBanner.spec.ts`. Component test for dismiss → writes `dismissedAt`; CTA clicks → no suppression change.
- **Unit** — CSAT defers when paywall is eligible.
- **Spot check (lite-stg)** — set the targeting marker in CDN-origin localStorage (per the spot-check skill's iframe-frame recipe), load a plain page in the space, assert the page banner shows; dismiss → reload → gone; reload after window math → returns. Assert it does **not** appear on a page-load where `severity` is `none`.

## Non-goals (v1)

- No Space Admin detection / personalized copy (original plan Phase 5).
- No backend-stored attempt or dismissal state — localStorage only.
- No per-page relevance filtering — space-wide is intentional (audience already knows the paywall).
- No `critical` (100+) banner — the hard modal owns that band.
- No CTA-click-based suppression — only explicit dismiss snoozes.

## Success metrics

- **Convert:** `extension_request_clicked` + `advocacy_message_copied` rates per banner-exposed user.
- **Guardrail:** dismiss rate, especially dismiss-without-any-CTA (the annoyance signal).
- **North star:** warning-zone spaces reaching licensed/extended within N days of first banner exposure.
- **Leakage watch:** raw extension-request volume — if it just becomes a free tier, retune primary CTA / window.
