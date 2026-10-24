---
name: query-forensics
description: Guard-rails for deriving aggregate claims ("X% of diagrams are abandoned", "cross-space duplication is rare") from stored product data — D1 CustomContent bodies, Mixpanel events, any bulk store. Use when analyzing diagram content at scale, counting defaults/templates/unused content, measuring duplication or reuse, joining content to tenants, or whenever a percentage derived from a LIKE/GROUP BY query is about to drive a roadmap decision. Triggers on "analyze the data", "how many diagrams", "what fraction", "abandoned", "unedited defaults", "cross-space", "duplicate content", "query CustomContent".
---

# Query Forensics

One session (2026-07-26) produced three consecutive wrong headline numbers from the same table:
"49% of diagrams are abandoned defaults" → "10.2%" → truth: **1–2%, mostly transient**.
Every reversal was caused by the query, not the data. A roadmap recommendation was built and
retracted twice. These checks are the distilled cost of that session.

## The iron rule: read raw rows before any aggregate

Before the first GROUP BY or percentage, read **≥5 complete rows** of the exact column you
will filter on — full content, no `substr()` truncation. The session's core error (dual code
fields, below) was invisible in `substr(body,1,300)` and obvious in `substr(body,1,1400)`.

## Check 1 — A conclusion that flips with the filter IS the filter

If changing the marker/filter swings the result by >2×, stop treating the number as data.
Session evidence: cross-space duplication was "3.9%" with one template filter and "52.5%"
with another. Neither was real. Validate the filter itself before trusting either.

## Check 2 — Run the filter against known-positive AND known-negative rows

`LIKE '%OrderController%'` over the whole body matched 93% of mermaid diagrams — because every
mermaid row carries the ZenUML default in a **dead field** the user never sees
(see [conf-app-schema-traps.md](references/conf-app-schema-traps.md)). One look at a single
known-good mermaid diagram would have shown the filter matching a row it must not match.
The user caught this by reasoning alone: "a mermaid author keeping OrderController is
very unlikely" — implausible match rates are filter bugs until proven otherwise.

## Check 3 — Never hardcode markers for generational content

Templates, defaults, and onboarding content **change over time**. Any single marker
(`Double_Click_Me`, `Demonstration only`) measures one generation and miscounts the rest.
Discover generations instead:

```sql
SELECT substr(field,1,70) AS prefix, COUNT(*) n,
       substr(MIN(createdAt),1,7) first, substr(MAX(createdAt),1,7) last
FROM ... GROUP BY prefix ORDER BY n DESC LIMIT 12
```

High-frequency identical prefixes across unrelated tenants = templates, whatever their text.
The session found a 783-row template generation (2025-11 onward) that carried **no marker at all**.

## Check 4 — Date-distribute the "bad" bucket before calling it a state

A snapshot count conflates *permanent state* with *in-progress lag*. The "31% unedited
sequence defaults" were 89% from the trailing 3 months — editing lag, not abandonment;
settled abandonment was ~2%. One `GROUP BY month` on the bad bucket separates the two.

## Check 5 — Quantify contamination, don't assert it

"Is this our own test data?" is answered with a distribution, not a feeling. Session method:
top-N `authorId` frequency — 3,202 distinct authors with our E2E account at 4.9% ⇒ real signal.
Known internal accounts and domains are listed in the reference file.

## Check 6 — Two independent methods before a number ships

The final numbers were believed only when **frequency clustering** and a **stratified random
spot-check** (70 rows/type, eyeballed and classified) agreed within a point or two.
A 14-row sample was rightly rejected as too small; 210 held up.

## Check 7 — A negative probe needs a positive control

Applies beyond SQL: "paste doesn't work" was disproved by running the same probe on a plain
`<textarea>` (it pasted fine — the bug was our focus handling). CDP paste "evidence" was
discarded because it failed **even on the control**. A probe that can't pass its control
contributes nothing, in either direction.

## conf-app specifics

Schema traps, field maps, tenant-attribution bridges, template generations, and D1 quirks
that this session paid to discover: [references/conf-app-schema-traps.md](references/conf-app-schema-traps.md).
Read it before ANY query against `CustomContent` bodies.
