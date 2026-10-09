## Scope and method
Read-only code reading at worktree HEAD d9cbb92d. No Mixpanel queries, no tenant data. "Shipped" means what the deploy path leaves in the manifest. That path is `.github/workflows/release.yml` and `staging-deploy.yml`, which carry their own yq strips parallel to `scripts/forge-wizard.mjs`. Where the two differ I say so.

## Variant coverage at a glance (after strips)

| Module | Lite | Full | Diagramly | AsyncAPI |
|---|---|---|---|---|
| Macros: sequence (Mermaid/PlantUML/ZenUML), openapi, graph, embed | yes | yes | yes | no (only openapi + asyncapi macros) |
| AsyncAPI macro (`zenuml-asyncapi-macro`) | yes | no | no | yes (also the embed macro) |
| pageBanner `zenuml-page-banner` | yes | yes | yes | yes (host ships; only the unplaced module is stripped) |
| pageBanner `zenuml-unplaced-banner` | yes | no | no | no |
| homepageFeed | yes | yes | yes | no |
| globalSettings "Get Started" | yes | yes | no (CI strips it) | no |
| globalPage dashboard `zenuml-dashboard-page` | yes | yes | no | no |
| globalPage `zenuml-plan-usage-page` | yes | no | no | no |
| byline `zenuml-byline-newuser` | yes | yes | yes | no |
| byline `zenuml-byline-diagrams` | yes | no | no | no |
| byline `zenuml-byline-aiaide` | no | no | yes | no |
| spacePage `zenuml-asyncapi-dashboard-page` | no | no | no | yes |
| autoConvert paste-to-create matchers (`/new/<type>`, `/d/<type>/*/*`) | yes | no | no | no |
| Scheduled triggers | `lite-macro-count-daily` | `full-lite2full-hourly`, `full-presence-daily` | `diagramly-demo-page-pipeline` | none |

Sources: manifest.yml 203-720; forge-wizard.mjs 12-395; release.yml 126-300.

- Divergence: for Diagramly the wizard (line 221) deletes the whole `confluence:globalSettings`, including `diagramly-admin-create-demo-page`. release.yml 205-212 deletes only `zenuml-get-started-settings` and `globalPage`, so the admin demo-page entry survives in the production deploy. The CI path is the one that ships.
- The wizard comment at forge-wizard.mjs 218 says CI keeps its own copy of these edits.
- The `zenuml-prepared-diagram` property that gates the "View as diagram" byline is not written anywhere in this repo's src. It is read in the manifest and written by an out-of-repo curation pipeline (docs/superpowers/specs/2026-08-12-prepared-diagram-curation-portal-design.md). Whether that pipeline is live is unknown.

## Surface table

Status key: live = code path present and not build-gated off. "Live (code)" means I did not verify production flag values.

| Surface | Module type + key | Renders where | Audience | Gate | Variants | Mixpanel events | Status |
|---|---|---|---|---|---|---|---|
| Macro viewer | `macro` (sequence/openapi/graph/embed keys) | Inline in page | Everyone, including anonymous and unlicensed (`unlicensedAccess: unlicensed, anonymous`) | none | L/F/D (A: openapi + asyncapi only) | `macro_viewed`, `fullscreen_opened`, `viewport_control_used`, `viewer_source_opened`, `copy_for_ai_*`, `deeplink_copied` | live |
| Page banner host | `confluence:pageBanner` `zenuml-page-banner` | Above content on every page load | Every viewer. Banner choice is decided from localStorage only | Priority: paywall > csat > unplaced marker > whats-new. `none` closes the iframe. `routes/pageBanner.ts`, `utils/banners/priority.ts` | L/F/D/A | `unplaced_banner_evaluated`, `whats_new_banner_evaluated`, `space_admin_active`, first-seen ping | live |
| Paywall warning banner | Component inside the banner host | Page banner | Recent macro authors; space admins if flag on | Lite only via the `PAYWALL_ADMIN_BANNER_FLAG`. KV `CUSTOMER_SUCCESS_SERVICE` / `PAYWALL_EXEMPT` via `functions/feature-flags.ts`. Impression taper plus 7-day snooze (warningBanner.ts) | Lite logic. Component code is in all builds; the targeting marker is written only where paywall is on | `paywall_banner_shown`, `paywall_banner_dismissed`, `paywall_bundle_cta_clicked`, `paywall_marketplace_cta_clicked`, `paywall_learn_more_clicked` | live (Lite) |
| CSAT survey | Component inside the banner host | Page banner | Whoever just saved a macro, in the same browser | `csatPending` localStorage marker, fresh 10 minutes, set on save (Persistence.ts:130, forge-embed-editor.ts:74). `csat_state` suppression per account | All builds. I found no variant filter in code | `csat_displayed`, `csat_submitted`, `csat_dismissed` | live |
| What's new strip | Component inside the banner host | Page banner | Browsers with a `whatsNewAudience` marker (saw a macro in the last 90 days), at most 3 impressions per release | Release list `utils/whatsNew/releases.ts`. 30-day window. Per-release `variants`. localStorage record | Per release. Current: `2026-10-anonymous-viewing` on lite+diagramly, from 2026-10-06. `2026-10` on lite/full/diagramly, from 2026-10-03 | `whats_new_banner_evaluated`, `_shown`, `_expanded`, `_dismissed`, `whats_new_link_clicked` | live. Two releases are windowed today. |
| Unplaced-diagram banner | `pageBanner` `zenuml-unplaced-banner` | Page banner | Page viewers when a saved diagram is not placed on the page | Server-side `entityPropertyExists zenuml-unplaced-diagrams-lite`, written by the Lite byline | Lite only | `unplaced_banner_evaluated`, `unplaced_banner_shown`, `unplaced_banner_dismissed`, `unplaced_property_write` | live (Lite) |
| Byline "Diagrams Lite" index and create | `contentBylineItem` `zenuml-byline-diagrams` | Byline, opens a medium modal on click | Everyone on the page | `not entityPropertyExists zenuml-full-active` on the space. The opt-in leg was removed (manifest 595-650) | Lite only | `byline_opened`, `byline_diagram_opened`, `byline_create_clicked`, `byline_diagram_created`, `byline_create_cancelled`, `byline_editor_deeplinked`, `byline_thumbnails_loaded`, `byline_unplaced_scanned`, `byline_view_close_requested`, `byline_diagram_source_copied`, `byline_list_retried`, `byline_dismissed`, `diagram_added_to_page` | live |
| Byline "View as diagram" | `contentBylineItem` `zenuml-byline-newuser` | Byline, fullscreen modal | Everyone on pages that carry the property | `entityPropertyExists content zenuml-prepared-diagram`. Property writer is outside this repo | L/F/D | `activation_served`, `activation_nudge_clicked`, `activation_nudge_dismissed`, `activation_completed`, `activation_diagram_edited`, `activation_cache_miss` | live (code). Count of pages with the property: UNKNOWN |
| Byline "Aide" | `contentBylineItem` `zenuml-byline-aiaide` | Byline, fullscreen modal | Everyone | none | Diagramly only | `ai_aide_route_accessed` | live |
| Homepage feed card | `confluence:homepageFeed` `zenuml-homepage-feed` | Confluence Home right panel | Any Home visitor with the section expanded | none (no flag). `routes/homepageFeed.ts` | L/F/D | `homepage_feed_viewed`, `homepage_feed_action_clicked`, `homepage_feed_diagram_opened`, `homepage_feed_example_expanded` | live. No create button by design; links are 3 own diagrams plus examples and a docs link |
| Get Started | `globalSettings` `zenuml-get-started-settings` (`useAsGetStarted`) | Settings, admin area | Site admins in practice | none | L/F | `get_started_page_view`, `get_started_create_*`, `get_started_view_docs` (legacy `trackEvent` form) | live. "Create" buttons only show a toast telling the user to insert a macro (GetStarted.vue:160-190) |
| Dashboard | `globalPage` `zenuml-dashboard-page` | Apps menu | Any user | none. Same UI as Get Started (forgeIndex routes to `handleGetStartedRoute`) | L/F | same as Get Started | live |
| Plan and usage | `globalPage` `zenuml-plan-usage-page` | Apps menu | Any user | none | Lite only | `plan_usage_viewed`, `plan_usage_request_full_clicked`, `plan_usage_purchase_clicked`, `request_full_*` | live |
| Template gallery | Editor header button "Templates" (Header.vue:27) | Macro editor | Authors | Hidden for Markdown. Auto-open once per cloudId plus type (`autoOpenMarker.ts`) when a new macro is empty | All variants with an editor | `editor_template_gallery_opened`, `editor_template_applied`, `editor_starter_shown` | live |
| Create guide | Viewer "Create" button, forge modal `macroMode create-guide` | Viewer toolbar | Users who can edit | `create-guide-enabled` flag (default false), `forgeGlobal.isLite`, not fullscreen, type has a guide (GenericViewer.vue:836-846) | Lite only. Videos name the Lite macros (docs/features/create-guide.md) | `create_guide_impression`, `create_guide_opened`, `create_guide_closed`, `create_guide_open_failed` | dark by default (flag default false; prod value unknown) |
| Second-diagram prompt | Component in viewer | Viewer | Authors | Build constant `VITE_SECOND_DIAGRAM_PROMPT_ENABLED` = false (vite.config.mjs:115) | none | `macro_second_diagram_prompt_shown`, `macro_second_diagram_prompt_clicked` | dark |
| Feedback edge | Hover edge in every iframe except byline and banner | Viewer, editor, fullscreen, dashboard, get-started | Everyone who sees the iframe | none (`feedbackSurfaceForContext`, `installFeedbackHost`) | All | `feedback_report_*` (opened, capture_*, submit_*, handoff_*, dismissed) | live |
| AI Chat | Editor header button | Editor | Authors | `ai-chat-enabled` (default false) | Variant filter: UNKNOWN (flag is per Forge app) | `ai_chat_*` | gated |
| AI Repair | SyntaxErrorBox | Editor, on syntax error | Authors | `ai-repair-enabled` (false); `ai-chat-repair-enabled` (false) routes it to Chat | per app flag | `ai_repair_*` | gated |
| Agent Link | Connect button, badge, fullscreen rail | Viewer | Viewer users on sequence, mermaid, plantuml | `agent-link-enabled` (false) | per app flag | `agent_link_*` | gated |
| Staleness hint | `maybeShowStalenessHint` | Editor | Authors | `editor-staleness-hint-enabled` (false) | per app flag | `staleness_hint_*` | gated |
| Related diagrams footer | Viewer footer | Viewer | Everyone | `architecture-tokens-enabled` (false); sequence and mermaid-sequence only | per app flag | not itemised | gated |
| Space dashboard "My API Documents" | `confluence:spacePage` | Space sidebar | Space users | none | AsyncAPI only | feedback surface `dashboard` | live |

## Answers

### (1) Surfaces on Lite that Full or Diagramly lack
- Byline "Diagrams" index plus create: Lite only. Full ships only "View as diagram". Diagramly ships "View as diagram" plus "Aide".
- Unplaced-diagram banner and its content-property write: Lite only.
- Create guide button: Lite only, in code (`forgeGlobal.isLite`), and also behind a flag.
- Plan and usage page, paywall warning banner, Request-Full flow and extension request: Lite only.
- Paste-to-create deeplink matchers: Lite only. They are stripped elsewhere to avoid collisions on sites that have both apps.
- Get Started and dashboard pages: Full has them, Diagramly does not.
- AsyncAPI macro in the Lite build: Lite and AsyncAPI only.
- Present on Lite, Full and Diagramly alike: homepage feed, page-banner host (CSAT, What's new), template gallery, feedback edge, View Source, Copy for AI, Export PNG, zoom.
- Homepage feed on Full is shipped. No strip exists (release.yml strips it only for asyncapi, line 273).
- Not present on any variant in code, or dark: second-diagram prompt (build constant false).
- What's new is per release. The 2026-10-anonymous-viewing release excludes Full and AsyncAPI.
- Diagramly-only: Aide byline and the demo-page pipeline.
- Full-only: the Lite-to-Full conversion executor and the presence marker.

### (2) Forge module types
Used by the manifest (generic: `macro`, `trigger`, `scheduledTrigger`, `endpoint`, `function`; Confluence: `confluence:customContent`, `confluence:contentBylineItem`, `confluence:pageBanner`, `confluence:homepageFeed`, `confluence:globalPage`, `confluence:globalSettings`, `confluence:spacePage`; plus `connectModules` `confluence:lifecycle`).

Confluence Forge module list per the Atlassian docs navigation (WebFetch of the homepage-feed reference page, 2026-10-06): Background script, Content action, Content byline item, Content property, Context menu, Custom content, Full page (Preview), Global page, Global settings, Homepage feed, Macro, Page banner, Space page, Space settings.

Not in manifest (each grep returned 0 matches in manifest.yml):
- `confluence:spaceSettings`
- `confluence:contentAction`
- `confluence:contextMenu`
- `confluence:backgroundScript`
- `confluence:fullPage`
- Content property module (`contentProperty`)
- `rovo:`
- `jira:`
- `webtrigger`
- `automation:`
- `consumer`
- `compass:`
- `bitbucket:`
- `jiraServiceManagement:`

No Forge template or blueprint module appears in that Confluence list. I did not verify the absence elsewhere on the docs site.

### (3) Forge feature flags the code reads
All default to false in every `checkFlag(name, false)` call. All are fail-closed. Sources: `src/apis/aiTitleFeatureFlag.ts:4-9`, `utils/stalenessHint/flags.ts:4`, `utils/paywall/adminBannerFlag.ts:19`, `utils/analytics/sessionReplayFlags.ts:45-46`.

| Flag | Gates | Variant use |
|---|---|---|
| `ai-chat-enabled` | AI Chat button | per app |
| `ai-chat-repair-enabled` | AI Repair delegating to Chat | per app |
| `ai-repair-enabled` | AI Repair in SyntaxErrorBox | per app |
| `agent-link-enabled` | Connect UI | per app |
| `architecture-tokens-enabled` | Related-diagrams footer | per app |
| `create-guide-enabled` | Viewer Create button | Lite effective (code also requires `isLite`) |
| `editor-staleness-hint-enabled` | Editor stale hint | per app |
| `paywall-admin-banner-enabled` | Admin paywall banner audience | Lite effective |
| `session-replay` | Sampled replay rollout | per app |
| `session-replay-full` | Targeted full replay | per app |

That is 10 distinct flag names in code. `ai-title-enabled` is no longer read; its commit says "remove rollout flag".

What occupies Lite's 10 slots in the Developer Console is UNKNOWN from code. The memory note dated 2026-08-27 lists 8 live: `agent-link-enabled`, `ai-repair-enabled`, `ai-title-enabled`, `editor-staleness-hint-enabled`, `paywall-admin-banner-enabled`, `session-replay`, `session-replay-full`, `architecture-tokens-enabled`. Since then the code has added `ai-chat-enabled`, `ai-chat-repair-enabled` and `create-guide-enabled`, and dropped `ai-title-enabled`. A Console read is needed for the real count.

Not Forge flags, but they act as gates:
- KV `CUSTOMER_SUCCESS_SERVICE` and `PAYWALL_EXEMPTIONS` via `/feature-flags` (functions/feature-flags.ts:13-85).
- Build constant `VITE_SECOND_DIAGRAM_PROMPT_ENABLED`.
- localStorage mocks used by tests only.

### (4) Support and feedback surfaces
- CSAT: page-banner host, 5-face rating plus comment (`CsatBanner.vue`).
- Feedback report: hover edge "Feedback" in viewer, editor, fullscreen, get-started, dashboard. It opens a Forge modal with a screenshot capture option (`features/feedback`).
- AI Repair: syntax-error box in the editor.
- AI Chat: editor header.
- Aide: Diagramly byline.
- Agent Link: viewer toolbar and fullscreen rail.
- Extension request and Request-Full: paywall modal (`UpgradePrompt`) and Plan and usage page, both Lite only. Events: `extension_request_clicked`, `extension_action_*`, `advocacy_message_copied`. The JSM integration is only referenced in the client through those events; I did not trace the server side.
- Load-failure panel in the viewer: "Try again" and "Contact support" buttons.
- Help button in the editor header opens docs.
- Get Started "view docs": opens the docs space.

### (5) Reader-actionable controls in the viewer, in toolbar order
Source: `GenericViewer.vue:79-232`, gates at 693-846.

Top row (hidden until hover, except Create):
1. Highlight toggle (Mermaid only, via the `viewer-actions` slot of `MermaidHighlightViewer`). Visible to readers.
2. Edit: needs `canUserEdit`. Not a reader action.
3. Magic / Original switch: fullscreen, Mermaid only, only when the diagram carries a prepared `magic` body.
4. Source: all readers, text types (sequence, mermaid, plantuml, markdown).
5. Copy for AI split button plus its 5-job menu: all readers, same text types.
6. Connect: `agent-link-enabled`, sequence/mermaid/plantuml, not fullscreen.
7. Fullscreen.
8. Create: editors only, Lite, flagged.

Canvas:
- Zoom out and zoom in chip at top right (`DiagramViewportToolbar`), plus Ctrl/Cmd+scroll and a hint overlay.

Bottom pill ("Diagram actions" toolbar):
1. Copy diagram link: needs custom content and a deeplink host (not asyncapi).
2. Export PNG.
3. Versions: custom content only.
4. Copy page link.
5. More menu, with one entry: Download debug info.

Footer:
- Related-diagrams row (flag, sequence only).
- Attribution line: creator, last editor, view count (diagram-impact registration after a 3-second dwell).

Other:
- Feedback edge.
- Second-diagram prompt: dark.
- Graph, OpenAPI and AsyncAPI viewers: I did not trace whether they use `GenericViewer` toolbars the same way. UNKNOWN.

## Stale or contradictory docs noticed
- docs/features/page-banner.md still says "if we ever add `confluence:pageBanner`". The module is live in all four variants.
- The forge-wizard Diagramly strip differs from release.yml (see above).

## FACTS
- [READ_FROM_CODE] Lite ships byline 'diagrams' + 'newuser'; Full ships only 'newuser'; Diagramly ships 'newuser' + 'aiaide'; AsyncAPI ships no byline — .github/workflows/release.yml:150-176 comment block and steps; scripts/forge-wizard.mjs:35-40,149-153,243-247,350
- [READ_FROM_CODE] homepageFeed ships on Lite, Full and Diagramly; only AsyncAPI strips it — release.yml:273-277; forge-wizard.mjs:348-350; manifest.yml:535-550
- [READ_FROM_CODE] Get Started (globalSettings) and dashboard (globalPage) ship on Lite and Full, not Diagramly or AsyncAPI; plan-usage page Lite only — release.yml:186-212; forge-wizard.mjs:104-110,221
- [READ_FROM_CODE] Wizard and release.yml disagree on Diagramly: wizard deletes whole globalSettings (incl. diagramly-admin-create-demo-page), CI deletes only the get-started entry — forge-wizard.mjs:221 vs release.yml:205-212
- [READ_FROM_CODE] Page banner host decides paywall > csat > unplaced > whats-new from localStorage only; module ships in all four variants — src/routes/pageBanner.ts:1-90; manifest.yml:481-533; forge-wizard.mjs:360 strips only zenuml-unplaced-banner for asyncapi
- [READ_FROM_CODE] What's new: max 3 impressions per release, audience marker 90 days, window 30 days; current releases 2026-10-anonymous-viewing (lite, diagramly, from 2026-10-06) and 2026-10 (lite/full/diagramly, from 2026-10-03) — src/utils/whatsNew/state.ts:25-35; src/utils/whatsNew/releases.ts:50-90
- [READ_FROM_CODE] Create guide button requires isLite, create-guide-enabled flag (or DEV), canUserEdit, not fullscreen — src/components/Viewer/GenericViewer.vue:836-846; docs/features/create-guide.md
- [READ_FROM_CODE] Second-diagram prompt is build-time disabled — vite.config.mjs:115 VITE_SECOND_DIAGRAM_PROMPT_ENABLED false; SecondDiagramPrompt.vue header
- [READ_FROM_CODE] Code reads exactly 10 distinct Forge flags, all default false — src/apis/aiTitleFeatureFlag.ts:4-9,92-156; stalenessHint/flags.ts:4; paywall/adminBannerFlag.ts:19; analytics/sessionReplayFlags.ts:45-46
- [UNKNOWN] Which flags currently occupy Lite's 10 Console slots is not derivable from code; last Console-verified memory (2026-08-27) listed 8 incl. ai-title-enabled, which code no longer reads — memory reference_lite_flag_cap_state.md; git log of aiTitleFeatureFlag.ts shows 'remove rollout flag'
- [READ_FROM_CODE] Manifest uses macro, trigger, scheduledTrigger, endpoint, function, confluence:{customContent,contentBylineItem,pageBanner,homepageFeed,globalPage,globalSettings,spacePage}, connectModules confluence:lifecycle — manifest.yml lines 198-721 (grep '^  [A-Za-z:]+:')
- [WEB_SOURCE] Confluence Forge module types per Atlassian docs nav: Background script, Content action, Content byline item, Content property, Context menu, Custom content, Full page (Preview), Global page, Global settings, Homepage feed, Macro, Page banner, Space page, Space settings — https://developer.atlassian.com/platform/forge/manifest-reference/modules/confluence-homepage-feed/ (WebFetch 2026-10-06)
- [MEASURED] Unused Confluence module types: spaceSettings, contentAction, contextMenu, backgroundScript, fullPage, contentProperty (grep count 0 in manifest.yml); also no rovo:, jira:, webtrigger, automation: — grep -c on manifest.yml returned 0 for each
- [READ_FROM_CODE] Feedback edge button is installed on every non-byline, non-banner iframe (viewer, editor, fullscreen, get_started, dashboard) with no flag — src/features/feedback/feedbackContext.ts:12-33; mountFeedback.ts:13-20; forgeIndex.ts:1186-1192
- [READ_FROM_CODE] The zenuml-prepared-diagram property that gates 'View as diagram' is not written by code in this repo's src — grep -rn zenuml-prepared-diagram: only manifest.yml:667, tests, docs/superpowers specs
- [READ_FROM_CODE] Viewer reader actions include Source, Copy for AI, Fullscreen, zoom chip, copy diagram link, Export PNG, Versions, copy page link, More>Download debug info — GenericViewer.vue:79-232, 380-420; DiagramViewportToolbar.vue
- [READ_FROM_CODE] docs/features/page-banner.md is stale (says 'if we ever add' while module is live) — docs/features/page-banner.md:3-6 vs manifest.yml:481

## OPEN QUESTIONS
- Which flags actually occupy Lite's 10 Developer Console slots today? Needs a Console read.
- What are the production values of create-guide-enabled, ai-chat-enabled, ai-chat-repair-enabled and agent-link-enabled on each variant?
- Who writes zenuml-prepared-diagram and on how many pages is it set? This sets the real reach of the 'View as diagram' byline.
- Does the CSAT banner or the template gallery have any variant filter beyond what I read? I found none.
- Do Graph, OpenAPI and AsyncAPI viewers expose the same reader toolbar? showViewSource limits Source and Copy for AI to text types, but I did not trace those viewers.
- Which Diagramly build does the production deploy produce for the admin demo-page entry? CI keeps it; the wizard drops it.
- Is a Forge template/blueprint module available for Confluence? None appears in the docs nav I fetched.

## FILES
