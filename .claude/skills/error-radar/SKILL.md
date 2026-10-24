---
name: error-radar
description: Daily detector for new and unusual conf-app error signatures in Mixpanel, posted to the #zenuml2 Slack channel, plus the triage procedure the daily Claude scheduled task follows. Use when asked to run the error radar, check for new or unusual errors, triage a radar alert, backtest or tune its thresholds, or explain why it alerted or stayed quiet.
---

# Error radar

`scripts/radar.py` looks at one UTC day (default: yesterday) and compares every
error signature with the 30 days before it. It is deterministic and stateless:
the baseline is recomputed from Mixpanel on every run.

Two jobs use it every day:

| Job | When (Sydney) | Does |
|---|---|---|
| GitHub Actions `error-radar.yml` | ~08:47 | Runs the detector, posts the alert list to #zenuml2 by webhook. Logs only a tenant-free summary. |
| Claude scheduled task "Error radar triage" | ~09:08 | Follows **Daily triage** below: replies in the thread of that post with a verdict per alert. Posts the radar message itself if the Action's post is missing. |

## Signature

A signature is `event | error_name | http_status | confluence_error_class | message`
(`scripts/signature.js`, the same code runs inside the JQL query and under
`node --test`). The message is `error_message`, falling back to `event_label`
for legacy `trackEvent` events, with ids, numbers, uuids, hashes, URLs, Java
package prefixes and HTML bodies replaced by placeholders.

Events in scope: names ending `_failed`, `_error`, `_missing`, `_timeout`,
`_exception`, `orphan_observed`, plus legacy events sent with category
`error`. Excluded: other products (`product` set), internal sites, category
`warning` alone (it marks probes such as `duplication_detect`), and
`create_attachment<type>` (a second copy of every `attachment_upload_failed`).

Counts are weighted by `1 / sample_rate`, so a 10%-sampled event reads at its
true volume. Distinct users are not weighted.

## Alert kinds

| Kind | Fires when (constants at the top of `radar.py`) |
|---|---|
| new | not seen in the previous 30 days; ≥3 events received, ≥1 real tenant, and ≥5 events or ≥2 tenants |
| spike | > 2.5× the median of the comparable days (previous 20 weekdays, or 8 weekend days) and ≥ 50 above it |
| concentrated | ≥ 50 events, one tenant > 50% of them, and that share up ≥ 25 points on the 30-day baseline |
| spread | ≥ 8 tenants and > 2.5× the usual tenant count |

Spike, concentrated and spread also need ≥10 events actually received, so a
handful of sampled arrivals cannot alert on their ×10 extrapolation. One alert
per signature lists every kind that fired. A kind that already fired in the
previous 3 days is suppressed unless the count has at least doubled since, so
a standing problem alerts when it starts and each time it doubles.

**Backtest 2026-09-20..10-19:** 1.7 alerts/day, 0 on 13 of 30 days, at most 9
(2026-10-12, the day the October sampling release shipped). It caught the
single-tenant HTML-instead-of-JSON upload ramp on 10-09, a second tenant's missing-content
burst on 10-10, the missing-content spread on 10-12, and the first tenant's next jump
on 10-19. Re-run the backtest after changing a constant:

```bash
S=.claude/skills/error-radar/scripts
python3 $S/radar.py --backtest 2026-09-20 2026-10-19 --save-data /tmp/radar.json   # queries Mixpanel once
python3 $S/radar.py --input /tmp/radar.json --backtest 2026-09-20 2026-10-19        # offline re-runs
python3 -m unittest discover -s $S -p 'test_*.py' && node --test $S/signature.test.js
```

## Running it

```bash
python3 .claude/skills/error-radar/scripts/radar.py                     # yesterday, Slack text to stdout
python3 .claude/skills/error-radar/scripts/radar.py --day 2026-10-19 --json
python3 .claude/skills/error-radar/scripts/radar.py --post              # needs SLACK_ERROR_RADAR_WEBHOOK
```

Auth: `MIXPANEL_SA_USER` + `MIXPANEL_SA_SECRET` (service account, sent with
`project_id`), else `MIXPANEL_API_SECRET`, else `.env.mixpanel`. Two JQL
queries per run, about 15 s.

The GitHub Action needs three repository secrets: `MIXPANEL_SA_USER`,
`MIXPANEL_SA_SECRET`, `SLACK_ERROR_RADAR_WEBHOOK` (an incoming webhook for
#zenuml2). Missing webhook = the job fails, which is the intended signal.

## Privacy

The output names real tenants. It goes to #zenuml2 (private) and nowhere
else: not into the repo, a GitHub issue or PR, a workflow log, or an Actions
artifact. The repository is public, and so are its logs. `--quiet` is the only
mode used in CI logs.

## Daily triage (the Claude scheduled task follows this)

1. Run `python3 .claude/skills/error-radar/scripts/radar.py --json` for
   yesterday (UTC). No alerts → stop; post nothing.
2. Find today's "Error radar — <day>" message in #zenuml2 (channel id
   `C0C8GE7KPN2`). If it is missing (the Action failed or has no webhook),
   post the text from `radar.py` (without `--json`) first, and say in its thread
   that the Action's post was missing.
3. For each alert, up to 6, most severe first:
   - **Where it is emitted:** grep the event name in `src/` and `functions/`.
     Name the file:line and the branch that produces this signature.
   - **When it started and on which build:** Mixpanel MCP (`Get-Business-Context`
     first; filter `is_internal_client_domain` equals `"false"`) — the
     signature's events by day for 14 days, and by `app_version`. Line the onset
     up with release tags (`git tag --sort=-creatordate | head -20`) and
     `git log` of the emitting file.
   - **Known?** Search open PRs and issues on `ZenUml/conf-app` for the event
     name or message.
   - **Verdict**, one of: regression from release X · tenant-specific (one site,
     few users) · known issue (link) · tracking artifact (sampling/rename/new
     event) · unclear. Then the one next step.
4. Reply once in the thread: one short paragraph per alert, verdict first.
   State evidence (numbers, file:line, tag) and say plainly when something was
   not checked. Before stating a sample rate, an event's meaning or a
   rename, read `src/utils/analytics/eventSampling.ts` and the mixpanel skill.
   Both have tripped this analysis before.
5. Read-only: never open PRs or issues, push, or change Mixpanel. Tenant
   names stay in Slack.
