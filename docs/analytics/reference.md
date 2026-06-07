# Analytics & Observability Reference

For Mixpanel/D1 query patterns, JQL examples, and analysis workflows, use the **conf-app** agent skill (triggers on "analytics", "mixpanel", "D1 query", etc.).

Paywall and upgrade event names: [upgrade-tracking-event-reference.md](upgrade-tracking-event-reference.md).

**Related reading:** [events-flow.md](events-flow.md) — end-to-end event pipeline; [improvements.md](improvements.md) — analytics improvement backlog.

## Event storage

| Event | Storage | Purpose |
|-------|---------|---------|
| `page_viewed`, `page_updated` | D1 `AnalyticsEventFact` (full hostname as `clientDomain`). Replaced `UserBehaviorEvent` on 2026-05-02; older rows still live in `UserBehaviorEvent` for May 1 and earlier. | Tenant activity signal — fires for any Confluence page with the macro installed, NOT specific to macro views |
| `macro_viewed` | Mixpanel only | Actual macro view counts; use for paywall/engagement analysis. **Was named `view_macro` before 2026-04-28** — always use `macro_viewed` for monitoring; a small trickle of `view_macro` may still appear from old cached app versions. |
| Install/uninstall lifecycle | R2 `atlassian-events` bucket (`{domain}/lifecycle/{isoDate}.json`) | Forge install events |

> Mixpanel tracking for `page_viewed`/`page_updated` is intentionally commented out in `functions/forge-user-behavior.ts:62`.

> **Mixpanel data coverage:** event tracking started ~2026-04-18. Any query window that extends before that date will return empty or partial data. Never trust 30d/90d windows without first checking the earliest event date; annualize estimates from the actual coverage window.

## Interpreting `page_viewed` in D1

`page_viewed` fires whenever a user views any Confluence page on a site where our macro is installed. It does **not** mean the user viewed one of our macros. Use it to determine whether a **tenant is active on Confluence** (i.e., people are using the product at all). For macro-specific engagement, use Mixpanel `macro_viewed`.

The `AnalyticsEventFact` schema has richer columns than the legacy `UserBehaviorEvent` (key fields: `eventTime`, `eventDate`, `cloudId`, `macroUuid`, `diagramType`, `eventCategory`, `eventSource`, `appVersion`, `r2Key`). Aggregate views: `AnalyticsDailyEventSummary`, `AnalyticsWeeklyClientActivity`, `AnalyticsDailyCsat`.

## Key analytics sources

- **D1 `conf-zenuml-prod`** — tenant activity (`AnalyticsEventFact` since 2026-05-02; `UserBehaviorEvent` for ≤ 2026-05-01), install records (`ForgeInstallation`, `ClientInstallation`), content data
- **Mixpanel** — macro view counts (`macro_viewed`), filtered by `client_domain` property. **Project ID: `3373228`** (the `Diagramly.Ai` project; conf-app shares this single project — there is no separate one). Query via `mcp__mixpanel__Run-Query` with `project_id=3373228`, or via JQL using `API_Secret` from `.env.mixpanel`. Project display timezone is UTC+7, so hourly buckets need conversion when joining to D1 (which is UTC). **Note:** tracking started ~2026-04-18; `macro_viewed` was called `view_macro` before 2026-04-28 — use `macro_viewed` for all queries; a small residual volume of `view_macro` may appear from old cached clients.
- **KV metrics-inspect** — macro counts per space: `https://conf-lite.zenuml.com/admin/metrics-inspect?domain=<subdomain>` (subdomain prefix only, e.g. `example-tenant` — not the full hostname)

## `clientDomain` format

Two stores, two conventions — always match the store's form:

| Store | Form | Example |
|---|---|---|
| KV flags | subdomain prefix | `example-tenant` |
| D1 (`AnalyticsEventFact`, `UserBehaviorEvent`) | full hostname | `example-tenant.atlassian.net` |
| Mixpanel — all events (frontend + backend) | **subdomain prefix — no `.atlassian.net` suffix** | `example-tenant` |

> **Mixpanel `client_domain` has no `.atlassian.net` suffix.** When filtering Mixpanel queries, use the bare subdomain (`example-tenant`), not the full hostname (`example-tenant.atlassian.net`). D1 is the opposite — it stores the full hostname. Match the form to the store or joins will return zero rows.

Frontend source: `getSubdomain()` in `src/utils/ContextParameters/ContextParameters.ts:42-45`.
Backend source: regex on hostname in `src/export.js:34` (fixed 2026-05-16 to match frontend format).

## Paywall / upgrade events

See [upgrade-tracking-event-reference.md](upgrade-tracking-event-reference.md). Summary: the Lite paywall modal is advocacy-only; use `paywall_triggered` with `action_type: "header_badge"` for header Upgrade clicks (not modal copy events). Sources: `src/utils/upgradeTracking.ts`, `src/components/Viewer/GenericViewer.vue`, `src/components/UpgradePrompt/useUpgradeTracking.ts`.
