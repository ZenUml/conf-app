---
name: forge-functions-cost
description: Diagnose an Atlassian "Forge Functions usage" alert (free tier 100,000 GB-seconds/month per app) — find which function or trigger is burning compute, using the Developer console's own metrics. Use when a Forge usage alert fires, when asked why GB-seconds are high, which tenant is heavy, or whether a trigger/resolver is billable. Triggers on "Forge Functions usage", "GB-seconds", "usage alert", "why is compute high", "Forge billing".
---

# Forge Functions usage & cost (GB-seconds)

When an Atlassian "Forge Functions usage" alert fires (free tier: **100,000 GB-seconds/month per app**), **find where the compute goes from the Developer console's own metrics — do NOT infer it from the manifest or from billing-label reasoning.** (We wasted several rounds in June 2026 guessing `exportMacro`, then "sync resolvers", before the console settled it.)

## Ground-truth path

`developer.atlassian.com/console/myapps/<appId>/`:

- **Metrics → Invocation → Invocation count, "Group by: Source"** — per-function/per-trigger invocation counts. This is the dispositive view.
- **Metrics → Invocation → response time, "Group by: Function"** — per-function duration. GB-seconds = invocations × duration × memory, so the driver is the source that's high on **both** count and duration.
- **Usage and charges → Functions → Site breakdown** — per-tenant GB-seconds (find the heavy tenants).

## Billing subtleties that burned us — get these right

- **A product-event `trigger` that forwards to a `remote` endpoint is billed as SYNC compute, not waived async.** The "Async (WAIVED)" bucket on the usage page is only function-based async (e.g. `pageCaptureFn`, `scheduledTrigger`) — do not assume a trigger is "async therefore free".
- The per-macro `resolver: endpoint: remote-connect` runs on **Cloudflare**, so it does **not** bill Forge Functions GB-seconds. `functions/*` console.logs are Cloudflare cost, not Forge cost.
- A tenant can be huge in GB-seconds yet show **zero** Mixpanel `macro_viewed` — because (a) `avi:confluence:viewed:page` fires tenant-wide on every page view regardless of our macros, and/or (b) the tenant blocks client-side Mixpanel (server-side events still arrive). Absence of `macro_viewed` is **not** evidence of zero usage.

## Historical driver

2026-06: `remote-page-behavior-trigger` (`avi:confluence:viewed:page`) was **~98%** of all invocations and GB-seconds — it fired on every page view across all installs and forwarded to `/forge-user-behavior` (`functions/forge-user-behavior.ts`) only to record low-value, Confluence-wide `page_viewed` telemetry. Disabled in PR #234.
