---
name: replay-forensics
description: Pull and read Mixpanel session replays for one user to get browser-side evidence (console errors, failed fetches, clicks, navigation) around a failure or a piece of feedback. Use when the user asks for "the session replay link", "what do the console errors say", "does the replay show the network failure", "was this session recorded", or when an attribution or bug diagnosis needs evidence from the customer's own browser.
---

# Replay forensics

## What a replay can and cannot tell you

| Can show | Cannot show |
|---|---|
| `console.*` output (errors, warnings, our own logs) | Browser CSP-violation messages (they are not `console.*` calls) |
| Failed `fetch()` calls made by the page, through Mixpanel's network plugin: `Error recording fetch request to <URL>: TypeError: Failed to fetch` | Why a fetch failed: CSP, CORS and network errors all read `Failed to fetch` |
| Clicks, focus, scroll, navigation, with epoch seconds | `<img>` loads (not fetches); only the page's own `fetch()` |
| Embedded event names (`replay_events`), sometimes | Event properties (always `None` there); the list can be empty |

So name the inference: "failed fetches to host H in the same second as `toPng_failed`" is
evidence; "blocked by CSP" is an inference unless the manifest or a reproduction proves it.
html-to-image fetches every image to inline it during PNG capture, so a capture produces one
burst of failed fetches per attempt.

## 1. Was the session recorded?

Every event carries `session_replay_source` (`off` / `authoring` / `fullscreen` / `feedback` /
`sampled` / `targeted`) and, when recording, `$mp_replay_id`. Read them from the event table
(`feedback-attribution/scripts/context_window.py`). Sampling rates live in
`src/utils/analytics/trackAnalyticsEvent.ts` — read them there, they change with the replay
budget (authoring has a normal rate and a lower rate while `isOctoberReplayBudgetActive()` holds; fullscreen and the
feedback dialog record at 100%; viewer recording depends on the `session-replay` Forge flag).
`off` on the events at the moment of interest means there is no replay to fetch.

## 2. Fetch the replays

Mixpanel MCP `Get-User-Replays-Data`, project 3373228:

- Query by **`distinct_id` + `from_date`/`to_date`**. Querying by `replay_ids` returns no
  `replay_url`.
- Dates are in the project timezone (Australia/Sydney); event times are UTC. Widen by a day.
- Never construct a replay URL yourself. Give the user only the `replay_url` the tool returned.
- Large results are saved to a file under the session's `tool-results/`; pass that path to the
  parser, do not read it into context.

## 3. Parse

```bash
python3 .claude/skills/replay-forensics/scripts/replay_parse.py <tool-result-file> [more files] \
  --events <scratchpad>/events.json \
  [--compare-urls <scratchpad>/image-paths.json] [--burst-min 5]
```

- `--events`: rows from `context_window.py --json-out`. Each burst is matched to events in the
  same second (0 s) or within 5 s.
- `--compare-urls`: JSON list of URLs or paths, e.g. the image references in the suspect
  diagram's stored source. Reports overlap by URL path, so `img/lib/x.svg` matches
  `https://<host>/img/lib/x.svg`. Full overlap ties the failed fetches to that diagram's content.
- stdlib only, no network. `replay_events` arrives as a Python repr; the script handles it.

Per replay it prints id, url (or "NOT RETURNED"), span in UTC, line kinds with counts, failed
fetches per second by host (bursts flagged), user actions, embedded event names, and burst
alignment.

## 4. Report

- One line per replay: id, URL, span, what it shows.
- Quote the shortest decisive line, not the log.
- Separate observed (counts, hosts, same-second alignment, overlap) from inferred (cause).
- Say what the replay could not show (CSP lines, image loads, properties).

## Pitfalls

- "No errors in the replay" is not "no errors": only `console.*` and the network plugin are recorded.
- Masked text (`"****"`) in click lines is Mixpanel privacy masking, not data loss.
- Replays are per iframe. A page with several macros has several replays at the same time; match
  by span and embedded events.
- Public repo: replay URLs contain the `distinct_id`. Put them in chat or the `private/`
  submodule, never in a committed file.
