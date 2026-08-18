# Byline visibility by space properties — As Built

**Status: SHIPPED 2026-08-15** on `claude/byline-review-design-famy9p` (PR #477). Rollout is an
explicit cloudId allowlist. It initially enrolled `lite-stg.atlassian.net` (the E2E target) and
`whimet4.atlassian.net` (dev). On 2026-08-18, `zenuml.atlassian.net` was approved as the first
production enrolment so the production Lite smoke can exercise the byline flow.

The existing Full-presence leg is unchanged: an enrolled space that carries
`zenuml-full-active` still hides the Lite byline. The production smoke space had neither
`zenuml-byline-lite` nor `zenuml-full-active` immediately before enrolment, so the next successful
Lite visibility sweep will make the byline visible there without weakening the both-apps-installed
suppression policy.

**Goal:** Control whether the Lite byline entry (`zenuml-byline-diagrams`) renders, per space,
from Confluence **space properties** read by a manifest `displayConditions` block. Two facts, two
properties: the variant's own enrolment, and the Full app's presence — the Lite byline hides
itself wherever Full already provides its own surfaces.

This replaced a one-day-old plan built on a single **app property** with Full-presence inferred
from D1 — see [Design history](#design-history) for that design and the evidence that killed it.

## The mechanism

**Condition** (`zenuml-byline-diagrams`, manifest.yml) — fail-closed, two legs ANDed:

```yaml
displayConditions:
  and:
    entityPropertyEqualTo:
      entity: space
      propertyKey: zenuml-byline${LITE_KEY_SUFFIX}   # lite → zenuml-byline-lite
      objectName: enabled
      value: "true"
    not:
      entityPropertyExists:
        entity: space
        propertyKey: zenuml-full-active
```

- The enrolment key is **templated per variant** like every other per-variant key in the
  manifest. The runtime writer derives the same key from `getAppContext().appAri.appId`
  (`APP_SPACE_KEY_SUFFIXES` in `src/byline-visibility.ts`) — not `process.env`, for which no
  runtime-reachability evidence exists. `tests/unit/bylineKeyConsistency.spec.ts` pins manifest
  template ↔ forge-wizard suffixes ↔ code resolution; drift in any of the three fails the suite.
- The `not` leg is **Lite-only semantics**. The Full build paths normalize the condition to the
  bare `entityPropertyEqualTo` *before* stripping the module (forge-wizard.mjs, release.yml,
  staging-deploy.yml) — a no-op today that makes a future Full un-strip safe by construction.
  Before Full can ship the module it also needs an enrolment writer for `zenuml-byline`, which
  nothing writes yet.
- `objectName` + object value `{"enabled":"true"}` is the one encoding proven to satisfy
  `entityPropertyEqualTo` here; bare-value string conversion is where the gate failed twice
  (history, below). `value` must stay a **string** — `forge lint` rejects a boolean.

**Leg-1 writer** — `src/byline-visibility.ts`, `byline-visibility-hourly` scheduledTrigger,
Lite-only (stripped from the other variants):

- `decide(cloudId)` is the rollout seam: allowlist today, a Remote-driven enrolment later swaps
  this one function.
- Enrolled → sweep every space (`src/space-properties.ts`: paginated listing, read-first
  idempotent create/update). Suppressed → nothing, **unless** the install isn't known-clean.
- Last-settled state lives in **Forge app storage** (`storage:app`), not in tenant-visible data:
  suppressed steady state costs one storage read and zero Confluence calls; un-enrolment sweeps
  exactly once; unknown state (first tick after deploy) converges with one idempotent sweep.
- Hourly bounds how long a newly enrolled site waits, not the steady-state cost.

**Leg-2 writer** — `src/full-presence.ts`, `full-presence-daily` scheduledTrigger, Full-only.
Marks `zenuml-full-active` on every space where Full is installed. Presence is **self-reported**
— an app writing "I am here" from inside the installation — rather than inferred from D1 (see
history). Daily: presence changes at install cadence, and Full has real production installs.

**Space-property mechanics** — `src/space-properties.ts`, shared by both writers. POST-create vs
versioned PUT-update (`version.number` = current+1) per the documented v2 contract; the listing
throws on a failed page rather than returning a partial list a fail-closed writer would misread
as "settled". Specs run against `src/space-properties.fixtures.ts`, which *models* the
contracts (409 on a wrong version; the app-property body-is-the-value trap) instead of replaying
canned responses.

## Verified, with evidence

| Fact | Evidence |
|---|---|
| `entity: space` supported; `and`/`or`/`not` compose; one property condition per tree level | Forge display-conditions reference, 2026-08-15 |
| The composed condition is valid | `forge lint -e staging`: 0 errors |
| Space properties are site-global across creators (one app's condition can read another app's marker) | v2 space-properties reference: list "returns all properties for the given space"; user-auth REST reads/writes them (unlike app properties) |
| Space-property PUT requires `version.number`, next-in-sequence | v2 reference; enforced in the fixture |
| Absent property hides the module (fail-closed works) | Byline E2E timed out exactly while no property existed; green after the 08:50Z staging sweep wrote them (runs 31876325421, 31877131943) |
| Writer create/idempotence in production | whimet4 09:08Z tick: `spaces=9 created=7 unchanged=2 failed=0` — the 2 manually pre-seeded spaces read as unchanged (byte-identical), the rest created; next tick `unchanged=9` |
| Scopes already granted → minor version | `read:space:confluence`, `write:space:confluence` in manifest.yml |

## Cost model

Enrolled installs: hourly listing + one property GET per space (writes only on drift).
Suppressed installs: one storage read per tick, no Confluence calls. Full installs: daily
listing + one GET per space. The storage marker exists because the suppressed population is the
whole Lite fleet — an hourly per-space sweep there is the GB-seconds profile that has triggered
Forge usage alerts before.

## Open items

- [ ] **Analytics transport.** `byline_visibility_evaluated` / `byline_visibility_write` /
  `full_presence_write` are registered but `console.log`-only — Forge functions have no Mixpanel
  path. Alerting on `write result=failed` (fail-closed means a silent failure = invisible byline)
  depends on this.
- [ ] **Coverage audit before widening the allowlist** (the old Phase 3): compare sweeps against
  `forge install list` before any production tenant is enrolled.
- [ ] **Full uninstall staleness.** Nothing clears `zenuml-full-active` after a Full uninstall
  (no reliable uninstall event exists — history, defect 2), so such a site keeps its Lite byline
  hidden until the marker is cleaned by hand.
- [ ] **Nudge entry composition** (the old Phase 5): `zenuml-byline-newuser` ships in Lite, Full
  and Diagramly keyed on the same global content property, so a both-installed site shows two
  identical items; compose its condition with the enrolment space property and add
  `${LITE_TITLE_SUFFIX}` to its title.
- [ ] **whimet4 byline strip** (the old Phase 6): `deploy-whimet4.yml` keeps only
  `zenuml-byline-diagrams`, deleting `newuser` — real Lite drops only `aiaide` — so the
  activation nudge cannot be validated on whimet4.
- [ ] **Full enrolment writer** for `zenuml-byline`, prerequisite to Full ever un-stripping the
  byline module.

## Design history

**v1 (never shipped): one app property, writer-side suppression.** The original plan (this
file's ancestor — `git log --follow` shows it as
`2026-08-15-byline-visibility-app-property.md`) kept a single `byline-enabled` **app** property;
the manifest carried one positive condition, and the writer computed
`enrolled(cloudId) AND NOT full_present(cloudId)` with Full-presence inferred from D1
`ForgeInstallation` rows under a TTL. Two findings it documented itself argued against the D1
input, and stand:

1. `cloudId` is NULL on 878 of 983 Lite rows (pre-`0009` backfill) — a cloudId join returns
   zero Lite∩Full overlap where a clientDomain join returns 7.
2. No uninstall signal exists: `eventType` only ever holds `avi:forge:installed:app` and
   `backfill`; `avi:forge:upgraded:app` has never produced a row in any app. Presence from D1
   is inference under a TTL, and no release sweep reaches existing installs.

The user directed the space-property design instead: Full self-reports per space, and the
suppression became a manifest leg readable the moment the marker lands.

**The two write-shape failures** (why this doc keeps insisting on encoding):

- The v1 writer PUT `{key, value}` to the app-properties endpoint, which stores the **entire
  request body as the value** — observed on whimet4: readback
  `{"key":"byline-enabled","value":{"key":"byline-enabled","value":"true"}}`, HTTP 200, gate
  silently unmatchable.
- The correction PUT the bare string `"true"`, which the same endpoint **rejects with 400 on
  create** (the v2 reference types the body as `object`); the spike missed it because its
  property already existed, so only the scalar-accepting *update* path ever ran. Observed on
  full-stg (a fresh install): `current status=404` → `write result=failed status=400`.

Both answered 2xx somewhere while the byline stayed hidden — the reason the current writer
read-backs after writing and the specs assert exact request bytes, not "a write happened".

The app property was then briefly the writer's own last-state marker, and is now fully retired:
nothing reads or writes it, and the writer deletes any stored value on its next state
transition.
