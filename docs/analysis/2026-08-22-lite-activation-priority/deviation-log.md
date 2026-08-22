# Lite activation batch 1B deviation log

## 2026-08-22 — Task 0 live ADF shape

The written spike removed only `attrs.localId` and `parameters.localId`. Live Lite staging ADF showed two additional source-bound fields: `parameters.guestParams.customContentId` and `parameters.embeddedMacroContext`. Reusing either could make the template render the source diagram and produce a false-positive spike. The script now constructs an allowlisted routing node, keeps `forgeEnvironment`, and submits empty `guestParams`.

Impact on implementation: the Task 2 builder needs `environmentType` in addition to `environmentId`, and its tests must assert that no instance identity or embedded context is emitted.

## 2026-08-22 — First-create edit path

The plan said to click Edit on the published macro. The in-view macro Edit action is intentionally hidden before a `customContentId` exists. The verified first-create path is page Edit → select the macro → Confluence macro-toolbar Edit → Publish → page Update. After the first save, the in-view Edit action appears normally.

Impact on E2E and product copy: first-save verification must exercise the page editor path; a published-view click cannot cover a template macro's initial save.

## 2026-08-22 — T5 author-leverage readout moved from D1 to Mixpanel

The planned D1 query grouped Forge Lite rows by `spaceId` and then treated that value as a tenant-space identity. Forge `CustomContent` and `CustomContentVersion` rows identify the variant app but carry no tenant domain or `cloudId`; Confluence `spaceId` is tenant-scoped. The proposed query could therefore merge unrelated spaces and could not be joined reliably to `template_created`.

Impact on readout: `readout-t5-authors.js` computes first authors from `macro_create_succeeded`, keyed by Mixpanel's auto-enriched `client_domain` + `confluence_space`. `readout-t5-d1.sql` is a fail-closed explanatory guard rather than an aggregate. The public JQL baseline omits tenant-specific exclusions; operators must append the private exclusion list before running it.

## 2026-08-22 — E2E marker keys corrected

The plan's sample E2E used `zenumlPaywallTargeting` and `zenumlSpaceAdminProbe` prefixes. The production key builders use `paywallWarning:<domain>:<space>` and `paywallAdminProbe:<domain>:<space>`.

Impact on verification: the checked-in E2E writes the exact parsed production shapes and key prefixes. Playwright collection succeeded before deployment; the deployed behavior result is recorded below.

## 2026-08-22 — E2E uses a genuinely authorized template-admin space

The normal Lite staging fixture space lets the browser robot create pages but its live template-create response says the user lacks `manage_templates`. Seeding the cached `isAdmin` verdict therefore proved banner routing but could not honestly prove the success path. The checked-in E2E now discovers, through the current user's Confluence space operations, a space with `manage_templates` and a homepage; no account or space identifier is stored in the public test.

The live macro iframe also refreshes the shared paywall targeting marker after reload. A one-time `macroCount: 60` marker could be replaced by the space's real count before the page-banner iframe read it. The E2E now pins the existing supported macro-side mock inputs at 60, so both writers agree instead of racing.

Impact on verification: against the deployed Draft PR build, the real Forge-iframe flow displayed the 60-diagram offer, created the template, displayed `Template created`, persisted the returned template id, and deleted that exact ephemeral template with HTTP 204. The run passed 2/2 tests. The one diagnostic template created while isolating the permission issue was also deleted by exact id with HTTP 204.
