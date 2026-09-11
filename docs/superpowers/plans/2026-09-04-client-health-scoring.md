# Client Health Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `client-health` skill with a script that ranks active ZenUML Lite tenants on two independent 0-100 percentile scores — Opportunity (upsell candidate) and Risk (disengagement) — printed as a sortable CLI table.

**Architecture:** Pull seat tier from the Marketplace license export (reusing `marketplace/scripts/mp_report.py`'s `load()`/`_tier_users()`/`company_of()`), pull usage signals from two Mixpanel JQL queries (reusing `mixpanel/scripts/mp_query.py`'s `run_jql()`), combine both sources into a per-domain raw-signal table, percentile-rank each signal against the active fleet, average into the two scores, print a table.

**Tech Stack:** Python 3 stdlib only (`argparse`, `datetime`, `json`, `collections.defaultdict`), no new dependencies. Reuses `mp_report`, `mp_pricing`, `mp_query` via `sys.path` insertion, the same pattern `test_mp_report.py` already uses.

**Spec:** [docs/superpowers/specs/2026-09-04-client-health-scoring-design.md](../specs/2026-09-04-client-health-scoring-design.md)

## Global Constraints

- Lite only — no Full/Diagramly/AsyncAPI (spec §Scope).
- Active tenants only: `macro_viewed > 0` in the 90-day window (spec §Scope).
- Two independent scores, never combined into one number (spec §Purpose).
- Window: 90 days total; growth trend = last 30 days vs. prior 30 days within that window (spec §Signal computation).
- No dashboard automation, no persistence layer — point-in-time CLI report only (spec §Output).
- Marketplace vendor feedback and `duration_net_ms` are explicitly excluded signals — do not add them (spec §Risk score).

---

## File Structure

- Create: `.claude/skills/client-health/SKILL.md` — skill description and usage
- Create: `.claude/skills/client-health/scripts/percentile.py` — the percentile-rank primitive, pure function, no I/O
- Create: `.claude/skills/client-health/scripts/test_percentile.py` — unit tests for the primitive
- Create: `.claude/skills/client-health/scripts/health_score.py` — Marketplace loader, Mixpanel query builders/parsers, scoring assembly, CLI entrypoint
- Create: `.claude/skills/client-health/scripts/test_health_score.py` — unit tests against synthetic fixtures (no network, no credentials)

### Task 1: Percentile-rank primitive

**Files:**
- Create: `.claude/skills/client-health/scripts/percentile.py`
- Test: `.claude/skills/client-health/scripts/test_percentile.py`

**Interfaces:**
- Produces: `percentile_rank(value: float, fleet_values: Iterable[float], direction: str = "higher_is_better") -> float` — returns 0-100, average-rank tie handling, raises `ValueError` on an unrecognized `direction`.

- [ ] **Step 1: Write the failing tests**

```python
#!/usr/bin/env python3
"""Unit tests for percentile.py's percentile_rank. No network, no credentials.

Run from the repo root:
    python3 .claude/skills/client-health/scripts/test_percentile.py
or:
    python3 -m unittest discover -s .claude/skills/client-health/scripts
"""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import percentile  # noqa: E402


class PercentileRank(unittest.TestCase):
    def test_higher_is_better_middle_value(self):
        # [1,2,3,4,5], value=3: 2 below, 1 equal -> rank 2.5/5 = 50.0
        self.assertEqual(percentile.percentile_rank(3, [1, 2, 3, 4, 5]), 50.0)

    def test_higher_is_better_top_value(self):
        # [1,2,3,4,5], value=5: 4 below, 1 equal -> rank 4.5/5 = 90.0
        self.assertEqual(percentile.percentile_rank(5, [1, 2, 3, 4, 5]), 90.0)

    def test_higher_is_better_bottom_value(self):
        # [1,2,3,4,5], value=1: 0 below, 1 equal -> rank 0.5/5 = 10.0
        self.assertEqual(percentile.percentile_rank(1, [1, 2, 3, 4, 5]), 10.0)

    def test_lower_is_better_inverts_the_ranking(self):
        # same fleet, value=1, but 1 is now the BEST value -> should rank high
        self.assertEqual(
            percentile.percentile_rank(1, [1, 2, 3, 4, 5], direction="lower_is_better"),
            90.0,
        )

    def test_ties_get_average_rank(self):
        # [1,1,1,4,5], value=1: 0 below, 3 equal -> rank 1.5/5 = 30.0
        self.assertEqual(percentile.percentile_rank(1, [1, 1, 1, 4, 5]), 30.0)

    def test_empty_fleet_returns_zero(self):
        self.assertEqual(percentile.percentile_rank(3, []), 0.0)

    def test_unknown_direction_raises(self):
        with self.assertRaises(ValueError):
            percentile.percentile_rank(3, [1, 2, 3], direction="sideways")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 .claude/skills/client-health/scripts/test_percentile.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'percentile'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```python
#!/usr/bin/env python3
"""percentile.py — percentile-rank primitive for client-health scoring.

percentile_rank(value, fleet_values, direction) ranks `value` against
`fleet_values` on a 0-100 scale using average-rank tie handling: a value
tied with N others is placed at the midpoint of the span those N values
occupy, rather than arbitrarily ordering ties.

`direction="higher_is_better"` (default) ranks ascending — the largest
raw value gets the highest percentile. `direction="lower_is_better"`
flips this — the smallest raw value gets the highest percentile. Both
Opportunity and Risk scores are built from this one function; only the
signal set and direction differ (see the design doc).
"""


def percentile_rank(value, fleet_values, direction="higher_is_better"):
    if direction not in ("higher_is_better", "lower_is_better"):
        raise ValueError(f"unknown direction {direction!r}; expected "
                          "'higher_is_better' or 'lower_is_better'")
    values = list(fleet_values)
    n = len(values)
    if n == 0:
        return 0.0
    if direction == "higher_is_better":
        below = sum(1 for v in values if v < value)
    else:
        below = sum(1 for v in values if v > value)
    equal = sum(1 for v in values if v == value)
    rank = below + equal / 2.0
    return round(100.0 * rank / n, 2)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 .claude/skills/client-health/scripts/test_percentile.py`
Expected: `OK` (7 tests pass).

- [ ] **Step 5: Commit**

```bash
cd /Users/pengxiao/workspaces/zenuml/conf-app/.claude/worktrees/client-health-scoring
git add .claude/skills/client-health/scripts/percentile.py .claude/skills/client-health/scripts/test_percentile.py
git commit -m "feat(client-health): add percentile-rank primitive

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Marketplace fleet loader

**Files:**
- Create: `.claude/skills/client-health/scripts/health_score.py` (this task adds only the Marketplace-loading section — later tasks append to this same file)
- Test: `.claude/skills/client-health/scripts/test_health_score.py` (this task adds only the fleet-loader tests — later tasks append)

**Interfaces:**
- Consumes: nothing from earlier tasks (Task 1's `percentile_rank` isn't needed until Task 4).
- Produces:
  - `fetch_lite_licenses(auth) -> list[dict]` — thin network wrapper around `mp_report.load`, not unit tested (network).
  - `build_fleet_from_licenses(lic: list[dict]) -> dict[str, dict]` — pure, maps `domain -> {"cloud_id": str, "seat_tier": int, "company": str}`. Later tasks (4, 5) consume this return type.
  - `arr_monthly(seat_tier: int) -> float` — thin wrapper around `mp_pricing.monthly_list_price`.

- [ ] **Step 1: Write the failing test**

```python
#!/usr/bin/env python3
"""Unit tests for health_score.py. No network, no credentials.

Run from the repo root:
    python3 .claude/skills/client-health/scripts/test_health_score.py
or:
    python3 -m unittest discover -s .claude/skills/client-health/scripts
"""
import datetime, os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import health_score  # noqa: E402


def license_rec(host, tier_users, company=None):
    return {
        "cloudSiteHostname": host,
        "tier": f"{tier_users} Users",
        "contactDetails": {"company": company or host.split(".")[0]},
    }


class BuildFleetFromLicenses(unittest.TestCase):
    def test_extracts_domain_seat_tier_and_company(self):
        lic = [license_rec("acme.atlassian.net", 250, "Acme Corp")]
        fleet = health_score.build_fleet_from_licenses(lic)
        self.assertEqual(fleet["acme"]["seat_tier"], 250)
        self.assertEqual(fleet["acme"]["company"], "Acme Corp")

    def test_skips_records_with_unparseable_tier(self):
        lic = [license_rec("acme.atlassian.net", 250),
               {"cloudSiteHostname": "broken.atlassian.net", "tier": None,
                "contactDetails": {}}]
        fleet = health_score.build_fleet_from_licenses(lic)
        self.assertIn("acme", fleet)
        self.assertNotIn("broken", fleet)

    def test_skips_records_with_no_hostname(self):
        lic = [{"cloudSiteHostname": "", "tier": "10 Users", "contactDetails": {}}]
        fleet = health_score.build_fleet_from_licenses(lic)
        self.assertEqual(fleet, {})


class ArrMonthly(unittest.TestCase):
    def test_delegates_to_mp_pricing_band_table(self):
        # 820 users: 100@0.44 + 150@0.33 + 570@0.11 = 44 + 49.5 + 62.7 = 156.2
        self.assertAlmostEqual(health_score.arr_monthly(820), 156.2, places=2)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 .claude/skills/client-health/scripts/test_health_score.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'health_score'`.

- [ ] **Step 3: Write the implementation**

```python
#!/usr/bin/env python3
"""
health_score.py — Opportunity + Risk scoring for active ZenUML Lite tenants.

Two independent 0-100 percentile scores per tenant:
  - Opportunity: how strong an upsell (Lite->Full) candidate, from seat
    tier, ARR potential, adoption breadth, usage volume, growth trend,
    and paywall friction.
  - Risk: how likely to disengage, from declining trend, recency of last
    activity, and thin adoption breadth.

See docs/superpowers/specs/2026-09-04-client-health-scoring-design.md for
the full design and the reasoning behind each signal (and which signals
were considered and excluded).

Reuses marketplace/scripts/mp_report.py (license fetch + tier parsing),
marketplace/scripts/mp_pricing.py (Full-plan band pricing), and
mixpanel/scripts/mp_query.py (JQL runner) rather than re-implementing
auth, pagination, or pricing math.

Scope: Lite only, active tenants only (macro_viewed > 0 in the 90-day
window). See the design doc for why.
"""
import argparse, datetime, json, os, sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 "..", "..", "marketplace", "scripts"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 "..", "..", "mixpanel", "scripts"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mp_report    # noqa: E402
import mp_pricing   # noqa: E402
import mp_query      # noqa: E402
import percentile    # noqa: E402


# ----- Marketplace: seat tier + ARR potential -----------------------------
def fetch_lite_licenses(auth):
    lic, _ = mp_report.load("lite", auth, with_tx=False)
    return lic


def build_fleet_from_licenses(lic):
    """domain -> {cloud_id, seat_tier, company}. Skips records with no
    hostname or an unparseable tier (`mp_report._tier_users` returns None
    for those, e.g. non-numeric tiers) rather than crashing on one bad
    record."""
    fleet = {}
    for r in lic:
        host = r.get("cloudSiteHostname") or ""
        domain = host.split(".")[0]
        if not domain:
            continue
        tier = mp_report._tier_users(r.get("tier"))
        if tier is None:
            continue
        fleet[domain] = {
            "cloud_id": r.get("cloudId"),
            "seat_tier": tier,
            "company": mp_report.company_of(r),
        }
    return fleet


def arr_monthly(seat_tier):
    """Full-plan monthly list price for this seat tier. Uses the banded
    list price only (mp_pricing.monthly_list_price) — deliberately not
    net-to-vendor, so this stays insulated from the Atlassian take-rate
    caveat documented in the marketplace skill."""
    return mp_pricing.monthly_list_price(seat_tier)


if __name__ == "__main__":
    pass  # CLI entrypoint added in Task 5
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 .claude/skills/client-health/scripts/test_health_score.py`
Expected: `OK` (4 tests pass).

- [ ] **Step 5: Commit**

```bash
cd /Users/pengxiao/workspaces/zenuml/conf-app/.claude/worktrees/client-health-scoring
git add .claude/skills/client-health/scripts/health_score.py .claude/skills/client-health/scripts/test_health_score.py
git commit -m "feat(client-health): add Marketplace fleet loader

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Mixpanel signal queries (build + parse)

**Files:**
- Modify: `.claude/skills/client-health/scripts/health_score.py` (append)
- Modify: `.claude/skills/client-health/scripts/test_health_score.py` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks directly (independent data source; Task 4 merges this with Task 2's output).
- Produces:
  - `build_volume_query(days: int = 90, today: datetime.date = None) -> str` — JQL script text.
  - `parse_volume_rows(rows: list[dict], today: datetime.date = None) -> dict[str, dict]` — `domain -> {"usage_volume": int, "paywall_friction": int, "recent_views": int, "prior_views": int, "last_event_date": datetime.date | None}`. Task 4 consumes this exact shape.
  - `build_creators_query(days: int = 90, today: datetime.date = None) -> str` — JQL script text.
  - `parse_creators_rows(rows: list[dict]) -> dict[str, int]` — `domain -> unique_creator_count`. Task 4 consumes this exact shape.
  - `fetch_mixpanel_signals(api_secret: str, days: int = 90) -> tuple[dict, dict]` — thin orchestration wrapper (`run_jql` + the two parsers above), not unit tested (network).

The JQL query row shape (`{"key": [...], "value": N}`) matches what
`mp_query.run_jql` returns for a `.groupBy([...], mixpanel.reducer.count())`
script — this is the same shape this session's manual Mixpanel
investigation used and verified working, both for a `[domain, name]` key
(event totals) and a `[domain, user_id]` key (unique-user counting via
`len(set(...))` on the parsed result, since JQL's `count()` reducer counts
*events*, not distinct users — the distinct count happens in Python).

- [ ] **Step 1: Write the failing tests**

```python
class BuildAndParseVolumeQuery(unittest.TestCase):
    def test_query_contains_the_window_dates(self):
        today = datetime.date(2026, 9, 4)
        script = health_score.build_volume_query(days=90, today=today)
        self.assertIn("2026-06-06", script)   # today - 90 days
        self.assertIn("2026-09-04", script)   # today

    def test_query_excludes_internal_domains_and_filters_lite(self):
        script = health_score.build_volume_query()
        self.assertIn("product_type", script)
        self.assertIn("zenuml", script)   # internal-domain exclude list present

    def test_parse_sums_usage_volume_and_paywall_friction(self):
        today = datetime.date(2026, 9, 4)
        rows = [
            {"key": ["acme", "2026-09-01", "macro_viewed"], "value": 10},
            {"key": ["acme", "2026-09-02", "macro_viewed"], "value": 5},
            {"key": ["acme", "2026-09-02", "paywall_triggered"], "value": 2},
            {"key": ["acme", "2026-09-02", "paywall_blocked_create"], "value": 1},
        ]
        parsed = health_score.parse_volume_rows(rows, today=today)
        self.assertEqual(parsed["acme"]["usage_volume"], 15)
        self.assertEqual(parsed["acme"]["paywall_friction"], 3)

    def test_parse_splits_recent_vs_prior_30_day_windows(self):
        today = datetime.date(2026, 9, 4)
        rows = [
            {"key": ["acme", "2026-09-03", "macro_viewed"], "value": 10},  # recent (within last 30d)
            {"key": ["acme", "2026-07-20", "macro_viewed"], "value": 4},   # prior (31-60 days back)
            {"key": ["acme", "2026-06-10", "macro_viewed"], "value": 99},  # outside both windows (>60d back)
        ]
        parsed = health_score.parse_volume_rows(rows, today=today)
        self.assertEqual(parsed["acme"]["recent_views"], 10)
        self.assertEqual(parsed["acme"]["prior_views"], 4)

    def test_parse_tracks_the_most_recent_event_date(self):
        today = datetime.date(2026, 9, 4)
        rows = [
            {"key": ["acme", "2026-08-01", "macro_viewed"], "value": 1},
            {"key": ["acme", "2026-09-02", "macro_save_succeeded"], "value": 1},
        ]
        parsed = health_score.parse_volume_rows(rows, today=today)
        self.assertEqual(parsed["acme"]["last_event_date"], datetime.date(2026, 9, 2))

    def test_parse_ignores_zero_count_rows_for_last_event_date(self):
        today = datetime.date(2026, 9, 4)
        rows = [{"key": ["acme", "2026-09-02", "macro_viewed"], "value": 0}]
        parsed = health_score.parse_volume_rows(rows, today=today)
        self.assertIsNone(parsed["acme"]["last_event_date"])


class BuildAndParseCreatorsQuery(unittest.TestCase):
    def test_query_filters_to_create_events_only(self):
        script = health_score.build_creators_query()
        self.assertIn("macro_create_succeeded", script)
        self.assertNotIn("macro_save_succeeded", script)

    def test_parse_counts_distinct_users_per_domain(self):
        rows = [
            {"key": ["acme", "user-1"], "value": 3},
            {"key": ["acme", "user-2"], "value": 1},
            {"key": ["other", "user-1"], "value": 5},
        ]
        parsed = health_score.parse_creators_rows(rows)
        self.assertEqual(parsed["acme"], 2)
        self.assertEqual(parsed["other"], 1)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 .claude/skills/client-health/scripts/test_health_score.py`
Expected: FAIL with `AttributeError: module 'health_score' has no attribute 'build_volume_query'`.

- [ ] **Step 3: Write the implementation** (append to `health_score.py`, above the `if __name__ == "__main__":` line)

```python
# ----- Mixpanel: usage volume, growth trend, recency, paywall friction ----
INTERNAL_DOMAINS = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev",
                     "dia-stg", "diagramly"]
VOLUME_EVENTS = ["macro_viewed", "macro_create_succeeded", "macro_save_succeeded",
                  "paywall_triggered", "paywall_blocked_create", "paywall_blocked_edit"]


def _domain_filter_js(internal_domains):
    """The JS filter body shared by both JQL scripts below: product_type
    must be 'lite', client_domain must be set and not start with any
    internal-domain prefix (mirrors the mixpanel skill's minimal exclude
    list — see reference_mixpanel_internal_filter)."""
    return f"""
    var p = e.properties;
    if (p.product_type !== 'lite') return false;
    var d = p.client_domain || '';
    if (!d) return false;
    for (var i = 0; i < internal.length; i++) {{
      if (d.indexOf(internal[i]) === 0) return false;
    }}
    return true;
"""


def build_volume_query(days=90, today=None):
    today = today or datetime.date.today()
    from_date = today - datetime.timedelta(days=days)
    return f"""
function main() {{
  var internal = {json.dumps(INTERNAL_DOMAINS)};
  var events = {json.dumps(VOLUME_EVENTS)};
  return Events({{
    from_date: '{from_date.isoformat()}', to_date: '{today.isoformat()}',
    event_selectors: events.map(function(n){{ return {{event: n}}; }})
  }})
  .filter(function(e){{{_domain_filter_js(INTERNAL_DOMAINS)}}})
  .groupBy([
    function(e){{ return e.properties.client_domain; }},
    function(e){{ return new Date(e.time).toISOString().slice(0,10); }},
    'name'
  ], mixpanel.reducer.count());
}}
"""


def parse_volume_rows(rows, today=None):
    today = today or datetime.date.today()
    recent_cut = today - datetime.timedelta(days=29)     # last 30 days: [today-29, today]
    prior_start = today - datetime.timedelta(days=59)     # prior 30 days: [today-59, today-30]
    prior_end = today - datetime.timedelta(days=30)
    paywall_events = {"paywall_triggered", "paywall_blocked_create", "paywall_blocked_edit"}

    per_domain = defaultdict(lambda: {
        "usage_volume": 0, "paywall_friction": 0,
        "recent_views": 0, "prior_views": 0, "last_event_date": None,
    })
    for row in rows:
        domain, date_str, event_name = row["key"]
        count = row["value"]
        d = per_domain[domain]
        date = datetime.date.fromisoformat(date_str)
        if event_name == "macro_viewed":
            d["usage_volume"] += count
            if date >= recent_cut:
                d["recent_views"] += count
            elif prior_start <= date <= prior_end:
                d["prior_views"] += count
        if event_name in paywall_events:
            d["paywall_friction"] += count
        if count > 0 and (d["last_event_date"] is None or date > d["last_event_date"]):
            d["last_event_date"] = date
    return dict(per_domain)


def build_creators_query(days=90, today=None):
    today = today or datetime.date.today()
    from_date = today - datetime.timedelta(days=days)
    return f"""
function main() {{
  var internal = {json.dumps(INTERNAL_DOMAINS)};
  return Events({{
    from_date: '{from_date.isoformat()}', to_date: '{today.isoformat()}',
    event_selectors: [{{event: 'macro_create_succeeded'}}]
  }})
  .filter(function(e){{{_domain_filter_js(INTERNAL_DOMAINS)}}})
  .groupBy([
    function(e){{ return e.properties.client_domain; }},
    function(e){{ return e.properties.user_account_id; }}
  ], mixpanel.reducer.count());
}}
"""


def parse_creators_rows(rows):
    per_domain = defaultdict(set)
    for row in rows:
        domain, user_id = row["key"]
        if user_id:
            per_domain[domain].add(user_id)
    return {domain: len(users) for domain, users in per_domain.items()}


def fetch_mixpanel_signals(api_secret, days=90):
    today = datetime.date.today()
    volume_rows = mp_query.run_jql(build_volume_query(days=days, today=today), api_secret, pace=5)
    creators_rows = mp_query.run_jql(build_creators_query(days=days, today=today), api_secret, pace=5)
    return parse_volume_rows(volume_rows, today=today), parse_creators_rows(creators_rows)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 .claude/skills/client-health/scripts/test_health_score.py`
Expected: `OK` (12 tests pass — 4 from Task 2 + 8 from this task).

- [ ] **Step 5: Commit**

```bash
cd /Users/pengxiao/workspaces/zenuml/conf-app/.claude/worktrees/client-health-scoring
git add .claude/skills/client-health/scripts/health_score.py .claude/skills/client-health/scripts/test_health_score.py
git commit -m "feat(client-health): add Mixpanel volume/creators query builders and parsers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Scoring assembly

**Files:**
- Modify: `.claude/skills/client-health/scripts/health_score.py` (append)
- Modify: `.claude/skills/client-health/scripts/test_health_score.py` (append)

**Interfaces:**
- Consumes:
  - `percentile.percentile_rank(value, fleet_values, direction="higher_is_better") -> float` (Task 1)
  - Fleet dict shape from `build_fleet_from_licenses` (Task 2): `domain -> {"cloud_id", "seat_tier", "company"}`
  - Volume dict shape from `parse_volume_rows` (Task 3): `domain -> {"usage_volume", "paywall_friction", "recent_views", "prior_views", "last_event_date"}`
  - Creators dict shape from `parse_creators_rows` (Task 3): `domain -> int`
- Produces:
  - `compute_raw_signals(fleet, volume_by_domain, creators_by_domain, today=None) -> dict[str, dict]` — `domain -> {seat_tier, arr_monthly, adoption_breadth, usage_volume, growth_trend, paywall_friction, days_since_last_event, unique_creators}`. Only domains present in `volume_by_domain` with `usage_volume > 0` are included (the "active" filter from the spec). Task 5 consumes this exact key set.
  - `score_fleet(raw) -> dict[str, dict]` — same dict per domain as `compute_raw_signals`, plus `opportunity_score` and `risk_score` (both floats, 0-100, rounded to 1 decimal). Task 5 consumes `opportunity_score`/`risk_score` by name.

- [ ] **Step 1: Write the failing tests**

```python
class ComputeRawSignals(unittest.TestCase):
    def setUp(self):
        self.fleet = {
            "acme": {"cloud_id": "c1", "seat_tier": 100, "company": "Acme"},
            "quiet": {"cloud_id": "c2", "seat_tier": 100, "company": "Quiet Co"},
        }
        self.today = datetime.date(2026, 9, 4)

    def test_excludes_domains_with_zero_usage_volume(self):
        volume = {"acme": {"usage_volume": 10, "paywall_friction": 0,
                            "recent_views": 5, "prior_views": 5,
                            "last_event_date": self.today}}
        raw = health_score.compute_raw_signals(self.fleet, volume, {}, today=self.today)
        self.assertIn("acme", raw)
        self.assertNotIn("quiet", raw)   # not in `volume` at all -> inactive, excluded

    def test_growth_trend_and_adoption_breadth(self):
        volume = {"acme": {"usage_volume": 100, "paywall_friction": 2,
                            "recent_views": 60, "prior_views": 40,
                            "last_event_date": self.today}}
        raw = health_score.compute_raw_signals(self.fleet, volume, {"acme": 20}, today=self.today)
        self.assertAlmostEqual(raw["acme"]["growth_trend"], 0.5)          # (60-40)/40
        self.assertAlmostEqual(raw["acme"]["adoption_breadth"], 0.2)      # 20/100
        self.assertEqual(raw["acme"]["days_since_last_event"], 0)

    def test_recency_days_since_last_event(self):
        volume = {"acme": {"usage_volume": 5, "paywall_friction": 0,
                            "recent_views": 5, "prior_views": 0,
                            "last_event_date": datetime.date(2026, 8, 25)}}
        raw = health_score.compute_raw_signals(self.fleet, volume, {}, today=self.today)
        self.assertEqual(raw["acme"]["days_since_last_event"], 10)


class ScoreFleet(unittest.TestCase):
    def test_broad_adopter_outranks_thin_adopter_on_opportunity_and_risk(self):
        # Mirrors this session's tenant-a (broad) vs tenant-b (thin) finding:
        # near-identical seat tier and usage volume, very different
        # adoption breadth and growth.
        raw = {
            "broad": {"seat_tier": 800, "arr_monthly": 150.0, "adoption_breadth": 0.015,
                       "usage_volume": 3000, "growth_trend": 0.1, "paywall_friction": 0,
                       "days_since_last_event": 0, "unique_creators": 12},
            "thin": {"seat_tier": 800, "arr_monthly": 150.0, "adoption_breadth": 0.005,
                      "usage_volume": 3000, "growth_trend": -0.3, "paywall_friction": 0,
                      "days_since_last_event": 5, "unique_creators": 4},
            "small": {"seat_tier": 20, "arr_monthly": 8.8, "adoption_breadth": 0.01,
                       "usage_volume": 50, "growth_trend": 0.0, "paywall_friction": 0,
                       "days_since_last_event": 20, "unique_creators": 1},
        }
        scored = health_score.score_fleet(raw)
        self.assertGreater(scored["broad"]["opportunity_score"], scored["thin"]["opportunity_score"])
        self.assertGreater(scored["thin"]["risk_score"], scored["broad"]["risk_score"])

    def test_scores_are_bounded_0_to_100(self):
        raw = {
            "a": {"seat_tier": 10, "arr_monthly": 4.4, "adoption_breadth": 0.1,
                   "usage_volume": 5, "growth_trend": 0.0, "paywall_friction": 0,
                   "days_since_last_event": 1, "unique_creators": 1},
            "b": {"seat_tier": 1000, "arr_monthly": 400.0, "adoption_breadth": 0.5,
                   "usage_volume": 5000, "growth_trend": 2.0, "paywall_friction": 10,
                   "days_since_last_event": 0, "unique_creators": 100},
        }
        scored = health_score.score_fleet(raw)
        for s in scored.values():
            self.assertGreaterEqual(s["opportunity_score"], 0)
            self.assertLessEqual(s["opportunity_score"], 100)
            self.assertGreaterEqual(s["risk_score"], 0)
            self.assertLessEqual(s["risk_score"], 100)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 .claude/skills/client-health/scripts/test_health_score.py`
Expected: FAIL with `AttributeError: module 'health_score' has no attribute 'compute_raw_signals'`.

- [ ] **Step 3: Write the implementation** (append to `health_score.py`, above the `if __name__ == "__main__":` line)

```python
# ----- Signal assembly + scoring -------------------------------------------
def compute_raw_signals(fleet, volume_by_domain, creators_by_domain, today=None):
    """Merge the Marketplace fleet with the two Mixpanel signal sources
    into one raw-signal row per ACTIVE domain (macro_viewed > 0 in the
    window — inactive tenants are simply absent from `volume_by_domain`
    or have usage_volume == 0, and are excluded here per the spec)."""
    today = today or datetime.date.today()
    raw = {}
    for domain, info in fleet.items():
        v = volume_by_domain.get(domain)
        if v is None or v["usage_volume"] == 0:
            continue
        seat_tier = info["seat_tier"]
        unique_creators = creators_by_domain.get(domain, 0)
        prior = v["prior_views"]
        growth_trend = (v["recent_views"] - prior) / max(prior, 1)
        last_date = v["last_event_date"]
        days_since = (today - last_date).days if last_date else 999
        raw[domain] = {
            "seat_tier": seat_tier,
            "arr_monthly": arr_monthly(seat_tier),
            "adoption_breadth": (unique_creators / seat_tier) if seat_tier else 0.0,
            "usage_volume": v["usage_volume"],
            "growth_trend": growth_trend,
            "paywall_friction": v["paywall_friction"],
            "days_since_last_event": days_since,
            "unique_creators": unique_creators,
        }
    return raw


def score_fleet(raw):
    """Percentile-rank each signal against the active fleet in `raw`,
    average into Opportunity (5 signals) and Risk (3 signals) per the
    design doc's tables. `growth_trend` and `adoption_breadth` are each
    ranked twice, with opposite `direction`, once per score — that is
    intentional (see the design doc), not a bug."""
    domains = list(raw.keys())

    def col(name):
        return [raw[d][name] for d in domains]

    seat_tier_p = {d: percentile.percentile_rank(raw[d]["seat_tier"], col("seat_tier")) for d in domains}
    arr_p = {d: percentile.percentile_rank(raw[d]["arr_monthly"], col("arr_monthly")) for d in domains}
    breadth_p = {d: percentile.percentile_rank(raw[d]["adoption_breadth"], col("adoption_breadth")) for d in domains}
    volume_p = {d: percentile.percentile_rank(raw[d]["usage_volume"], col("usage_volume")) for d in domains}
    growth_p = {d: percentile.percentile_rank(raw[d]["growth_trend"], col("growth_trend")) for d in domains}
    paywall_p = {d: percentile.percentile_rank(raw[d]["paywall_friction"], col("paywall_friction")) for d in domains}

    growth_risk_p = {d: percentile.percentile_rank(raw[d]["growth_trend"], col("growth_trend"), direction="lower_is_better") for d in domains}
    recency_risk_p = {d: percentile.percentile_rank(raw[d]["days_since_last_event"], col("days_since_last_event")) for d in domains}
    breadth_risk_p = {d: percentile.percentile_rank(raw[d]["adoption_breadth"], col("adoption_breadth"), direction="lower_is_better") for d in domains}

    scored = {}
    for d in domains:
        size_value = (seat_tier_p[d] + arr_p[d]) / 2
        opportunity = (size_value + breadth_p[d] + volume_p[d] + growth_p[d] + paywall_p[d]) / 5
        risk = (growth_risk_p[d] + recency_risk_p[d] + breadth_risk_p[d]) / 3
        scored[d] = {**raw[d],
                     "opportunity_score": round(opportunity, 1),
                     "risk_score": round(risk, 1)}
    return scored
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 .claude/skills/client-health/scripts/test_health_score.py`
Expected: `OK` (17 tests pass — 12 from Tasks 2-3 + 5 from this task).

- [ ] **Step 5: Commit**

```bash
cd /Users/pengxiao/workspaces/zenuml/conf-app/.claude/worktrees/client-health-scoring
git add .claude/skills/client-health/scripts/health_score.py .claude/skills/client-health/scripts/test_health_score.py
git commit -m "feat(client-health): add Opportunity/Risk scoring assembly

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: CLI entrypoint

**Files:**
- Modify: `.claude/skills/client-health/scripts/health_score.py` (replace the `if __name__ == "__main__": pass` placeholder from Task 2)
- Modify: `.claude/skills/client-health/scripts/test_health_score.py` (append)

**Interfaces:**
- Consumes: `fetch_lite_licenses`, `build_fleet_from_licenses`, `fetch_mixpanel_signals`, `compute_raw_signals`, `score_fleet` (all from Tasks 2-4), and `mp_report._print_table(rows, cols)` / `mp_report.find_env()` / `mp_report.load_creds(env_path)` / `mp_report._auth_header(email, tok)` / `mp_query.load_api_secret()` (existing repo functions).
- Produces: `main()` — the CLI entrypoint. No return value consumed by anything (terminal task).

- [ ] **Step 1: Write the failing test**

```python
class MainCli(unittest.TestCase):
    """Monkeypatches the two network-touching fetchers so main() runs with
    zero credentials and zero network calls — same pattern
    test_mp_report.py uses for its --app resolution tests."""

    def setUp(self):
        self.fleet = {
            "broad": {"cloud_id": "c1", "seat_tier": 800, "company": "Broad Co"},
            "thin": {"cloud_id": "c2", "seat_tier": 800, "company": "Thin Co"},
        }
        self.volume = {
            "broad": {"usage_volume": 3000, "paywall_friction": 0,
                       "recent_views": 1600, "prior_views": 1400,
                       "last_event_date": datetime.date.today()},
            "thin": {"usage_volume": 3000, "paywall_friction": 0,
                      "recent_views": 1000, "prior_views": 2000,
                      "last_event_date": datetime.date.today()},
        }
        self.creators = {"broad": 12, "thin": 4}

    def _run_main(self, argv):
        import contextlib, io
        buf = io.StringIO()
        old_argv = sys.argv
        sys.argv = ["health_score.py"] + argv
        health_score.fetch_lite_licenses = lambda auth: []
        health_score.build_fleet_from_licenses = lambda lic: self.fleet
        health_score.fetch_mixpanel_signals = lambda api_secret, days=90: (self.volume, self.creators)
        mp_report.load_creds = lambda env_path: ("fake@example.com", "fake-token")
        mp_query.load_api_secret = lambda: "fake-secret"
        try:
            with contextlib.redirect_stdout(buf):
                health_score.main()
        finally:
            sys.argv = old_argv
        return buf.getvalue()

    def test_prints_both_tenants_sorted_by_opportunity_by_default(self):
        out = self._run_main(["--top", "10"])
        self.assertIn("broad", out)
        self.assertIn("thin", out)
        self.assertLess(out.index("broad"), out.index("thin"))  # broad ranks first

    def test_sort_by_risk_flag_reorders(self):
        out = self._run_main(["--sort", "risk", "--top", "10"])
        self.assertLess(out.index("thin"), out.index("broad"))  # thin is riskier

    def test_json_flag_produces_parseable_json(self):
        out = self._run_main(["--json", "--top", "10"])
        rows = json.loads(out)
        domains = {r["domain"] for r in rows}
        self.assertEqual(domains, {"broad", "thin"})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 .claude/skills/client-health/scripts/test_health_score.py`
Expected: FAIL — `main()` does nothing (`pass`), so stdout is empty and `out.index("broad")` raises `ValueError`.

- [ ] **Step 3: Write the implementation** (replace the `if __name__ == "__main__": pass` block in `health_score.py`)

```python
# ----- CLI -------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(
        description="Opportunity + Risk health scores for active ZenUML Lite tenants.")
    ap.add_argument("--env", default=None, help="path to .env.forge.local (default: auto-discover)")
    ap.add_argument("--sort", choices=["opportunity", "risk"], default="opportunity")
    ap.add_argument("--top", type=int, default=20)
    ap.add_argument("--days", type=int, default=90)
    ap.add_argument("--json", action="store_true", help="machine-readable JSON output")
    args = ap.parse_args()

    env_path = args.env or mp_report.find_env()
    email, tok = mp_report.load_creds(env_path)
    auth = mp_report._auth_header(email, tok)
    api_secret = mp_query.load_api_secret()

    lic = fetch_lite_licenses(auth)
    fleet = build_fleet_from_licenses(lic)
    volume_by_domain, creators_by_domain = fetch_mixpanel_signals(api_secret, days=args.days)
    raw = compute_raw_signals(fleet, volume_by_domain, creators_by_domain)

    if not raw:
        sys.exit("No active tenants found in the window — nothing to score.")
    if len(raw) < 10:
        print(f"WARNING: only {len(raw)} active tenants — percentile ranks "
              "are not very meaningful at this fleet size.", file=sys.stderr)

    scored = score_fleet(raw)
    rows = [{
        "domain": d,
        "seat_tier": s["seat_tier"],
        "opportunity_score": s["opportunity_score"],
        "risk_score": s["risk_score"],
        "adoption_breadth%": round(s["adoption_breadth"] * 100, 1),
        "usage_volume": s["usage_volume"],
        "growth_trend%": round(s["growth_trend"] * 100, 1),
        "days_since_last_event": s["days_since_last_event"],
        "paywall_friction": s["paywall_friction"],
    } for d, s in scored.items()]

    sort_key = "opportunity_score" if args.sort == "opportunity" else "risk_score"
    rows.sort(key=lambda r: -r[sort_key])
    rows = rows[:args.top]

    cols = ["domain", "seat_tier", "opportunity_score", "risk_score",
            "adoption_breadth%", "usage_volume", "growth_trend%",
            "days_since_last_event", "paywall_friction"]

    if args.json:
        print(json.dumps(rows, indent=2))
    else:
        print(f"=== client health, top {len(rows)} by {args.sort} "
              f"({len(raw)} active tenants scored) ===\n")
        mp_report._print_table(rows, cols)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 .claude/skills/client-health/scripts/test_health_score.py`
Expected: `OK` (20 tests pass — 17 from Tasks 2-4 + 3 from this task).

- [ ] **Step 5: Run the full test suite for the new skill**

Run: `python3 -m unittest discover -s .claude/skills/client-health/scripts`
Expected: `OK` (27 tests — 7 from Task 1 + 20 from Tasks 2-5).

- [ ] **Step 6: Commit**

```bash
cd /Users/pengxiao/workspaces/zenuml/conf-app/.claude/worktrees/client-health-scoring
git add .claude/skills/client-health/scripts/health_score.py .claude/skills/client-health/scripts/test_health_score.py
git commit -m "feat(client-health): add CLI entrypoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Skill documentation

**Files:**
- Create: `.claude/skills/client-health/SKILL.md`

**Interfaces:**
- Consumes: the finished `health_score.py` CLI surface from Task 5 (`--sort`, `--top`, `--days`, `--json`, `--env`).
- Produces: nothing consumed by other tasks — this is the terminal documentation task.

- [ ] **Step 1: Write the skill file**

```markdown
---
name: client-health
description: >
  Rank active ZenUML Lite tenants on two independent 0-100 scores —
  Opportunity (upsell candidate) and Risk (disengagement) — to decide
  which clients to focus on. Use whenever the user asks "which clients
  should we focus on", "who's a good upsell candidate", "which tenants
  are at risk of churning", "health score", or wants a ranked list of
  Lite tenants by engagement strength or fragility. Scope: Lite only,
  active tenants only (macro_viewed > 0 in the scoring window). For a
  SINGLE named tenant's paid status/profile use the `tenant` skill
  instead; for lifetime revenue/renewals/overdue payers use `marketplace`.
---

# Client Health Scoring

Two independent percentile scores per active Lite tenant:

- **Opportunity** — seat tier + ARR potential, adoption breadth, usage
  volume, growth trend, paywall friction. Higher = stronger upsell
  candidate.
- **Risk** — declining trend, recency of last activity, thin adoption
  breadth. Higher = more likely to disengage.

A tenant can rank high on one and low on the other — they are never
combined into a single number. See
[docs/superpowers/specs/2026-09-04-client-health-scoring-design.md](../../../docs/superpowers/specs/2026-09-04-client-health-scoring-design.md)
for the full design and the reasoning behind each signal (and which
signals were considered and explicitly excluded).

## Usage

```bash
S=.claude/skills/client-health/scripts/health_score.py

python3 $S                              # top 20 by Opportunity, 90-day window
python3 $S --sort risk --top 10         # top 10 by Risk instead
python3 $S --days 30                    # narrower window
python3 $S --json                       # machine-readable output
```

Credentials: same as the `marketplace` and `mixpanel` skills —
`FORGE_EMAIL`/`FORGE_API_TOKEN` (auto-discovered from `.env.forge.local`,
override with `--env`) and `.env.mixpanel`'s `API_Secret`.

Unit tests (no network, no credentials):

```bash
python3 -m unittest discover -s .claude/skills/client-health/scripts
```

## Reading the output

Each row includes the raw signals alongside the two composite scores —
`adoption_breadth%`, `usage_volume`, `growth_trend%`,
`days_since_last_event`, `paywall_friction` — so you can sanity-check a
ranking rather than just trust the number, the same transparency
principle the `marketplace` skill's tables follow.

A tenant with near-identical seat tier and usage volume to another can
still score very differently — that was the finding that motivated this
skill (see the design doc's "Purpose" section): usage volume alone
doesn't distinguish broad real adoption from a handful of people
generating heavy repeat views.

## Related

- `marketplace` — lifetime revenue, renewals, overdue payers, pricing
  (`mp_pricing.py`, reused here for ARR potential).
- `mixpanel` — event names, project id, internal-domain filter
  (reused here via `mp_query.py`).
- `tenant` — single-tenant lookup ("is X paying", "how big is X").
- `paywall` — CSS enrollment and paywall friction mechanics (the
  `paywall_friction` signal here is a coarse count, not the full
  A/B analysis that skill does).
```

- [ ] **Step 2: Verify the skill file is valid** — confirm the YAML frontmatter parses and the file lists correctly among skills.

Run: `python3 -c "import yaml, re; content = open('.claude/skills/client-health/SKILL.md').read(); fm = content.split('---')[1]; yaml.safe_load(fm); print('frontmatter OK')"`
Expected: `frontmatter OK` (falls back to a manual visual check if `pyyaml` isn't installed — the frontmatter block just needs valid `name:`/`description:` keys, matching every other `SKILL.md` in this repo).

- [ ] **Step 3: Commit**

```bash
cd /Users/pengxiao/workspaces/zenuml/conf-app/.claude/worktrees/client-health-scoring
git add .claude/skills/client-health/SKILL.md
git commit -m "docs(client-health): add skill documentation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Post-plan: submit

Per this repo's `git-workflow` policy, code changes (Tasks 1-5, all
`.py` files) need a feature branch + PR — already satisfied, since this
plan executes on branch `worktree-client-health-scoring` inside the
isolated worktree. Task 6 (`.claude/skills/**`, `.md`-only) would have
been allowed straight to `main`, but keeping it on the same branch as
the code it documents is simpler and still compliant. After Task 6's
commit, use the `submit-branch` skill to push and open a PR — do not
merge without the user's explicit go-ahead.
