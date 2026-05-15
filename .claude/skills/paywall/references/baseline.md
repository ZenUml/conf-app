# A/B baseline snapshots

Each weekly A/B run appends a snapshot here so the next run can read week-over-week deltas without re-querying history. Most recent snapshot at the **top**.

When you run the A/B Impact Analysis, after computing the per-tenant and group-aggregate numbers:

1. Read the most recent snapshot below to compute Δ (success_rate gap change, saves/user trend, new conversions).
2. Prepend a new dated section with today's numbers. Keep the format consistent so future runs can diff.
3. Don't delete old snapshots — they're the only longitudinal record. Trim if the file grows past ~20 entries.

---

## 2026-05-15 (last 7 days)

| Group | tenants | saves | triggered | attempts | save_users | view_users | views | success_rate | saves/user |
|-------|---------|-------|-----------|----------|------------|------------|-------|--------------|------------|
| **A** | 5 (vin3s, colesgroup, airwallex, linemanwongnai, mcoproduct) | 385 | 276 | 661 | 87 | 1,355 | 41,985 | **58.2%** | 4.4 |
| **B** | 6 (hktdc, myntfintech, woolworths-agile¹, appculqi, economical, alterric) | 166 | 1 | 167 | 38 | 401 | 9,427 | **99.4%** | 4.4 |

Per-tenant breakdown:

| Group | Domain | saves | triggered | attempts | save_users | view_users | views | success_rate | saves/user |
|-------|--------|-------|-----------|----------|------------|------------|-------|--------------|------------|
| A | vin3s | 213 | 169 | 382 | 34 | 363 | 24,232 | 55.8% | 6.3 |
| A | airwallex | 54 | 16 | 70 | 17 | 238 | 5,306 | 77.1% | 3.2 |
| A | colesgroup | 39 | 42 | 81 | 15 | 371 | 4,782 | 48.1% | 2.6 |
| A | linemanwongnai | 41 | 17 | 58 | 14 | 164 | 2,777 | 70.7% | 2.9 |
| A | mcoproduct | 38 | 32 | 70 | 7 | 219 | 4,888 | 54.3% | 5.4 |
| B | myntfintech | 54 | 0 | 54 | 11 | 82 | 2,488 | 100% | 4.9 |
| B | hktdc | 29 | 0 | 29 | 5 | 64 | 4,178 | 100% | 5.8 |
| B | alterric | 33 | 0 | 33 | 4 | 14 | 224 | 100% | 8.3 |
| B | woolworths-agile¹ | 17 | 1 | 18 | 8 | 109 | 910 | 94.4% | 2.1 |
| B | appculqi | 19 | 0 | 19 | 5 | 49 | 781 | 100% | 3.8 |
| B | economical | 14 | 0 | 14 | 5 | 83 | 846 | 100% | 2.8 |

**Reading:** 41.2pp success-rate gap (99.4% → 58.2%) — narrowed 0.3pp vs 2026-05-14 (41.5pp). saves/user gap closed to 0% (A=B=4.4), down from 11% last week — vin3s and mcoproduct both improved productivity. **colesgroup degraded to 48.1%** (heavy-friction zone: 35-50%), driven by 42 triggers vs only 39 saves over 7 days — DNLT (278 macros) and CLC (260 macros) primary friction spaces. **airwallex improved +9.6pp** (67.5%→77.1%): edit activity concentrated in sub-threshold spaces, so fewer blocks. **mcoproduct recovered +8.2pp** (46.1%→54.3%): fewer triggers this 7-day window. **linemanwongnai: 18 advocacy copies today** (257% intent capture rate) — strongest advocacy signal in the dataset; top outreach priority.

> ¹ **woolworths-agile:** Persistent anomalous triggers despite not being on CSS (known issue, see anomalies.md).

---

## 2026-05-14 (last 7 days)

| Group | tenants | saves | triggered | attempts | save_users | view_users | views | success_rate | saves/user |
|-------|---------|-------|-----------|----------|------------|------------|-------|--------------|------------|
| **A** | 5 (vin3s¹, colesgroup, airwallex, linemanwongnai², mcoproduct) | 375 | 278 | 653 | 87 | 1,416 | 44,312 | **57.4%** | 4.3 |
| **B** | 6 (hktdc, myntfintech, woolworths-agile³, appculqi, economical, alterric) | 179 | 2 | 181 | 37 | 421 | 9,278 | **98.9%** | 4.8 |

Per-tenant breakdown:

| Group | Domain | saves | triggered | attempts | save_users | view_users | views | success_rate | saves/user |
|-------|--------|-------|-----------|----------|------------|------------|-------|--------------|------------|
| A | vin3s¹ | 197 | 163 | 360 | 35 | 381 | 25,190 | 54.7% | 5.6 |
| A | airwallex | 56 | 27 | 83 | 18 | 252 | 6,255 | 67.5% | 3.1 |
| A | colesgroup | 41 | 33 | 74 | 13 | 384 | 4,725 | 55.4% | 3.2 |
| A | linemanwongnai² | 46 | 14 | 60 | 15 | 178 | 2,926 | 76.7% | 3.1 |
| A | mcoproduct | 35 | 41 | 76 | 6 | 221 | 5,216 | 46.1% | 5.8 |
| B | myntfintech | 53 | 0 | 53 | 12 | 86 | 2,540 | 100% | 4.4 |
| B | hktdc | 33 | 0 | 33 | 5 | 68 | 3,988 | 100% | 6.6 |
| B | alterric | 37 | 0 | 37 | 4 | 17 | 278 | 100% | 9.3 |
| B | appculqi | 27 | 0 | 27 | 5 | 47 | 801 | 100% | 5.4 |
| B | economical | 13 | 0 | 13 | 5 | 89 | 758 | 100% | 2.6 |
| B | woolworths-agile³ | 16 | 2 | 18 | 6 | 114 | 913 | 88.9% | 2.7 |

**Reading:** 41.5pp success-rate gap (99% → 57.4%) — narrowed 1.4pp vs 2026-05-13 (42.9pp). saves/user gap shrank dramatically: A=4.3 vs B=4.8 (11%), down from 21% last week — driven by vin3s saves +45 as rollout shock clears and linemanwongnai saves +11 with Golden Week fully out of window. **mcoproduct is the outlier: 46.1% success_rate (down from 52.3%), degrading toward heavy-friction territory — 41 triggers on 35 saves in TMAB=1546 space.** Advocacy strong: mcoproduct 7 copies/7d (top signal). colesgroup 67% intent capture rate today (2/3 triggers → 2 copies). propertyguru flagged as CSS enrollment candidate (ATS=122, 31 saves today, non-CSS).

> ¹ **vin3s:** First clean post-rollout-shock 7-day window (enrolled 2026-05-04, shock ended 2026-05-11). saves/user jumped 3.7→5.6; success_rate 49.5%→54.7%.
> ² **linemanwongnai:** First fully clean 7-day window (Golden Week fully out). success_rate 71.4%→76.7%.
> ³ **woolworths-agile:** Persistent anomalous triggers despite not being on CSS (known issue, see anomalies.md).

## 2026-05-13 (last 7 days, rerun with unique-user metrics)

| Group | tenants | saves | triggered | attempts | save_users | view_users | views | success_rate | saves/user |
|-------|---------|-------|-----------|----------|------------|------------|-------|--------------|------------|
| **A** | 5 (colesgroup, airwallex, linemanwongnai, vin3s¹, mcoproduct) | 355 | 279 | 634 | 112 | 1,603 | 35,614 | **56.0%** | 3.2 |
| **B** | 6 (hktdc, myntfintech, woolworths-agile², appculqi, economical, alterric) | 185 | 2 | 187 | 46 | 479 | 7,759 | **98.9%** | 4.0 |

Per-tenant breakdown:

| Group | Domain | saves | triggered | attempts | save_users | view_users | views | success_rate | saves/user |
|-------|--------|-------|-----------|----------|------------|------------|-------|--------------|------------|
| A | vin3s¹ | 152 | 155 | 307 | 41 | 404 | 19,250 | 49.5% | 3.7 |
| A | airwallex | 82 | 38 | 120 | 24 | 288 | 5,626 | 68.3% | 3.4 |
| A | mcoproduct | 45 | 41 | 86 | 9 | 246 | 4,790 | 52.3% | 5.0 |
| A | colesgroup | 41 | 31 | 72 | 22 | 464 | 3,642 | 56.9% | 1.9 |
| A | linemanwongnai | 35 | 14 | 49 | 16 | 201 | 2,306 | 71.4% | 2.2 |
| B | hktdc | 51 | 0 | 51 | 8 | 70 | 3,349 | 100% | 6.4 |
| B | myntfintech | 51 | 0 | 51 | 10 | 90 | 2,143 | 100% | 5.1 |
| B | alterric | 35 | 0 | 35 | 5 | 18 | 259 | 100% | 7.0 |
| B | appculqi | 22 | 0 | 22 | 11 | 52 | 619 | 100% | 2.0 |
| B | economical | 13 | 0 | 13 | 6 | 101 | 611 | 100% | 2.2 |
| B | woolworths-agile² | 13 | 2 | 15 | 6 | 148 | 778 | 86.7% | 2.2 |

**Reading:** 43pp success-rate gap (99% -> 56%) - widened +3.5pp vs 2026-05-12 (39.5pp). Saves/user gap widened to 21% (A 3.2 vs B 4.0), still below the 25% threshold; the signal remains in blocked attempts. vin3s is still the main friction driver, while mcoproduct remains the power-user outlier. woolworths-agile continues to fire anomalous triggers despite not being on CSS.

## 2026-05-12 (last 7 days)

| Group | tenants | saves | triggered | attempts | save_users | view_users | views | success_rate | saves/user |
|-------|---------|-------|-----------|----------|------------|------------|-------|--------------|------------|
| **A** | 5 (colesgroup, airwallex, linemanwongnai¹, vin3s², mcoproduct) | 401 | 273 | 674 | 74 | 1,322 | 35,299 | **59.5%** | 5.4 |
| **B** | 6 (hktdc, myntfintech, woolworths-agile³, appculqi, economical, alterric) | 206 | 2 | 208 | 37 | 374 | 8,722 | **99.0%** | 5.6 |

Per-tenant breakdown:

| Group | Domain | saves | triggered | attempts | save_users | view_users | views | success_rate | saves/user |
|-------|--------|-------|-----------|----------|------------|------------|-------|--------------|------------|
| A | vin3s² | 163 | 142 | 305 | 29 | 362 | 18,523 | 53.4% | 5.6 |
| A | airwallex | 92 | 39 | 131 | 17 | 243 | 5,804 | 70.2% | 5.4 |
| A | colesgroup | 72 | 37 | 109 | 16 | 367 | 3,887 | 66.1% | 4.5 |
| A | mcoproduct | 49 | 42 | 91 | 5 | 193 | 4,841 | 53.8% | 9.8 |
| A | linemanwongnai¹ | 25 | 13 | 38 | 7 | 157 | 2,244 | 65.8% | 3.6 |
| B | hktdc | 52 | 0 | 52 | 8 | 58 | 3,794 | 100% | 6.5 |
| B | myntfintech | 53 | 0 | 53 | 9 | 72 | 2,277 | 100% | 5.9 |
| B | woolworths-agile³ | 22 | 2 | 24 | 5 | 99 | 986 | 91.7% | 4.4 |
| B | appculqi | 31 | 0 | 31 | 5 | 48 | 675 | 100% | 6.2 |
| B | economical | 24 | 0 | 24 | 6 | 81 | 770 | 100% | 4.0 |
| B | alterric | 24 | 0 | 24 | 4 | 16 | 220 | 100% | 6.0 |

**Reading:** 39.5pp success-rate gap (99.0% → 59.5%), essentially flat vs the 40pp on 2026-05-11. saves/user gap *narrowed* sharply: A=5.4 vs B=5.6 (3.6% gap, down from 12% yesterday) — driven by Group B trending down (myntfintech 6.1→5.9, hktdc 7.1→6.5, appculqi 6.8→6.2) more than Group A trending up. Per-tenant, colesgroup improved (58%→66%) and mcoproduct slipped (57%→54%) but its 9.8 saves/user remains the highest in either group — power-user team continues high output despite friction. **mcoproduct advocacy held at 5/7d** (still the strongest conversion signal). vin3s rollout-shock window ends 2026-05-11 so this snapshot is the *last* shock-affected read; from 2026-05-18 we get the first clean post-shock 7-day read for vin3s. linemanwongnai window May 6–12 still spans the Golden Week tail — clean read also May 18.

> ¹ **linemanwongnai:** window May 6–12 still includes Golden Week (Apr 29 → May 6) tail day. True clean read from May 13 onward.
> ² **vin3s:** rollout shock window (enrolled 2026-05-04) ends 2026-05-11. From 2026-05-18, we get the first fully clean 7-day post-shock read.
> ³ **woolworths-agile:** still firing 2 anomalous `paywall_triggered` events despite not being on CSS — known persistent issue (see references/anomalies.md, first seen 2026-05-07).

---

## 2026-05-11 (last 7 days, expanded groups)

| Group | tenants | saves | triggered | attempts | save_users | view_users | views | success_rate | saves/user |
|-------|---------|-------|-----------|----------|------------|------------|-------|--------------|------------|
| **A** | 5 (colesgroup, airwallex, linemanwongnai¹, vin3s², mcoproduct) | 445 | 315 | 760 | 84 | 1,392 | 38,295 | **59%** | 5.3 |
| **B** | 6 (hktdc, myntfintech, woolworths-agile³, appculqi, economical, alterric) | 234 | 3 | 237 | 39 | 375 | 9,766 | **99%** | 6.0 |

Per-tenant breakdown:

| Group | Domain | saves | triggered | attempts | save_users | view_users | views | success_rate | saves/user |
|-------|--------|-------|-----------|----------|------------|------------|-------|--------------|------------|
| A | vin3s² | 185 | 157 | 342 | 34 | 392 | 20,638 | 54% | 5.4 |
| A | airwallex | 100 | 44 | 144 | 21 | 255 | 5,881 | 69% | 4.8 |
| A | colesgroup | 80 | 59 | 139 | 17 | 389 | 4,473 | 58% | 4.7 |
| A | mcoproduct | 55 | 42 | 97 | 6 | 199 | 5,013 | 57% | 9.2 |
| A | linemanwongnai¹ | 25 | 13 | 38 | 6 | 157 | 2,290 | 66% | 4.2 |
| B | hktdc | 57 | 0 | 57 | 8 | 60 | 4,490 | 100% | 7.1 |
| B | myntfintech | 61 | 0 | 61 | 10 | 78 | 2,764 | 100% | 6.1 |
| B | woolworths-agile³ | 34 | 3 | 37 | 6 | 104 | 1,013 | 92% | 5.7 |
| B | appculqi | 34 | 0 | 34 | 5 | 46 | 581 | 100% | 6.8 |
| B | economical | 24 | 0 | 24 | 6 | 71 | 705 | 100% | 4.0 |
| B | alterric | 24 | 0 | 24 | 4 | 16 | 213 | 100% | 6.0 |

**Reading:** 40pp success-rate gap (99% → 59%) — up from 36pp on 2026-05-09. vin3s still in the window with rollout shock days included; saves/user gap widened to 12% (A 5.3 vs B 6.0) but remains below the 25% meaningful threshold. The paywall has essentially no impact on per-editor save throughput in steady state — signal lives entirely in success rate (blocked attempts). Next clean read May 18 when both vin3s and linemanwongnai have full post-shock/post-GW 7-day windows.

> ¹ **linemanwongnai:** window May 5–11 still covers Golden Week tail (May 5–6). True clean read from May 12 (7 full post-GW days).
> ² **vin3s:** enrolled 2026-05-04 — rollout shock ends 2026-05-11. This window includes shock days; re-baseline from 2026-05-18.
> ³ **woolworths-agile:** fires anomalous `paywall_triggered` despite not being on CSS — known issue under investigation. Negligible impact on Group B rate.
