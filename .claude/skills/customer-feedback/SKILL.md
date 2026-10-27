---
name: customer-feedback
description: Find and reconcile explicit customer feedback across Marketplace cancellation reasons, Mixpanel satisfaction submissions, in-product D1 feature/problem reports and support conversations. Use for recent feedback, unmet needs, feature requests, trial or churn investigations and product research. Keeps user opinions separate from behavioural evidence and preserves source coverage.
---

# Customer feedback

Read [shared evidence and source rules](../customer-data/evidence.md). Scope by site/product, date window and question. Seven complete days is only a shortcut for "recent"; use the requested 30/90-day period or incident window for research. This is a read-only investigation, not permission to contact customers.

## Run contract

Invoking this skill authorises a read of every source below. Do not stop to ask before querying them.

- **Attempt all four sources in the same run:** Marketplace, Mixpanel, D1, Gmail/support. Querying D1 alone is an incomplete run, not a finished one.
- **Default scope when the user gives none:** all registered products and sites, the last 30 days, ending today. State this scope in the result. Do not ask for a site or window.
- **`not_queried` is allowed only for a source the user excluded.** A source you did not try is a failed run. After a real attempt, record `failed` or `unavailable` with the concrete error, then try the documented fallback (for Mixpanel, the MCP when the JQL runner fails).
- **Gmail paging:** a first page is not coverage. Page through results, or state how many threads were read out of the estimated total.
- **Do not end the run with a question** such as "query the other sources?". Report what was found and what is missing, then stop.
- Ask the user only when a source needs credentials or approval you cannot obtain, or when the scope they gave is ambiguous in a way that changes the answer.

## Sources

| Source | What to retrieve | Boundary |
|---|---|---|
| Marketplace | Cancellation/unsubscribe reason, customer free text, product/subscription and feedback date | State change alone has no customer explanation; cancellation is not necessarily uninstall |
| Mixpanel | Actual satisfaction submission, option/score/text and identity fields supported by current event catalog | Opens/clicks/errors describe behaviour, not an expressed opinion; submission workflow is not another feedback item |
| D1 in-product feedback | Feature requests, problems, description, entry surface, product/site/user context, report reference and optional attachments | Not limited to satisfaction; verify table, deployment and coverage before querying |
| Gmail/support tickets | Relevant messages, actual sender, quoted need, replies, resolution and promises | Prior agent summaries are search clues; read the original thread before claiming current outcome |

## D1 capability check

Inspect current schema/migrations and deployed query access first. `FeedbackReport` work existing only in another checkout is not proof of production support. Use the configured read-only D1 query route and inspect table columns before selecting; do not invent column names or treat a missing table/failed query as no feedback. Record screenshot retention separately from report retention, and do not download or expose attachments unless needed for the investigation. Existing CSAT and feature feedback are distinct entry points.

## Gather and reconcile

1. Resolve the site and product from verified identifiers. Keep contact role uncertain where evidence is missing.
2. Retrieve original feedback records within the chosen window and the surrounding thread or behavioural window necessary to interpret them. Use existing `marketplace`, `mixpanel`, `conf-app` and conversation tools for access rather than new credentials or duplicate exports.
3. Preserve the user's words in a clearly labelled field; separately classify feature request, bug, unmet need, usability, satisfaction, procurement or other. Put interpretation in a different field.
4. Link records only using a verified shared report/message reference. Same user/site/time is at most a suspected association. A D1 report plus a Mixpanel submit-success with no shared reference stays one explicit report and one possibly related process event; do not count the latter as a second opinion or silently merge it.
5. Behaviour can suggest what to ask, not why a customer cancelled. For example, successful PNG download and failed email export are different actions; neither proves the reason for an unmet-needs response.

## Return

Return the shared signal fields plus feedback category, original-text reference, resolution/reply evidence, and relationship to other records (`verified`, `suspected`, `unrelated`). Separate explicit feedback totals from behaviour/process events. Include per-source freshness and successful-empty / failed / unavailable / not-queried coverage. Do not summarise missing sources as "no feedback".

Use `customer-followup` when the user also wants prioritisation, communication or a tracker update; the same evidence should be reused without re-querying unchanged sources.
