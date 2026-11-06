# Handoff: Lifecycle CRM console (Welcome / Extension / Retention)

## Overview

An internal operations console for the ZenUML for Confluence Marketplace app. It puts three
lifecycle scenarios into one event stream — new registrations (Welcome), paywall extension
grants (Extension), and expiries (Retention) — so an operator can see what happened, what
evidence exists behind it, and what the single next step is.

The governing constraint of this design: **the UI must never claim more than the data
supports.** Most of the layout decisions exist to keep "we wrote a record", "we sent a
message", "they replied" and "the site actually used the product" visually separate. Every
unknown renders in red as an explicit unknown, never as an empty or a zero.

## About the design files

`Local CRM.dc.html` in this bundle is a **design reference created in HTML** — a prototype
showing intended look, structure and behavior. It is not production code to copy. It runs on a
small in-house component runtime (`support.js`, included only so the file opens in a browser);
that runtime is not part of the handoff and should not be ported.

The task is to **recreate these screens in the target codebase's existing environment** using
its established patterns and libraries. The source product is Vue 3 + Vite + TailwindCSS on
Cloudflare Pages/Workers with D1 — if you are building inside that repo, use Vue 3 + Tailwind
and the existing AUI/Atlassian-flavoured components. All layout in the prototype is inline
styles; in the real implementation use Tailwind classes.

## Fidelity

**High-fidelity.** Colors, typography, spacing, radii and copy are final and taken from the
ZenUML for Confluence design system. Recreate them faithfully. The one thing that is *not*
final is the data layer — see "Data & real values" below.

## Data & real values — read this first

Every number and record in the prototype is real, extracted on 29 Aug 2026 from three sources.
Hardcoded arrays in the file stand in for queries you will need to write:

| Prototype const | Real source | Rows |
|---|---|---|
| `REG` | Marketplace vendor 1215266 licence export, joined to `licenses.raw` on `cloudSiteHostname`, verdict NEW | 21 recent registrations |
| `EXT` | `SPACE_LICENSE_KV` namespace `8969e8528105403bb2d9adca9fc16567`, key listing + value read | 37 `license:*` records, 19 tenants, 11 active |
| `JSM` | Jira Service Management ZEN project, request type "ZenUML Upgrade or Extension Request" | 16 tickets |
| `RULES` | Read off the codebase and migration state, not a query | 8 automation rules |

Facts the implementation must preserve, because the UI is built around them:

- The KV key shape is `license:<cloudId>:<spaceKey>:<accountId>`. There is **no audit table** —
  `ExtensionAction` holds no row for any of the 37 grants, so a replay cannot be told from a
  first grant, and no readback has ever been compared against the intended target.
- There is **no persisted expiry event**. Expiry rows are derived from `expiresAt` at read time.
- 15 of 16 JSM requesters have a `qm:` account id, meaning the request was filed from the
  portal while not signed in — the identity is a **self-asserted email address**.
- **No ticket carries a customer-authored comment.** 13 of 16 sit in "Waiting for customer",
  the oldest since 1 Aug. Do not render this as "replied".
- ZEN-1206's only comment was authored by "Automation for Jira" with `isVendorReply: null`.
  The UI must say authorship is unconfirmed, not "we replied".
- `isSiteAdmin` and `siteContactNotified` are `null` for every ticket — not obtainable from the
  JSM REST API. Render as unknown, never as false.
- Welcome mail cannot be delivered at all: sending domain unverified at Resend, unsubscribe and
  preference URLs are literal placeholders, two merge tags render as raw tokens, no live run
  history table exists. 0 touchpoints exist for any contact.
- Migration 0025 (eligibility columns + run log) was written and **never applied**. Local D1 is
  at 0024, production at 0023.

## Screens

Left nav is fixed 232px. Five screens; the design is built for a ~854px-wide content column,
so both wide tables scroll horizontally rather than compressing columns.

### 1. Today (default)

**Purpose.** One chronological stream of everything that happened, newest first, so an operator
sees the week rather than a set of functional queues.

**Layout.** Two columns, `flex`, `gap: 20px`, page padding `20px 24px 28px`. Left column
`flex: 1; min-width: 520px`. Right column `flex: 1; min-width: 320px` holding summary cards.

**Filter row.** `registrations` / `grants` / `expiries` / `everything` pill buttons with counts.
`position: sticky; top: 0; z-index: 6`, negative margins `-20px -24px 16px -24px` and matching
padding so its background covers the full column width while scrolling. This is a hard
requirement — it must never scroll out of the viewport.

**Stream.** Grouped by day. Each group: a 74px right-aligned date gutter (mono, semibold, with
a relative line under it), a 1px vertical rule, then the day's event cards.

**Event card.** `display: flex; gap: 11px; padding: 12px 14px`, 1px `var(--border)`,
`var(--radius-md)`, white, `cursor: pointer`, hover `border-color: var(--border-strong)`,
`transition: border-color var(--t-base)`. Contents:
- 9px status dot, solid for past events, hollow (2px ring) for future-dated ones
- site hostname in mono semibold + an event-type chip
- one sentence of what happened
- a mono micro meta line
- **the lifecycle rail** (see below)

Future-dated expiries render with a tinted card background.

### 2. Sites — 39 rows. 3. Extensions — 37 rows. 4. Pending assignment — 2 rows. 5. Automation — 8 rules.

Grids with a header row. **Padding lives on the grid element only, never on the cells** — this
is what keeps header and data columns aligned. Both wide grids get `overflow-x: auto` with
explicit column floors rather than percentage widths.

## The lifecycle rail (list page)

Each card shows where its case sits in its own state machine. Dots are 6px, `gap: 3px`,
`box-sizing: border-box`, followed by an 11px mono label.

| Dot state | Rendering | Means |
|---|---|---|
| `done` | solid `--color-success` | genuinely completed |
| `now` | solid `--color-blue-600`, or `--accent-drawio-500` when the case is stalled | where it sits |
| `open` | solid `--accent-drawio-500` | unresolved, may be before or after the current stage |
| `skip` | transparent with a 1px `--gray-300` ring | **never entered** |
| `todo` | solid `--gray-200` | not reached |

**Do not paint stages green just because they precede the current one.** Grant cases legitimately
sit at `applied` with `checking` and `ready-to-grant` never entered — no eligibility check ever
ran. That must read as hollow, not passed. A single function owns per-stage state and both the
list rail and the drawer read it; do not let the two derive stage state independently.

**Label.** The stage name, its position, and total — e.g. `blocked · 3 of 8`. An `open` stage
*after* the current one takes over the label (repeat grants read `already-applied · 7 of 7`).
An `open` stage *before* the current one appends `· N unresolved earlier`.

The four state machines:

- **Welcome** — discovered → needs-contact → blocked → ready-to-send → sending → sent → routed
  → site-signal-observed. Branches not entered: excluded, delivery-failed, contact-corrected,
  do-not-contact.
- **Extension** — received → needs-details → checking → ready-to-grant → applying → applied →
  already-applied. Branches: not-grantable, needs-retry.
- **Retention** — detected → needs-evidence → not-actionable → ready-to-contact → contacted →
  context-confirmed → recovery-in-progress → resolved. Branches: closed-unresolved,
  do-not-contact.
- **Ingest run** — read → classified → written → logged → eligibility scored → scheduled.

Grant lifecycle position is derived from the data, not stored:
`test marker` → synthetic e2e grant; `needs-details` → cloud ID resolves to no site in the
export; `outside the request flow` → origin is not a ZEN ticket; `already-applied` → an earlier
grant exists for the same domain + space; otherwise `applied, unverified`.

## The detail drawer

Opens on any card click. `position: fixed; inset: 0; z-index: 50`, right-aligned, 540px wide,
full height, `var(--shadow-xl)`, backdrop `rgba(9,30,66,0.32)` (click to dismiss),
`animation: lc-in 180ms ease-out`. Three regions: a fixed header, a scrolling body, a fixed
footer caveat line.

### Header — the decision bar

Not a title bar. Contains, in order:
1. `<CASE TYPE> CASE` uppercase micro-label + status chip + date · relative
2. site hostname, `--fs-h3`, mono, semibold
3. one sentence of context
4. **the Only next step block** — `padding: 13px 15px`, `var(--radius-md)`. Neutral
   (`--bg2` on `--border`) normally; amber (`--accent-drawio-50` on `--accent-drawio-100`)
   when blocked. Holds the uppercase label, the step, why it is the step, and a single primary
   button. When blockers exist it lists them as bullets and **renders no button at all.**
5. three tabs: Evidence / Communication / Audit, 2px bottom border on the active one

**Blocked means no button.** When a case is blocked, every write-class action is suppressed
everywhere in the drawer — not greyed, not confirm-gated: the button is absent and the row
reads "Held while the case is blocked." Read-only actions (readback, open ticket) stay live.
Write-class keys in the prototype: revoke, feedback, regrant, release, internal, migrate,
schedule.

### Evidence tab

1. **Lifecycle stage** — the same states as the card rail, vertical, dot + 1px connector rail,
   each with a sentence of why. `now` carries a chip; `skip` carries the words "never entered".
   Below it, one muted line naming the branch states not entered.
2. **Fact grid** — `grid-template-columns: 118px 1fr; gap: 9px 14px`, 12px mono both columns,
   `overflow-wrap: anywhere`. Unknowns and problems in `--color-danger`.
   Conditional rows appear **only on mismatch** — typed domain / typed space only when what the
   requester typed disagrees with what resolved; a `flag` row only when the JSM pull recorded
   one. Never render a row that repeats its neighbour.
3. **Which departure this is** (Retention only) — all four event types listed, the applicable
   one tinted blue and marked "this event", the other three marked "not derivable" or
   "not claimed" *with the reason the current data cannot decide them*:
   `extension-expired` (KV expiresAt — the only one derivable), `evaluation-ended`
   (no maintenanceEndDate in the extraction), `marketplace-lapsed` (absent-or-inactive flag not
   joined, and it carries no cancellation reason), `cancellation-unverified` (no manual lead).
4. **Other things you can do** — secondary actions. Each: label, note, optional button. Danger
   tone is an outlined red button, never filled. Confirm-gated actions reveal an inline amber
   confirm strip with Confirm / Cancel — never a modal. After running, an inline result line
   plus a mono `done · <timestamp>` audit line, and the button is gone.
5. **Where this came from** — the literal command or store the row came from.

### Communication tab

One track per real recipient. **The track count differs per case and that is the point:**

- **Welcome — 3 tracks.** Email delivery / Contact reply / Site-level signal. Keeping these
  apart is what stops a delivered email being read as site usage.
- **Extension — 2 tracks.** Requester / Site Contact. The Site Contact track exists and is
  empty: the grant endpoint notifies nobody.
- **Retention — 1 track.** Site Contact only. The end user is never a recipient of this platform.
- **Ingest run — 1 track.** "No external recipient."

Each track: name + state chip + who it is, then rows of `66px mono key + value`, each in its own
1px-bordered box. `sent`, `delivered` and `replied` are **always separate rows**; a posted reply
is not an acknowledgement and delivery is not a reply. Below the tracks, one muted line saying
why the tracks are separate.

### Audit tab

Same 118px fact grid: audit row presence, KV readback state, idempotency, operator, timestamps,
retry history. Then a "This session" list of actions run in the current session, or "Nothing has
been run against this case yet."

## Interactions

- Card click → open drawer, reset to the Evidence tab
- Backdrop or ✕ → close, clearing any pending confirm
- Tab click → switch body region; header stays
- Action button → if confirm-gated, reveal the inline confirm strip; on confirm, stamp a
  timestamp and render the result inline. Nothing in the prototype performs a real write.
- Filter pill → filter the stream, counts stay visible
- Transitions are `transition-colors`-class only. No scale, no springs, no entry animation
  except the drawer slide.

## State

```
screen   'today' | 'sites' | 'extensions' | 'pending' | 'automation'
filter   'all' | 'registered' | 'granted' | 'expired'
sel      selected event id, or null (drawer open when non-null)
tab      'evidence' | 'comms' | 'audit'
confirm  action key awaiting confirmation, or null
done     { '<eventId>:<actionKey>': timestamp }
```

Real implementation needs, beyond this: queries for the four data sources, a real KV readback
endpoint, an `ExtensionAction` audit table (currently absent), a persisted expiry event, and
migration 0025 applied before any of the eligibility or run-log UI can be truthful.

## Design tokens

From the ZenUML for Confluence design system —
`_ds/zenuml-for-confluence-design-system-.../colors_and_type.css`. Use that file, do not
transcribe values. What the design leans on:

**Color.** `--color-primary` #0052CC · `--color-blue-600` #2563EB (primary buttons) ·
`--color-blue-50/100/800` (tinted evidence) · `--color-success` #36B37E ·
`--color-danger` #CA3521 (every unknown and problem value) ·
`--accent-drawio-50/100/500/800` (amber: blocked and unresolved) ·
`--accent-plantuml-100/300/800` (confirm strips) · `--fg1/2/3`, `--bg1/2/3`,
`--border`, `--border-strong`, `--gray-200/300/400/700`.
Product accents: full = blue-500, lite = orange-500, diagramly = purple-500,
asyncapi = openapi green.

**Type.** System sans stack, no webfont — intentional, to match Confluence chrome. Mono
(Menlo / Fira Code / Monaco …) for every identifier, date, count and key path. Sizes:
`--fs-h3`, `--fs-body`, `--fs-body-sm` (14px body), `--fs-micro`; plus literal 11px and 12px
for the densest mono rows. Weights 500 / 600 only. `--tracking-label` on uppercase micro-labels.

**Spacing.** 4pt grid. Radii `--radius-md` (6px), `--radius-lg` (8px), `--radius-full`.
Shadows `--shadow-xl` on the drawer only. 1px borders throughout. No blur, no glass, no inner
shadow.

**Copy.** Sentence case everywhere. Uppercase + letter-spaced micro-labels for section heads.
Plain, matter-of-fact, no marketing tone. State names are rendered verbatim in mono
(`ready-to-send`, `needs-details`) — they are identifiers, not prose.

## Assets

None. No images, no illustrations, no icon font. The only icons are two inline Heroicons v2
outline paths (✕ and a magnifier) at stroke-width 1.5. Add further icons from Heroicons v2
outline only.

## Files

- `Local CRM.dc.html` — the complete design, all five screens and the drawer
- `support.js` — the prototype runtime, included only so the HTML opens standalone. Not for porting.
