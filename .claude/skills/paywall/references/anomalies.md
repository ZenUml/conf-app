# Known anomalous non-CSS domains

Consult this file when the daily monitoring shows a domain in Q1/Q2/Q3/Q4 results that **is not in the CSS flag**. The first question is whether the domain is on this list already, or whether it's genuinely new and worth investigating.

These domains have emitted paywall events despite not being enrolled. Treat them as test traffic, cached bundle artifacts, or genuine code-path leaks — do **not** enroll based on these events alone.

| Domain | First seen | Pattern |
|--------|------------|---------|
| woolworths-agile | 2026-05-07 | Group B A/B control tenant (not on CSS). Seen 2026-05-07 (1 triggered), 2026-05-08 (1 triggered, 6 saves, 3 creates), 2026-05-09 (1 triggered). Three consecutive days — not a cache artifact; investigate code path. |
| gip-onshore | 2026-04-30 | paywall_triggered only |
| rizapg | 2026-05-01 | paywall_triggered + upgrade_modal_shown + macro_save_succeeded |
| olix | 2026-05-02 | high save volume (19 saves/day), no paywall events — likely below 100 macros in active spaces |
| hht-nanoplatform | 2026-05-02 | paywall_triggered + upgrade_modal_shown — not on CSS |
| 99dotco | 2026-05-11 | 2 triggered + 2 modal_shown first seen 2026-05-11; 3 triggered + 10 saves over 7 days. Not on CSS. Persistent — investigate code path. |

When a daily run finds a non-CSS domain emitting paywall events:

1. Check whether the domain is in the table above. If yes, note "previously seen anomaly" in the report and continue — don't repeat the investigation.
2. If new, add a row: domain, first-seen date, and the pattern (which events fired, volume, suspected cause).
3. Genuinely new + persistent (3+ days) anomalies are worth a separate investigation into the code path — they suggest the CSS flag check is being bypassed somehow.
