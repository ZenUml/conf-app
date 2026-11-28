#!/usr/bin/env python3
"""G1 team-share outcome: share-strip sites that got a second saver within N days.

For each customer site whose first `team_share_prompt_shown` falls in the window,
check whether any OTHER Atlassian account saved a diagram on that site
(`macro_create_succeeded` or `macro_save_succeeded`) within N days after it.
Compares sites where someone copied (`team_share_copied`) against the rest.

Prints aggregates only, never site names.

Usage (from the conf-app root):
    python3 .claude/skills/mixpanel/scripts/team_share_outcome.py [--since 2026-11-28] [--days 30]

Sites whose window has not closed yet are counted as "open" and kept out of the rate.
"""

import argparse
import datetime as dt
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from mp_query import load_api_secret, run_jql  # noqa: E402

BASELINE = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod",
            "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"]
PRIVATE = "private/operations/internal-analytics-domain-exclusions.md"


def internal_markers():
    markers = list(BASELINE)
    if os.path.exists(PRIVATE):
        with open(PRIVATE) as f:
            section = f.read().split("## Confirmed internal tenants", 1)[-1].split("##", 1)[0]
        markers += re.findall(r"`([a-z0-9-]+)`", section)
    else:
        print(f"warning: {PRIVATE} missing; using public baseline only", file=sys.stderr)
    return markers


JQL = """
function main() {
  var internal = %(internal)s;
  var days = %(days)d * 86400000;
  return Events({from_date: '%(since)s', to_date: '%(to)s',
      event_selectors: [{event: 'team_share_prompt_shown'}, {event: 'team_share_copied'},
                        {event: 'macro_create_succeeded'}, {event: 'macro_save_succeeded'}]})
    .filter(function (e) {
      var d = e.properties.client_domain;
      if (!d || d.indexOf('unknown') === 0) return false;
      for (var i = 0; i < internal.length; i++) if (d.indexOf(internal[i]) !== -1) return false;
      return true;
    })
    .groupBy([function (e) { return e.properties.client_domain; }], function (accs, events) {
      // JQL passes the earlier partial results as an array of accumulators.
      var out = [];
      accs.forEach(function (a) { out = out.concat(a); });
      events.forEach(function (e) { out.push([e.name, e.time, e.distinct_id]); });
      return out;
    })
    .map(function (r) {
      var ev = r.value.sort(function (a, b) { return a[1] - b[1]; });
      var shown = null, copied = false, second = false;
      ev.forEach(function (x) {
        if (x[0] === 'team_share_prompt_shown' && !shown) shown = x;
      });
      if (!shown) return null;
      ev.forEach(function (x) {
        if (x[0] === 'team_share_copied' && x[1] >= shown[1]) copied = true;
        if ((x[0] === 'macro_create_succeeded' || x[0] === 'macro_save_succeeded') &&
            x[1] > shown[1] && x[1] <= shown[1] + days &&
            x[2] !== shown[2] && x[2] !== 'unknown_user_account_id') second = true;
      });
      return {shown_at: shown[1], copied: copied, second: second};
    })
    .filter(function (r) { return r !== null; });
}
"""


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--since", default="2026-11-28")
    p.add_argument("--days", type=int, default=30)
    a = p.parse_args()
    today = dt.date.today() + dt.timedelta(days=1)  # local date can run ahead of the project day
    script = JQL % {"internal": repr(internal_markers()), "days": a.days,
                    "since": a.since, "to": today.isoformat()}
    rows = run_jql(script, load_api_secret(), pace=0)
    cutoff = (dt.datetime.now(dt.timezone.utc).timestamp() - a.days * 86400) * 1000
    groups = {"copied": [0, 0, 0], "not copied": [0, 0, 0]}  # closed, second, open
    for r in rows:
        g = groups["copied" if r["copied"] else "not copied"]
        if r["shown_at"] > cutoff:
            g[2] += 1
        else:
            g[0] += 1
            g[1] += 1 if r["second"] else 0
    print(f"window: first prompt since {a.since}, second saver within {a.days} days")
    print(f"{'group':<12}{'closed':>8}{'2nd saver':>11}{'rate':>8}{'open':>7}")
    for name, (closed, second, open_) in groups.items():
        rate = f"{second / closed:.0%}" if closed else "-"
        print(f"{name:<12}{closed:>8}{second:>11}{rate:>8}{open_:>7}")


if __name__ == "__main__":
    main()
