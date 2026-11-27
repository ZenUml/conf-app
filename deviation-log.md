# M1 implementation — deviations from the onboarding spec

Branch: `feat/m1-first-seen-ping`. Spec: onboarding-redesign spec §4 M1 (scratchpad, 2026-08-09).

1. **Ping placement: every banner load, not only the `none` path.** Spec text says "on the
   page-banner host's `none` path". Implemented after `maybeProbeSpaceAdmin()` and BEFORE
   `decidePageBanner()`, so the ~1% of loads that show a banner also count toward the census.
   Cost identical (the throttle gates, not the placement); the awaited POST delays a shown
   banner by one request at most once per browser per 30 days.
2. **Backend mapper fix folded in.** The spec claimed an unrecognized event is "dropped
   silently". Reading the code showed `mapForgeUserBehaviorEvent` dereferences
   `event.content.type` unguarded — a content-less POST would 500 (+ Sentry) on every ping and
   put clients into a retry loop. `app_first_seen` branches before any `content` access;
   `content` is now optional in the body type; regression test added
   (`functions/service/forgeUserBehavior.spec.ts`).
3. **`event_source: "forge_frontend"`, not `"forge_trigger"`.** The mapper hardcoded
   `forge_trigger` for its (previously only) webhook callers. This event originates in the
   frontend; analysts split on `event_source` (the `page_viewed` ≠ macro-view lesson).
4. **Kill switch is a backend env var (`FIRST_SEEN_DISABLED=true`), not a Forge flag.** Lite is
   at its 10-flag cap. The disabled response makes clients latch their 30-day marker, so the
   fleet quiets within one page load per browser. Honesty note: CF Pages bakes env at deploy —
   the kill path is env change + backend redeploy, not an instant toggle.
5. **Retry backoff 10 min via attempt stamp** (userCohorts pattern) — the spec did not specify
   failure behavior; without it a broken backend turns 1 ping/30d into 1/page-load.
6. **Unknown client-side domain does NOT skip the ping** (differs from spaceAdminProbe's
   early-return): the server resolves the real domain from the token's `siteUrl`; the client
   domain only keys the throttle marker (`appFirstSeen:unknown`).

## Watched-it-run gaps (AT-RISK #3/#5) — pre-release checks, not covered by unit tests

- The awaited POST actually lands from the banner iframe before `view.close()` (network panel
  + D1 `AtlassianInstance` read-back on lite-dev).
- `accountId` resolved/null ratio on cold banner loads (24h lite-dev observation) — a null read
  skips the marker write by design; if nulls dominate, the census undercounts.

---

# W1+W2 paywall rhythm — deviations from the pitch doc

Branch: `feat/paywall-rhythm-enhanced`. Pitch: claude.ai/code/artifact/431c117e (2026-08-10).
Scope: W1 (counter 15→3, tiered beats, last-continue commitment prompt) + W2 (modal
first-beat investment mirror, pre-CTA framing). W3 (bridge) and W4 (extension flow)
are separate follow-up branches per the pitch's implementation order.

1. **Stored-counter migration: clamp to `min(stored, 3)` on read.** Mid-burn users (e.g.
   6/15 remaining) drop to 3 immediately. Simplest rule that never grants MORE than
   before and avoids a dual-regime window where pre-release browsers keep burning 15.
2. **W2 mirror ships space-level only** (`mirror_level: 'space'`, macro count from the
   existing client-side metric). Personal/team tiers need `/api/user-diagram-stats`
   (D1 `CustomContentVersion.authorId` + `AnalyticsEventFact`) — deferred, not worth
   blocking the copy-level changes.
3. **Post-continue reassurance beat = exhausted-state copy + tooltip softening,** not an
   editor-side toast. The modal unmounts on continue; a toast is a new surface with its
   own lifecycle.
4. **E2E helper `dismissPaywallGate` resets `paywallContinueAttempts:*` before dismissing.**
   At 3 attempts, any spec driving 4+ editor mounts in one browser context exhausts the
   counter mid-test and the Continue button disappears (advisor-flagged CI risk).
   Test-env insulation only; product behavior untouched.
