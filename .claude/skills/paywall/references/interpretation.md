# Interpretation reference

Consult this file when a tenant looks anomalous — zero paywall events, edit collapse, or sudden friction-rate swing — to decide whether the anomaly is real or a regional/timing artefact.

## Tenant geography & regional holidays

The signature of a holiday is **"views drop partially, edits collapse"** — passive viewing continues from phones and home but no one is coding or editing. Distinguishing this from a real paywall regression saves repeated phantom investigations.

To identify a tenant's primary region from scratch, run `macro_viewed` with breakdown by `mp_country_code` (string event property) over the last 30 days, filtered by `client_domain`. Then check that region's holiday calendar against the suspicious day.

### Known tenant geographies

| Domain | Primary regions (macro_viewed share, 30d) | Notable holidays to flag |
|--------|-------------------------------------------|--------------------------|
| linemanwongnai | Japan (37%), South Korea (30%), Thailand (21%), Singapore (11%) | JP Golden Week (Apr 29 → May 5–6), JP New Year (Jan 1–3), KR/TH major holidays |
| mcoproduct | Singapore (41%), Hong Kong (33%), Taiwan (19%) | Labour Day May 1 (SG/HK/TW all public holiday — expect ~90% drop); CN New Year (Jan/Feb) |
| airwallex | Singapore (85%), Australia (7%), Hong Kong (3%), Netherlands (3%) | SG Labour Day May 1 (~75% view drop, ~85% edit drop); SG National Day Aug 9; CN New Year (Jan/Feb); AU public holidays minor |
| xendit | Indonesia (81%), Philippines (6%), Singapore (4%), Thailand (2%) | ID Hari Buruh / Labour Day May 1 (~60% view drop, ~95% edit drop); ID Idul Fitri (varies, Mar/Apr); ID Independence Aug 17; ID Christmas Dec 25 |
| (extend as discovered) | | |

When extending this table, capture the top 3–4 regions from the country breakdown and add the holidays that affect those regions' work calendars.

### Worked example (linemanwongnai, 2026-04-29)

| Metric | Apr 28 | Apr 29 | Drop |
|--------|--------|--------|------|
| macro_viewed | 1,056 | 505 | -52% |
| macro_save_succeeded | 8 | 1 | -88% |
| upgrade_action_blocked | 17 | 0 | -100% |

Apr 29 is **Shōwa Day (昭和の日)** — a Japan public holiday and the start of Golden Week. linemanwongnai's events come 37% from Japan / 30% from South Korea / 21% from Thailand, so a JP holiday explains the edit collapse. Edit activity stays depressed through May 5–6 for any JP-heavy tenant during Golden Week — that's the shape of the signal you're calibrated to recognise here, not a paywall regression.

## Other interpretation lenses

- **Rollout shock** — newly CSS-enrolled tenants show inflated friction in the first 7 days. Skip them from A/B aggregation until 7 days post-enrollment. (Check the project memory or git log for recent CSS additions.)
- **Data settling** — Mixpanel event counts for the most recent day can shift by a few percent over 24h as late events arrive. Don't over-interpret tiny day-over-day deltas.
- **Sub-threshold triggers** — if `paywall_triggered` fires for a space `metrics-inspect` shows below 100 macros, suspect a count-source mismatch (see Troubleshooting → Debugging a specific tenant in SKILL.md).
