# Fullscreen lifecycle report

After the candidate is deployed and events have had time to arrive, run:

```sh
python3 scripts/analytics/fullscreen-lifecycle-report.py --from-date 2026-11-01 --to-date 2026-11-07 --grace-days 2
```

Dates select UTC **open** dates, inclusive. The query observes events for two more days by default; select a window whose grace period has ended. The report joins only by the per-open session ID and prints aggregate counts, entry point, closing phase, median, nearest-rank P75/P90, and mean in milliseconds. It includes only sessions with exactly one open; duplicate opens or closes and orphaned events are counted separately. Durations use closed sessions with a numeric value; a session closed before diagram readiness has no diagram or visible duration. Missing closes remain unclosed, never zero or infinite. Longer sessions, browser shutdown, network failures and late arrivals can all leave records unclosed; the grace period is not a claim of complete capture. Page-visible time is not attention or proof of reading/presentation.

Events use the open-time session sampling decision, including the applicable `sample_rate`. Counts are sampled, not fleet-wide estimates; compare windows only after checking their sampling rates and deployment versions. This aggregate report does not split rates, so use a single-rate window for population comparisons. The query reads the shared Mixpanel project and returns session IDs to the local process, but the report prints aggregate statistics only. The local query runner reads its API secret from the existing local configuration; never commit query output containing identifiers or secrets.
