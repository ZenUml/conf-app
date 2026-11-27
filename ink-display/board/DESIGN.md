# reMarkable board

A 1404×1872 grayscale page for the reMarkable 2. The Mac renders it; the tablet pulls it over Wi-Fi.

```
Mac (launchd, port 8766)                          reMarkable 2
 sources/*.py  -> store (one JSON per section)
 layout.py     -> PNG (Pillow, Inter)
 server.py     GET /r/<token>.png?b=<battery>  <-- pull every 5 min, draw only when the PNG changed
```

## Sections and refresh

| Section | Interval | Source |
|---|---|---|
| tokens | 5 min | `kindle/frame_source.py` (epaper venv) + `kindle/render.parse_frame`; cells 1,2,3 = Claude week, Codex week, Cursor week |
| revenue | 1 h | Marketplace sales transactions export; `vendorAmount` by `saleDate`, refunds negative |
| gcp | 5 min | `gcloud compute instances list` + BigQuery billing export + `~/.local/share/kindle-quota/gcp_cost.json` (credit) |
| customers | 12 h | notes file `~/.local/share/remarkable-board/customers.json` (hand-edited) + Marketplace licence export (seats, product, region/country) |
| mixpanel | 5 min | private organization billing snapshot and observed-only history |
| fullscreen | 5 min | read-only D1 FullscreenRecoveryRequest + FullscreenRecoveryMailOutbox for private configured cloud UUID |
| credits | 5 min | private local `~/.local/share/remarkable-board/aws-credits.json` snapshot; no AWS live query |
| sites | 24 h | Marketplace licence export + D1 `ForgeInstallation` + usage |

Store: `~/.local/share/remarkable-board/cache/<section>.json` = `{"fetched_at": iso, "data": {...}}`.
A failed fetch keeps the last good file. A section older than 3× its interval is stale: its side tab reads
`<LABEL> STALE`.

Real customer names never go in the repo: tests and fixtures use fictional names.

## Section data (the contract between sources and layout)

```jsonc
// tokens
{"cells": [{"name": "CLAUDE", "percent": "86%", "countdown": "6d 5h", "reset": "Fri 00:00",
            "chart": [null, 50, 49, ...48 values, 0..MAX_LEVEL or null], "max": 50,
            "sampled_at": 1793966500}]}   // 3 cells; sampled_at = epoch of the provider's last good sample, or null
// customers: sorted by seats, largest first; layout shows only the first five in the left column
{"rows": [{"product": "LITE|FULL|BOTH|DIAGRAMLY|ASYNCAPI", "name": "Acme",
           "place": "Americas / US", "seats": "1,010",
           "status": "23d overdue", "note": "Find licence owner, 304 views"}]}
// credits: checked_at is the dashboard observation time, never the local file poll time
{"status": "PENDING", "checked_at": "2026-11-13T07:36:00+11:00",
 "requested_amount": "$10,000", "applied_date": "12 Nov 2026"}
// sites: funnel steps Installed, Opened, Created, Active 3d+, Paid; up to 6 rows: newest new sites of the last 14 days, newest first
{"funnel": {"now": [7, 6, 5, 3, 0], "before": [5, 2, 2, 0, 0]},
 "rows": [{"product": "LITE", "name": "acme-site", "place": "Americas / US", "seats": "85", "steps": [true, true, true, false, false], "recent": true}]}   // steps = Installed, Opened, Created, Active 3d+, Paid reached since install; recent = new in the last 7 days; place is region plus the country shortcode, "" when missing or Unknown
// revenue
{"d30": "$2,316", "d90": "$9,494",
 "rows": [{"product": "FULL", "name": "acme", "amount": "$23.20", "date": "8 Nov", "type": "Renewal", "seats": "40 users"}]}  // up to 10, newest first
// gcp
{"today": "$21", "yesterday": "$44", "month_label": "NOV", "month": "$180", "credit": "$1,772", "credit_total": "$2K",
 "daily": [{"day": "24", "cost": 0.01}, ...14 days],
 "servers": [{"name": "ci-c4n48-central", "machine": "c4n-standard-48", "disk": "500 GB",
              "status": "off 11m, spot", "rate": "0.83", "up": false}]}   // up to 5
```

Repos: DIAG = ZenUml/diagramly.ai, CONF = ZenUml/conf-app, CORE = mermaid-js/zenuml-core, WEB = ZenUml/web-sequence.
Product letters: L Lite (`com.zenuml.confluence-addon-lite`), F Full (`com.zenuml.confluence-addon`),
B both, D Diagramly (`gptdock-confluence`), A AsyncAPI (`my-api`).

## Layout

Reference (outside the repo, it shows real names): the approved Figma export and the prototype `page.py`
with the body grid and hard-coded numbers, both in the session scratchpad.

- Font: `board/fonts/Inter.ttf` (variable; `set_variation_by_name("Bold"|"Regular")`). Type: 60 bold (token %),
  44 bold (big numbers), 30 bold (names), 24 bold (PR numbers), 24 regular/bold (body, tabs). Gray = 0x44.
- Draw with Pillow directly. Text is placed by baseline: anchors `ls`, `ms`, `rs`.
- Side tabs: x 0..40, fill 0x22, label white 24 bold rotated -90°, letter spacing 3.
  The sites section's tab reads NEW CUSTOMERS (data key stays `sites`).
- New-customers rows: five squares per row, one per funnel step (Installed, Opened, Created, Active 3d+, Paid),
  black when the site reached that step. A gray dashed line (8 on, 6 off, 2 px) above the first row older than 7 days; no label.
- After a customer name, the licence region and the country shortcode (`Americas / US`, `EMEA / UK`), then the seat count. Place is 24 regular black; seats stay 24 bold black and are never shortened. A missing or `Unknown` place is omitted. An unmapped country name is kept in full. When the row is tight, the name keeps about half the remaining width and the place takes the rest.
- Sections (y): header 0..209 (rule at 209), customers 210..686, sites 686..1022, revenue 1022..1490, gcp 1490..1872.
- Header (from Figma): per cell at x0 = 56, 506, 956: name 24 bold top 26; percent 60 bold top 52; countdown 24 top 122;
  reset icon 20×20 at (x0, 158) and reset text 24 at (x0+28, top 154). Chart box x0+170 .. x0+400 wide 230,
  y 36..152: dotted guides at 100% (y 36) and 50% (y 94), 2 px black dashed diagonal top-left to bottom-right (even use),
  solid baseline y 155, curve 4 px. Dividers x 482 and 932, y 30..178. Cursor's 100% guide stops at x 1281 for the
  battery: outline 56×26 at (1293, 32), tip 5×12 at (1351, 39), fill width = 30 × level/100 at (1298, 37).
  Available space on the Mac's data volume appears below the battery as a number followed by GB.
- Per-provider update time: local HH:MM, 24 bold black (same size as the reset text, bold so it reads on e-ink),
  right-aligned to the chart's right edge (x0+400) on the reset row (baseline 177). Over 30 minutes old:
  "STALE HH:MM", same style; the STALE prefix is the only difference. No sample time: nothing drawn.
  Each provider has its own time because their samples drift apart (Claude can lag minutes behind on 429s).
- Live data varies: never assert on widths. Shorten with "…" to fit; wrap PR titles to 2 lines, then cut.

## Full refresh

The first successful pull after the display starts triggers a full refresh. After that, the tablet
does a full refresh on the first successful pull at least six hours after the last successful full
draw. A manual full refresh restarts that timer. Scheduled refreshes use the normal poll and sleep
schedule.

`touch ~/.local/share/remarkable-board/cache/force-full` on the Mac. The tablet asks `/r/<token>.full` after each good
fetch, gets `1` once, and redraws full on that poll (at most about 5 minutes by day, 1 hour from 00:00 to 06:59).

## AWS credits panel

The CUSTOMERS right column is an independent 620×432 AWS ACTIVATE / CREDITS panel.
The left column keeps the first five customer rows. The credits reader polls the private snapshot
every 300 seconds and preserves `checked_at` exactly. This is not automatic AWS verification.
The input has `status`, ISO `checked_at`, optional `requested_amount` and ISO `applied_date`
(`YYYY-MM-DD`; the source formats the date for display). Missing or invalid data shows UNAVAILABLE
and clears any previous status. A stale local cache is marked CACHE STALE beside the checked time.
PENDING shows affiliation verification, 7–10 business days, and No action required. Amounts
are labelled REQUESTED and do not imply approval; absent amounts or dates are omitted.

## Fullscreen follow-ups

The CUSTOMERS right column now has a compact AWS card above a Fullscreen follow-up list.
AWS keeps its status, requested amount, processing time, no-action notice and original check time.
Configure `~/.local/share/remarkable-board/fullscreen-followups.json` privately:
`{"site":"DEMO","cloud_id":"00000000-0000-4000-8000-000000000001"}`.
The independent `fullscreen` source makes one read-only D1 query every 300 seconds. It selects
request/grant and mail-outbox status fields only; it never reads encrypted contacts or sends mail.
Missing/invalid config or query failures raise so Store retains the last good result and marks
the cache stale after 900 seconds. Successful fetches set `checked_at` to their actual time.

Output: `site`, ISO `checked_at`, `active`, `expired`, `outcomes_recorded`, and `rows`. Each row
has `id` (first eight characters), `space`, local `requested`/`expires` dates, `grant`
(ACTIVE, EXPIRED, PENDING, UNKNOWN), `mail`, local `mail_at`, and `support_outcome`.
The layout shows the latest four requests in chronological order and counts all requests.
TEMP labels describe the recorded temporary grant window, not universal access or proof of use.
Delivered confirms delivery, never reading; accepted means sent with delivery unconfirmed.
Bounced/failed are bold. Draft never means sent. Missing outbox means reply not recorded,
not proof no manual reply exists. Null support outcome means no outcome recorded, not proof
the customer has not replied. An empty successful query says No requests recorded.

## Mixpanel billing usage

The CUSTOMERS left column shows organization-wide Mixpanel Events and Session Replay usage.
Its stale rail marker follows the Mixpanel cache; right cards and other sections are unchanged.
Private `~/.local/share/remarkable-board/mixpanel-usage.json` has `organization`, aware ISO
`checked_at`, calendar `period_start` inclusive / `period_end` exclusive (`YYYY-MM-DD`),
`events: {used,limit}`, `session_replay: {used,limit}`, and optional `source_url`. This is a
browser billing snapshot, not a live API query. An external browser check refreshes this snapshot hourly. The local 300-second read preserves
`checked_at`; rereading the file does not claim a new billing observation.
Usage must be finite/nonnegative; limits finite/positive. Over-quota counts stay exact while
remaining clamps to zero. Invalid/missing input raises and Store retains its last good cache.
Snapshot age over three hours (three hourly checks) says STALE. At cycle end the cells show N/A / PERIOD EXPIRED
and omit old counts. Calendar boundaries use Australia/Melbourne.

Output has `checked_at`, `period_start`, `period_end`, both metrics with `used`, `limit`,
`remaining`, and `history` points `{checked_at,events,session_replay}` (remaining percentages).
Private `mixpanel-usage-history.json` stores `{cycle:[start,end],points:[...]}`. Advisory locking
and atomic random 0600 files protect writes. Equal observation timestamps deduplicate; points
sort by actual time and reset for a new cycle. No month-start point or past sample is invented.
Real counter corrections may move usage up or down.

Each cell shows percent LEFT, used / limit, period end and observation time. The dashed downward
100%→0% diagonal spans the full cycle, with dotted 100%/50% guides and a baseline. Solid ink
contains only actual observed history: the first snapshot produces a single point.
