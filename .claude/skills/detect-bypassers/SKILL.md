---
name: detect-bypassers
description: Detects Lite paywall bypassers from the paywall_gate_evaluated Mixpanel event — users who SAVED a macro on a genuinely over-limit, CSS-on, unpaid space where the fail-open gate silently did not fire (#302). Produces a ranked per-tenant conversion-targeting report (confirmed vs unconfirmed tiers + an Enterprise-Bundle revenue floor) plus a JSON sidecar for later customer-recovery ingestion. Use when the user asks to find paywall bypassers, who is bypassing the Lite 100-macro limit, who is getting the paid feature for free, fail-open leak detection, "#302 bypass", or wants a per-tenant list of over-limit Lite users slipping past the paywall.
---

# Detect Paywall Bypassers (#302 fail-open)

Turns the `paywall_gate_evaluated` telemetry into an actionable per-tenant list of
users getting the Lite paid feature for free. Detection is deterministic (one
script); this file is the thin wrapper. Companion to the hourly cloud monitor,
not a replacement.

## Quick start

Run from the conf-app repo root (so `.env.mixpanel` resolves):

```bash
python3 .claude/skills/detect-bypassers/scripts/detect_bypassers.py \
  [--days N] [--domain example-tenant] [--json out.json]
```

Default window = since launch (2026-07-08, when `paywall_gate_evaluated` shipped
to Lite prod). Prints a markdown report; `--json` also writes the full record.

## What counts as a bypasser

A `(user, over-limit space)` with a **save** behind a fail-open gate — ALL of:

1. `paywall_gate_evaluated` with `gate_fired=false` **AND** `css_enabled=true`
   **AND** `space_paid=false` **AND** `macro_count_source ∈ {undefined, zero}`
   (the read failed / under-returned, so the gate silently did not fire).
2. A `macro_create_succeeded`/`macro_save_succeeded` linked to it by the same
   `(distinct_id, macro_uuid)` within 10 min, with **no `paywall_continued_editing`
   in between** (that would be the legitimate metered-grace path, not a bypass).
3. The space is **genuinely over-limit**: `macro_viewed` distinct `content_id`
   ≥ 100 (180-day lower bound).

## THE guardrail — read this

**Never call `gate_fired=false` a bypass without step 3.** A failed read on a
genuinely small/empty space (or a paid space, or a CSS-off tenant) is the gate
working *correctly*, not a leak. The script enforces
this: only spaces verified ≥100 macros become **confirmed**; everything else is
**unconfirmed** and reported separately for manual verification. (A near-empty
space that emits `zero` reads is the canonical false positive — those reads are
*correct*, not leaks.)

## Reading the output

- **Confirmed** — real bypassers. Ranked per tenant with distinct bypassers,
  bypass-saves, over-limit spaces, and `$/yr recoverable` at the Enterprise
  Bundle floor ($299/space; `docs/pricing-model.yml`). These are prime upsell
  targets: proven heavy users hitting the limit for free.
- **Unconfirmed** — read failed but distinct-views < 100. Verify true size before
  acting (see escalation) — do NOT treat as bypassers.

## Escalation for unconfirmed candidates

`macro_viewed` distinct is a lower bound (only counts *viewed* macros). To settle
an ambiguous space, count its custom content in prod D1 — authoritative-ish
(D1 is a mirror, so also a lower bound), server-side, un-blockable:

```bash
wrangler d1 execute conf-zenuml-prod --config wrangler-prod.toml --remote \
  --command "SELECT spaceId, COUNT(*) FROM CustomContent GROUP BY spaceId"
```

Caveat: D1 keys on numeric `spaceId`, Mixpanel on `space_key` — resolve the
mapping before trusting a match.

## Notes

- Report-only. It does **not** send outreach; the JSON is shaped so a human can
  hand confirmed tenants to the customer-recovery flow after review.
- Internal/staging exclusion here uses the canonical CONTAINS list (JQL), **not**
  `is_internal_client_domain` — that computed property exists only in
  Run-Query/Insights, not raw JQL (see the `mixpanel` skill).
- Only the **Lite** variant emits `paywall_gate_evaluated`; Full/Diagramly never do.
- Mechanics (project 3373228, event names, auth) → the `mixpanel` skill.
