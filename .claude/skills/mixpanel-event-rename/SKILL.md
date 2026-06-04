---
name: mixpanel-event-rename
description: >
  Migrate legacy event names in saved Mixpanel reports (insights + funnels) by
  driving the Mixpanel web UI with the Playwright MCP — because the Mixpanel MCP
  API can neither read a report's query definition nor edit it. Use when asked to
  "rename an event in Mixpanel reports", "swap view_macro for macro_viewed",
  "fix reports still using create_macro_end", "migrate dashboards to canonical
  events", or any bulk event-name change across saved reports/dashboards.
  Project: ZenUML Mixpanel (id 3373228).
model: sonnet
---

# Mixpanel Event Rename (via Playwright)

Swap legacy event names to canonical ones inside **saved** Mixpanel reports.

## Execution model — run in a subagent (Sonnet)

This is a long, mechanical Playwright UI loop. It must run in a **subagent** so it executes on Sonnet (per `model: sonnet`) and keeps the main thread's context clean.

- **If you are the orchestrator** (the main thread, or any agent that was NOT explicitly told "you are the mixpanel-event-rename worker"): do **not** run the steps yourself. Spawn exactly one subagent and relay its result — then stop.
  - `Agent` tool → `subagent_type: general-purpose`, `model: sonnet`.
  - Prompt it: *"You are the mixpanel-event-rename worker. Follow `.claude/skills/mixpanel-event-rename/SKILL.md` directly — do NOT re-delegate. Scope: <report IDs / dashboards>. Acquire and release the pw-lock yourself."*
  - Do the pw-lock acquire/release **inside** the subagent, not here.
- **If you ARE that worker subagent** (you were dispatched with the instruction above): skip this section and execute the procedure below directly. Do not spawn another subagent (avoids recursion).

> The pw-lock keys off `$PPID`, so a subagent gets its own lock cleanly. The subagent reaches the session's Playwright + Mixpanel MCP tools via `ToolSearch`; if a session-authenticated MCP is missing in its context, fall back to running inline on the session model.

## Why Playwright (not the Mixpanel MCP)

The `mcp__claude_ai_Mixpanel__*` tools **cannot do this job**:

- `Get-Report` (even `skip_results=false`) returns only metadata (id, name, creator, timestamps) and `results:{}` — **never the query definition**. You cannot read which events a report uses.
- There is **no** `Update-Report` / `Edit-Report` / `Save-Report` tool. `Run-Query` only *creates new* reports; `Bulk-Edit-Events`/`Edit-Event` edit the Lexicon (display name/description), not report queries.
- Editing a report's query is only possible in the **web UI**, which the Playwright MCP can drive (it shares the user's logged-in Chrome via `--extension`).

> Tiles reference reports by **id**, so editing the original report **once** auto-updates every dashboard tile that embeds it. You do not need to touch dashboards.

## Pre-flight (mandatory)

```bash
bash scripts/pw-lock.sh acquire   # shared-Chrome lock; BLOCKED → stop & escalate
# ... do the work ...
bash scripts/pw-lock.sh release   # when done
```

Load Playwright MCP tools first: `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_take_screenshot`, `browser_wait_for` (via ToolSearch `select:mcp__playwright__...`).

## Canonical event-name map (verified via Get-Events lexicon)

| Legacy | Canonical | Notes |
|---|---|---|
| `view_macro` | `macro_viewed` | renamed 2026-04-28 |
| `create_macro_end` | `macro_create_succeeded` | |
| `edit_macro_end` | `macro_save_succeeded` | the "edit" sibling — fix it too or trio charts render a dead series |
| `create_macro_begin` | `macro_create_started` | funnel step-1 |
| `edit_macro_begin` | `macro_edit_opened` | funnel step-1; **no `macro_edit_started` exists** — editor-open = edit begin. `macro_edit_opened → macro_save_succeeded` correctly measures edit-completion |
| `upgrade_action_blocked` | `paywall_triggered` | paywall tiles; out of the usual scope — confirm before changing |
| breakdown property `event_category` | `macro_type` | **coupled** with the rename on "by diagram type" reports; same values (sequence/mermaid/…) |

Confirm any unlisted legacy event's replacement in the picker: the deprecated event's detail panel says "Replaces X / Replaced by Y", or search the term (e.g. `edit`) to see what exists. **Never guess on shared prod.**

## Discovery — find candidate reports

- `Search-Entities(project_id=3373228, entity_types=['insights'|'funnels'|'retention'], query="view_macro")` etc. **Matches name/description text only** — descriptions are frequently **stale** (a report named "Daily macro_viewed" may already be canonical; one described as the legacy trio may already be migrated). Treat results as *candidates to inspect*, not confirmed.
- `Get-Dashboard(dashboard_id, include_layout=true)` → `layout` lists each tile as `{id, name, description}`; collect the report `id`s per board.
- **Always open the report and read the actual event chips before editing.** Many are already partially migrated (views usually done, create/edit lagging).

## Loading a report (the SPA is flaky — double-nav)

A hash-only change does **not** reload the SPA. Use two `browser_navigate` calls, then wait:

```
# insights:
1) https://mixpanel.com/project/3373228/app/insights/#report/<ID>          (short form → forces redirect/reload)
2) https://mixpanel.com/project/3373228/view/3879592/app/insights#report/<ID>
3) browser_wait_for(time: 11)
# funnels: same, with /app/funnels/#view/<ID> then /app/funnels#view/<ID>
```

Loaded when `Page Title` becomes the report name (e.g. "Macro actions over time"). If it stays "Mixpanel - Product Analytics" or the snapshot is only the sidebar (~180 lines), it's still on the skeleton — navigate again / wait more. The tab can occasionally close ("Target… closed"); just re-navigate — **unsaved query edits are discarded on reload, so no corruption**.

## The swap (per event chip) — reliable recipe

1. `browser_snapshot(filename: snap.yml)` then `grep` for the chips:
   `grep -nE 'button "(view_macro|create_macro_end|edit_macro_end)( \[DEPRECATED[^"]*)?"' snap.yml`
   Deprecated events show as `view_macro [DEPRECATED → macro_viewed]`. Already-canonical chips read plainly (`macro_viewed`) — skip those.
2. Click the legacy event chip by its ref (e.g. `e773`).
3. Type the **exact** canonical name into the picker search box:
   `browser_type(target: 'input[placeholder*="Search Events"]', text: 'macro_create_succeeded')`
4. `browser_snapshot` → `grep -nE 'listitem "<canonical>"' snap.yml` → click that **ref**.
5. Repeat for each legacy chip.
6. Click the **Save** button (top-right). It then reads **"Saved"**. The editor does **not** reliably autosave.
7. **Verify**: snapshot + grep the **event chips** and the Save button:
   `grep -nE 'button "(view_macro|create_macro_end|edit_macro_end|macro_viewed|macro_create_succeeded|macro_save_succeeded)"|button "Saved"' snap.yml`
   All chips must read the canonical names (no legacy left) and the button must say `Saved`.
   ⚠️ **Grep the event chip (`button "<event>"`), NOT the metric label `Total Events of <event>`** — the label's prefix varies by measurement (`Total Events`, `Unique Users`, `DAU`…), so a `Total Events of …` grep silently matches nothing on unique/DAU reports (e.g. *Weekly Active Users*).
   ⚠️ **Save is occasionally flaky** (observed on "Active spaces per week" tiles): the first Save click may not persist. For the strongest guarantee, **re-load the report fresh and re-grep the chips**; if any legacy chip is back or the button isn't `Saved`, click Save again and re-verify. Don't trust a single Save click on its own.

Funnels: identical, but step chips read `"<event> then"` for non-final steps; the picker/Save are the same.
Breakdowns: the `event_category`→`macro_type` swap uses the same picker on the Breakdown property button.

### ⛔ Do NOT use type-with-`submit`/Enter to select

Pressing Enter selects the list's **highlighted default** (often `advocacy_message_copied`), **not** your filtered match — it silently corrupts the metric on a shared production report. Always click the exact `listitem` ref, and verify after every change. (Observed and reverted, 2026-06-03.)

## Removing a filter row (filter migration)

When a filter row becomes meaningless after an event swap (e.g. `event_label Is upgrade_action_blocked` was scoped to the old `blocked` ghost event), remove it entirely rather than leaving it in place (where it would force zero data on the new event).

**UI steps to remove a filter row:**

1. Locate the filter row you want to remove — it appears inside the metric's inline filter area (the section under the event chip, before the global Filter/Breakdown panel).
2. Click the **`ellipsis`** button on that filter row (the `⋯` icon at the right end of the row). In the accessibility snapshot it appears as `button "ellipsis" [ref=eXXX]`. It is the *second* ellipsis in the snapshot tree — the first belongs to the report's header/settings, the filter-row ellipsis follows the filter value chip.
3. A two-item context menu appears:
   - `listitem "Remove"` — deletes the filter row entirely
   - `listitem "Duplicate"` — duplicates it
4. Click `listitem "Remove"` (by its ref). The filter row disappears immediately and the URL hash updates.

**Grep pattern to find the filter-row ellipsis ref:**
```
grep -n 'button "ellipsis"' snap.yml
```
The first hit is usually the report's `hor-ellipsis` header control; the second is the metric-A filter-row ellipsis; subsequent ones are global Filter-section rows. Cross-check with the surrounding context (the filter property button immediately precedes it).

**Never click the ✕ on the value chip** — that clears the value but leaves the empty filter row, which still constrains the query. Use the ellipsis → Remove flow to delete the whole row.

## Internal-domain filter

When a report filters internal domains, prefer the boolean property `is_internal_client_domain` (= false to exclude internal) over the long `client_domain does not contain zenuml/whimet/…` list. See `[[convention]]` in mem0.

## Cost & batching

~12–16 careful MCP calls per report (slow double-nav load + 2 calls to find each option ref + a verify). Plan accordingly for bulk runs; report progress per dashboard. Console errors pile up during a session — they're harmless telemetry from the dead legacy events, not a failure signal.

**Efficiency notes (observed across the identical "Macro actions" trio reports):**
- The **event-chip refs and the Save ref are stable** across swaps within one report load — A=`e665`, B=`e773`/`e772`, C=`e881`/`e879`, Save=`e547` recurred. Capture them from the **first** snapshot and reuse; only the option `listitem` ref changes per pick (that snapshot is unavoidable). Re-grep only if a click misses.
- On customer boards, **metric A (view) is almost always already `macro_viewed`** — expect to swap only B/C. Inspect first; never assume all three are legacy.
- **Biggest open improvement:** this is still ~15 hand-driven MCP calls/report. For a real bulk run, capture the logged-in Mixpanel `storageState` once and drive a checked-in headless Playwright script that loops over `{reportId → events[]}` — orders of magnitude faster and less flaky than the MCP UI loop. Not built yet (needs a one-time auth-capture decision).

## ZenUML report inventory (2026-06-03 snapshot)

Macro view/create/edit reports live on: **Health** (board 11129697) and five per-tenant **Usage & Upgrade Intent** boards — Coles 11129822, Airwallex 11130204, MCO 11130206, LMW 11136020, Zeptonow 11136017. Each customer board clones the same 7: *Macro actions today (hourly) / past 7 days (daily) / over time*, *Weekly Active Users* (trio), *Events by diagram type* (create+edit + `event_category`→`macro_type`), *Top creators* (create), *Creator retention* (retention, create as initial action).

### Done so far (2026-06-03)
- Health: `Daily Macro Actions 1` (89729721), `Create Macro Completion` funnel (89660487), `Edit Macro Completion` funnel (89660488). Already-canonical (skipped): 89660482, 89871749, 89660483, 89660486.
- Coles: today-hourly (89665401), 7d-daily (89706312), over-time (89661541), WAU (89661543).
- LMW: "Paywall hits" (89706250) — event swapped `blocked`→`paywall_triggered`, `event_label Is upgrade_action_blocked` filter removed, `client_domain=linemanwongnai` + `isLite` + `event_category`/`ui_component` breakdowns preserved.
- Zeptonow: "Paywall hits" (89706236) — same fix; `client_domain=zeptonow` preserved.
- **Note:** `event_category` breakdown returns zero data on both `paywall_triggered` reports scoped to individual tenants — `paywall_triggered` likely uses `macro_type`/`action_type` instead of `event_category`. Decide separately whether to swap breakdown property.
- **Remaining:** Coles Events-by-type/Top-creators/Creator-retention (89661546, 89661547, 89661545); all of MCO/Airwallex/LMW/Zeptonow macro-action reports; 3 unverified Health tiles (Top clients 89708403, 89985950, Untitled 90419074).
