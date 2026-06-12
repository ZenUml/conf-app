# Mixpanel session-replay sampling (Forge feature flags)

The session-replay sampling rate is controlled **live from the Forge Developer
Console** — there is no hardcoded percentage in the repo. Two boolean flags
resolve into `record_sessions_percent` at `mixpanel.init` time.

Code: `src/utils/analytics/sessionReplayFlags.ts` (resolves the flags),
wired in `src/utils/analytics/trackAnalyticsEvent.ts` (`_initMixpanel`).

## Why feature flags

Session replay is metered (target budget **20K replays/month**). We need two
controls that work *without a deploy*:

1. **Full inspection of one customer, any time** — capture 100% of a specific
   tenant's sessions for debugging.
2. **Throttle when near the limit** — significantly reduce the general sampling
   rate as the monthly cap approaches.

## The two flags

| Flag | Console control | Effect |
|---|---|---|
| `session-replay-full` | **Targeting rule** — add the customer's install (`installContext`) | 100% capture for that tenant (Goal 1) |
| `session-replay` | **Percentage rollout** — the rollout % *is* the live general rate | Bucketed cohort records at 100%, so rollout 2% ≈ 2% of users fully recorded (Goal 2) |

Resolution (precedence) in `getSessionReplayConfig`:

```
isPageBanner                ? 0      // banner iframe never records; flag fetch skipped
: checkFlag('session-replay-full') ? 100   // targeted customer wins
: checkFlag('session-replay')      ? 100   // general rollout cohort
:                             0      // off
```

`session-replay-full` is checked first, so a targeted inspection keeps recording
even while the general rate is dialed down.

## Operating it

- **Inspect a customer**: add their install to `session-replay-full` targeting →
  100% capture. Remove it when done.
- **Throttle near the limit**: drag `session-replay`'s rollout % down (2% →
  0.5% → 0). No deploy.
- **"Global 0 → targeted 0"** is **not automatic**: a boolean flag cannot
  distinguish "0% rollout" from "not in the cohort" (both return `false`), so
  dragging `session-replay` to 0 does not stop a targeted inspection. When you
  throttle to zero, **also disable `session-replay-full`** in the same console
  visit. (A fully-automatic version would need a third master flag.)

## Per-app setup

Lite / full / diagramly are **separate Forge apps** — create **both** flags in
**each** app's Developer Console (3 apps × 2 flags). Until a flag exists it
evaluates to `false` (fail-closed → 0%), so missing flags simply mean "no
replay", never an error.

## Sampling semantics & caveats

- The rollout-% model is **per-user bucketed** (server-side, by `accountId`),
  not per-session random. Volume therefore depends on *which* users land in the
  cohort, and since activity is skewed (a few power tenants dominate), monthly
  volume is **lumpy** — fine for a rate you retune while watching the usage
  counter, less so for set-and-forget. The targeted customer is exempt from this
  (its own flag, always 100%).
- Fail-closed everywhere: standalone/non-Forge dev (no `cloudId`), bridge
  errors, and absent flags all → 0%.
- Zero Forge GB-seconds: the `@forge/bridge` `FeatureFlags` client evaluates
  through the bridge config download, not a Forge Function.

## Verification

Every event is stamped with super-properties `session_replay_percent` (the
resolved number) and `session_replay_source` (`targeted` | `sampled` | `off`),
so the throttle and targeting can be confirmed live in Mixpanel.
