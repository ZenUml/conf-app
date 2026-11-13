---
name: customer-lifecycle
description: Read-only screening of customer installs, uninstalls, new license candidates, subscription changes, cancellations and approaching or passed deadlines. Use when asked what changed recently, who installed/uninstalled, or which customer states deserve investigation. Covers existing and prospective customers and reports evidence without initiating follow-up.
---

# Customer lifecycle signals

Use [shared evidence rules and source matrix](../customer-data/evidence.md) and [product registry](../customer-data/products.json). Return facts in the shared signal shape; do not send, grant access, change a tracker or schedule monitoring merely because a signal exists.

For “查 Confluence app 过去 N 天的新客户”, use [new-customers](../new-customers/SKILL.md)'s `--live --days N --app all` entrypoint, defaulting N to **1**. Its seven-product scope is Lite, Full, Diagramly, AsyncAPI, AWS Widgets, Whiteboard and Mini Sites. Use fresh **licenses-only GETs**, not transaction-reading `--sync`; report the approximate inclusive date window and use `maintenanceStartDate` for all products' basic new-customer candidates. FREE licenses do not require trial dates or trial-coverage warnings; available evaluation dates for paid products are optional separate context. `lastUpdated` does not indicate a new customer. Investigate old-customer/renewal/migration history only when maintenance-start candidates exist. Candidates do not prove strict first installation. This specific request overrides the generic seven-complete-day default below and does not create an automated schedule.

1. Resolve products, time window and timezone from the request. Default a recent scan to seven complete days and name the range. A 30-day expansion must be labelled. "All customers" includes the registered products, with unsupported sources listed explicitly.
2. Query only the relevant existing primitives:
   - `forge-installs`: current install snapshot and prior-snapshot difference. Missing baseline means change unknown. A disappearance gives a time interval, not an exact uninstall timestamp or reason.
   - `new-customers`: license-start candidates and known historical installation evidence, not confirmed new customers. Existing company/new product and renewals/migrations are distinct.
   - `marketplace`: license and transaction facts; compare identified subscriptions with earlier snapshots when establishing a transition. Read cancellation feedback via `customer-feedback`.
   - `income-radar`: billing/expiry candidates only; no contact policy inherited.
   - `tenant`: verify each promising site across all its products and the separate user/space license layer.
3. Apply the source matrix. Local CRM classification rules can help name a signal; its local simulated action is never evidence of a real send, payment or grant. Do not duplicate its queries or maintain a competing classifier.
4. For each material signal return customer/site, product, event kind, before/after if proven, occurred-at or bounded observation interval, source reference, queried-at, coverage window, read status and unknowns. Current-state-only observations are labelled as such.
5. Summarise coverage, failed/not-queried sources, freshness and notable changes. No recommendation/action fields belong in this result. Let `customer-followup` combine contact history, feedback and goals to decide what to do.

Full trial expiry, commercial license status, cancelled subscription, removed install and missing payment record are not interchangeable. Trial expiry alone does not prove a customer needs manual purchasing help; automatic billing outcome must be verified separately.
