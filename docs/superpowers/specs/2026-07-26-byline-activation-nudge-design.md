# Byline activation nudge — design

**Status:** design, verified on `lite-dev` (dev env, app 16.130–16.132)
**Date:** 2026-07-26

## Problem

Lite carries 91% of all macro views (888,492 of 975,499 over 90 days) and has **no
activation mechanism at all** — `forge-wizard` strips the demo-page pipeline from
Lite, leaving it Diagramly-only.

The demo page is also unproven: over the same 90 days only **4** `macro_viewed`
events carried `is_demo_page = true`, against 4,601 Diagramly views. That is not
evidence the demo page fails — enrollment is per-space opt-in and clearly almost
nothing was enrolled — it is evidence it was **never run as a programme**. Do not
port it to Lite on the assumption it works.

Its bottleneck is **distribution**: someone must enrol each space. The byline has
distribution by construction — it renders on every content view, and it is already
shipped in Lite, Full and Diagramly (only AsyncAPI strips it).

## Targeting

Not "users who have never created a diagram" — that is nearly every reader of
every Confluence site, most of whom will never need a diagram. Nudging them is
spam, and it never stops, because they never create the diagram that would stop it.

The signal of *need* is the **space**: a team that already uses diagrams has
demonstrated the need; the individual reader simply hasn't started. That is a warm
lead, not a cold one.

```yaml
confluence:contentBylineItem:
  - key: zenuml-byline-newuser
    resource: main
    title: Try ZenUML
    icon: <play-once animated GIF, data: URI ≤255 chars>
    tooltip: Create your first diagram
    viewportSize: fullscreen
    displayConditions:
      entityPropertyExists:
        entity: space
        propertyKey: zenuml-space-uses-diagrams
```

The space property is written by the existing `lite-macro-count-daily` scheduled
trigger, which already performs a full per-space macro inventory once a day. The
marginal cost is one property write per space per day.

## Why there is no per-view compute

Cost is the reason this design exists in this shape.

`dynamicProperties` would let the icon vary per user, but it is **a Forge function
invocation on every content view**. Measured page-view volume from D1
(`DailyBehaviorCounter`, April 2026 — the last full month before the
`avi:confluence:viewed:page` trigger was disabled) was **4,152,322 views/month
across 850 tenants**. Against the 100,000 GB-second/month free tier:

| Assumed duration @512MB | GB-s/month | vs free tier |
|---|---:|---:|
| 100ms | 207,500 | 2.1× |
| 200ms | 415,000 | 4.2× |
| 300ms | 622,500 | 6.2× |

Invocation count is measured; duration and memory are assumptions. Even the
optimistic case exceeds the tier — and this is the exact shape of the incident
already fixed once: `remote-page-behavior-trigger` was ~98% of all invocations and
GB-seconds before PR #234 disabled it.

`displayConditions` are evaluated by the product against stored properties. With no
`dynamicProperties` declared there is **no function to invoke**, so per-view compute
is zero by construction. Cloudflare KV does not help here: the cost is the
invocation, not the storage, and the condition evaluator can only read Confluence
entity properties anyway.

## Verified on lite-dev

| Claim | How |
|---|---|
| Animated GIF animates in the byline | Two screenshots 600ms apart; centre pixel `(0,0,255)` → `(255,0,0)` |
| `loop=1` is honoured — plays once, then rests | Frames at t=0/3/6s all `(0,0,255)`, parked on the final frame |
| `displayConditions` are enforced on `contentBylineItem` | With no properties set, **both** byline items were hidden |
| `entity: space` + `entityPropertyExists` works | Setting the space property made "Try ZenUML" appear with its GIF |
| Sibling conditions = implicit AND | Lint accepts; `and: [ ... ]` array form is **rejected** ("must be object") |
| Two byline items coexist with different conditions | Both declared, each gated independently |
| Scopes already granted | `read:user.property` / `write:user.property` already in `manifest.yml` → minor version, no admin re-consent |

`loop=1` is what makes the design cheap: the icon quiets itself, so "stop animating
once the user engages" needs no per-user state, no storage, and no backend.

## Rejected: the per-user condition

`entity: user` does not work as hoped. A property written to
`/wiki/rest/api/user/{accountId}/property/{key}` for the *viewing* user reads back
correctly (HTTP 200) but no byline responds to it — the item gated on its existence
stayed hidden, so the evaluator cannot see it. The docs do not say whose user
`entity: user` resolves to, nor whether the property must be written by the app.

Dropped rather than investigated further: `loop=1` already removes the nagging
problem the user condition was meant to solve, so its remaining value is marginal.
Revisit only if suppression for activated users proves necessary.

## Open

- **Two chips.** `zenuml-byline-aiaide` is currently unconditional, so a user in a
  diagram-using space would see both "Aide" and "Try ZenUML". Either gate Aide on
  the inverse condition or accept both — needs a design call.
- **Icon renders ~19×14, not square.** Assets must be drawn for that ratio.
- **255-character limit on `icon`.** A `data:` URI fits only about a 16×16 two-colour
  GIF. Anything richer needs `resource:` (reported broken in dynamic properties) or
  an absolute URL, which requires a `permissions.external.images` entry.

## Analytics

Events first, per project rule. Funnel is `shown → clicked → first diagram created`.

| Event | Trigger |
|---|---|
| `activation_nudge_shown` | byline rendered (fires from the dialog resource on first paint) |
| `activation_nudge_clicked` | byline clicked, dialog opened |
| `activation_nudge_dismissed` | dialog closed without creating |
| existing `macro_create_succeeded` | the activation event itself |

Success is the shown→created rate, segmented by whether the space was already a
diagram user. Baseline to beat: the demo page's 4 events.
