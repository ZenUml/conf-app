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
