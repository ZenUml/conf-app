# Mixpanel Schema Redesign

Date: 2026-04-27
Status: Approved design, pending implementation
Branch: `docs/mixpanel-schema-redesign`

## Summary

This document defines a canonical Mixpanel event and property schema for the ZenUML Confluence Forge app.

The current analytics model is a Google Analytics style wrapper built around:

- event name = `action`
- supporting fields = `event_category`, `event_label`

That model still sends data, but it is a poor fit for Mixpanel. The main business meaning of an event is often stored in `event_label`, while Mixpanel only sees generic event names such as `click`, `load`, `impression`, or `blocked`.

The redesign introduces:

- flat `snake_case` canonical Mixpanel event names
- a small shared property model with clear responsibilities
- a typed frontend tracking API centered on canonical event names
- a temporary legacy adapter for existing `trackEvent(label, action, category, props)` calls
- backend normalization so old and new payloads can coexist during migration

The target outcome is straightforward Mixpanel reporting for feature usage and conversion funnels without requiring analysts to remember legacy `action` / `event_category` / `event_label` rules.

## Problem Statement

The current schema has several structural issues:

1. The Mixpanel event name is usually too generic.
   - Example pattern: `click` + `event_label=upgrade_cta_clicked`
   - This inverts Mixpanel semantics. The meaningful business fact should be the event name.

2. `event_category` is overloaded.
   - It currently mixes product area, diagram type, severity, and workflow grouping.
   - Examples include values such as `sequence`, `error`, `warning`, `conversion`, `forge_get_started`, and `operation`.

3. `event_label` is overloaded.
   - It may contain an event identifier, a macro UUID, a content ID, an error string, or an empty string.
   - This makes it hard to query and encourages high-cardinality noise.

4. The tracking API is easy to misuse.
   - The wrapper accepts a GA-shaped positional contract that is hard to read and easy to call incorrectly.
   - The codebase already contains inconsistent call patterns.

5. Newer tracking code is forced back into the legacy model.
   - Some newer event flows already have strong event names in code, but those names are still demoted into `event_label`.

## Goals

1. Make Mixpanel event names self-describing and business-meaningful.
2. Make high-value product funnels easy to build and maintain.
3. Keep a small, stable shared property model across event families.
4. Preserve rollout safety through a temporary compatibility bridge.
5. Add enough typing and validation that new analytics code is difficult to misuse.

## Non-Goals

1. Full migration of every low-value debug or historical analytics event in the first pass.
2. Perfect automatic translation of every legacy event forever.
3. Rebuilding all analytics around session replay or deep journey analysis first.
4. Permanent support for `event_category` and `event_label` as first-class concepts.

## Optimization Target

This redesign optimizes for:

- feature usage analysis
- conversion funnels

It does not optimize for session/journey analysis first. Session modeling can be added later once event names and shared properties are clean.

## Design Principles

1. Event names should answer "what happened?" without relying on extra fields.
2. Event meaning belongs primarily in the event name, not in overloaded generic properties.
3. Shared properties should be few, stable, and reusable.
4. Area-specific properties should be additive, not overloaded replacements for core meaning.
5. The canonical schema should be flatter and simpler than the implementation boundaries in code.
6. The legacy adapter should be temporary, narrow, and easy to delete.

## Canonical Event Model

### Naming Style

- Event names use flat `snake_case`
- Property names use `snake_case`
- Avoid nested namespaces in Mixpanel event names
- Avoid generic event names such as `click`, `load`, `save`, `blocked`, `impression`

### Naming Rules

Use event names that describe business facts:

- `*_requested` for user intent or system initiation
- `*_shown` for impressions
- `*_clicked` only when the click itself matters
- `*_opened` for opening an interactive UI surface
- `*_submitted` for user-submitted feedback or forms
- `*_succeeded` for successful completion
- `*_failed` for failure outcomes
- `*_dismissed` for explicit dismissals
- `*_cancelled` for abandoned flows

### Canonical Event Families

The catalog stays flat in Mixpanel, but is grouped into families in code and documentation.

#### Diagram events

- `diagram_viewed`
- `diagram_create_started`
- `diagram_create_succeeded`
- `diagram_edit_opened`
- `diagram_edit_cancelled`
- `diagram_save_succeeded`
- `diagram_save_failed`
- `diagram_export_requested`
- `diagram_export_succeeded`
- `diagram_export_failed`

#### AI events

- `ai_generation_requested`
- `ai_generation_succeeded`
- `ai_generation_failed`
- `ai_editor_opened`
- `ai_feedback_submitted`

#### Upgrade events

- `upgrade_modal_shown`
- `upgrade_cta_clicked`
- `upgrade_action_blocked`
- `upgrade_modal_dismissed`
- `upgrade_prompt_hovered`
- `upgrade_slider_changed`

#### Content events

- `content_sync_requested`
- `content_sync_succeeded`
- `content_sync_failed`
- `custom_content_loaded`

#### Confluence events

- `confluence_page_viewed`
- `confluence_page_updated`

#### Feedback events

- `csat_submitted`
- `feedback_link_clicked`

#### Error and system events

- `feature_flags_fetch_failed`
- `attachment_create_failed`
- `custom_content_update_failed`

These should remain explicit and specific. Avoid a catch-all canonical event such as `error_occurred` unless there is a well-defined operational need for one.

## Shared Property Model

Each canonical event should carry a small shared property set when the value is available.

### Base properties

- `feature_area`
- `diagram_type`
- `surface`
- `entry_point`
- `client_domain`
- `confluence_space`
- `macro_uuid`
- `user_account_id`
- `is_forge`
- `product_type`
- `environment_type`

### Requiredness

Properties fall into three buckets:

1. Required at emission time
   - `feature_area`
   - `surface`
   - `client_domain`
   - `user_account_id`
   - `product_type`
   - `environment_type`

2. Required when the event scope implies them
   - `diagram_type` for diagram events and AI events tied to a specific diagram type
   - `entry_point` for user-initiated UI flows
   - `macro_uuid` for macro-scoped events
   - `operation_mode` for create/edit/save lifecycle outcome events

3. Optional
   - `confluence_space`
   - `is_forge`
   - family-specific additive properties such as `persona`, `content_id`, `error_code`

Call-site rule:

- Callers must always provide the semantic fields they know directly, especially `feature_area`, `surface`, `entry_point`, `diagram_type`, and family-specific fields.
- The tracking layer is responsible for auto-enriching runtime context such as `client_domain`, `user_account_id`, `product_type`, `environment_type`, `confluence_space`, and `macro_uuid` where those can be derived centrally.

If a required-at-emission-time property cannot be derived, the tracker should emit an explicit sentinel value rather than omit it:

- `client_domain=unknown_atlassian_domain`
- `user_account_id=unknown_user_account_id`
- `product_type=unknown_product_type`
- `environment_type=unknown_environment_type`
- `entry_point=unknown`

### Property definitions

- `feature_area`
  - Broad product area such as `diagram`, `ai`, `upgrade`, `content`, `confluence`, `feedback`, `system`
- `diagram_type`
  - `sequence`, `mermaid`, `graph`, `openapi`, `embed`, `plantuml`, or `none`
- `surface`
  - Where the event occurred, such as `viewer`, `editor`, `modal`, `dashboard`, `route`, `forge_trigger`
- `entry_point`
  - Allowed values: `page_view`, `macro_toolbar`, `page_editor`, `get_started`, `viewer_notice`, `ai_prompt`, `dashboard`, `route`, `forge_trigger`, `unknown`
  - New values must be added to the central enum before use
- `client_domain`
  - Atlassian site hostname
- `confluence_space`
  - Confluence space key
- `macro_uuid`
  - Stable macro identifier where relevant
- `user_account_id`
  - Distinct user identifier used for Mixpanel
- `is_forge`
  - Whether the event came from Forge runtime context
- `product_type`
  - `lite`, `full`, `diagramly`
- `environment_type`
  - `development`, `staging`, `production`, or the corresponding Forge environment type

### Event-specific properties

Allow narrow additive property groups for specific event families:

- lifecycle
  - `operation_mode`
    - Allowed values: `create`, `edit`, `unknown`
  - `result`
  - `failure_reason`
- upgrade
  - `persona`
  - `product_option`
  - `ui_component`
  - `cta_position`
- AI
  - `prompt_length`
  - `generation_source`
- feedback
  - `feedback_value`
    - For AI feedback, allowed values are `good`, `partial`, `bad`
  - `feedback_score`
- content
  - `content_id`
  - `content_type`
  - `content_status`
- error
  - `error_code`
  - `error_name`
  - `error_source`

### Property rules

1. Do not encode the main event meaning in a property if it belongs in the event name.
2. Prefer enums over arbitrary strings where possible.
3. Avoid free-text high-cardinality properties except for narrowly scoped error/debug use.
4. If detailed error text is retained, keep it in explicitly named error properties rather than in an overloaded generic field.
5. Canonical events must not depend on `event_category` or `event_label`.

## Canonical Tracking API

### Frontend API

Introduce a new canonical tracking API:

```ts
trackAnalyticsEvent("diagram_viewed", {
  feature_area: "diagram",
  diagram_type: "sequence",
  surface: "viewer",
  entry_point: "page_view",
});
```

This API should make the Mixpanel event name first-class and explicit.

### Recommended TypeScript shape

```ts
type FeatureArea =
  | "diagram"
  | "ai"
  | "upgrade"
  | "content"
  | "confluence"
  | "feedback"
  | "system";

type DiagramTypeValue =
  | "sequence"
  | "mermaid"
  | "graph"
  | "openapi"
  | "embed"
  | "plantuml"
  | "none";

type Surface =
  | "viewer"
  | "editor"
  | "modal"
  | "dashboard"
  | "route"
  | "forge_trigger";

type EntryPoint =
  | "page_view"
  | "macro_toolbar"
  | "page_editor"
  | "get_started"
  | "viewer_notice"
  | "ai_prompt"
  | "dashboard"
  | "route"
  | "forge_trigger"
  | "unknown";

type OperationMode =
  | "create"
  | "edit"
  | "unknown";

type FeedbackValue =
  | "good"
  | "partial"
  | "bad";

type AnalyticsEventName =
  | "diagram_viewed"
  | "diagram_create_started"
  | "diagram_create_succeeded"
  | "diagram_edit_opened"
  | "diagram_edit_cancelled"
  | "diagram_save_succeeded"
  | "diagram_save_failed"
  | "diagram_export_requested"
  | "diagram_export_succeeded"
  | "diagram_export_failed"
  | "ai_generation_requested"
  | "ai_generation_succeeded"
  | "ai_generation_failed"
  | "ai_editor_opened"
  | "ai_feedback_submitted"
  | "upgrade_modal_shown"
  | "upgrade_cta_clicked"
  | "upgrade_action_blocked"
  | "upgrade_modal_dismissed"
  | "upgrade_prompt_hovered"
  | "upgrade_slider_changed"
  | "content_sync_requested"
  | "content_sync_succeeded"
  | "content_sync_failed"
  | "custom_content_loaded"
  | "confluence_page_viewed"
  | "confluence_page_updated"
  | "csat_submitted"
  | "feedback_link_clicked"
  | "feature_flags_fetch_failed"
  | "attachment_create_failed"
  | "custom_content_update_failed";

type AnalyticsProperties = {
  feature_area: FeatureArea;
  surface: Surface;
  client_domain?: string;
  user_account_id?: string;
  product_type?: string;
  environment_type?: string;
  diagram_type?: DiagramTypeValue;
  entry_point?: EntryPoint;
  confluence_space?: string;
  macro_uuid?: string;
  is_forge?: boolean;
  operation_mode?: OperationMode;
  result?: string;
  failure_reason?: string;
  prompt_length?: number;
  generation_source?: string;
  persona?: string;
  product_option?: string;
  ui_component?: string;
  cta_position?: "primary" | "secondary";
  feedback_value?: FeedbackValue;
  feedback_score?: number;
  content_id?: string;
  content_type?: string;
  content_status?: string;
  error_code?: string;
  error_name?: string;
  error_source?: string;
};

declare function trackAnalyticsEvent(
  eventName: AnalyticsEventName,
  properties: AnalyticsProperties,
): void;
```

The exact implementation should be stricter than this example. In real code, do not use a catch-all index signature. Model event-specific payloads through an `AnalyticsEventMap` or equivalent typed lookup so unsupported properties fail at compile time.

### Typed catalog

The event catalog should live in code, not just documentation.

Recommended structure:

- `shared/analytics/catalog.ts`
  - canonical `AnalyticsEventName` list and shared enums such as `FeatureArea`, `Surface`, `EntryPoint`, `DiagramTypeValue`
- `shared/analytics/types.ts`
  - base property types, event-family property types, endpoint request/response types
- `src/utils/analytics/trackAnalyticsEvent.ts`
  - canonical frontend tracker, runtime enrichment, and caller-facing API
- `src/utils/window.ts`
  - legacy `trackEvent(...)` adapter that delegates to the canonical tracker where mapping is defined
- `functions/service/normalizeAnalyticsEvent.ts`
  - normalization from canonical or legacy request payloads into a single server-side event shape
- `functions/service/mixpanelService.ts`
  - Mixpanel sender that consumes normalized canonical events
- `functions/track.ts`
  - `/track` endpoint request validation and asynchronous forwarding

If the repo cannot safely share a top-level `shared/` module between frontend and `functions/`, Phase 1 must create one shared analytics package or path alias consumed by both sides. Do not duplicate the catalog separately under `src/` and `functions/`.

## Legacy Adapter Design

The existing GA-style wrapper should remain temporarily:

```ts
trackEvent(label, action, category, props)
```

However, it should be treated as a legacy adapter, not as the canonical model.

### Adapter strategy

There are two migration paths for legacy calls:

1. Map high-value legacy events into canonical events where meaning is reliable.
2. Leave low-value legacy events unmigrated until touched, especially scattered debug/info/error calls.

Recommended approach:

- Map high-value user flows early.
- Defer noisy low-signal legacy events unless they matter to current reports.

### Legacy mapping examples

- `view_macro` -> `diagram_viewed`
- `create_macro_begin` -> `diagram_create_started`
- `create_macro_end` -> `diagram_create_succeeded`
- `save_macro` -> `diagram_save_succeeded`
- `page_viewed` -> `confluence_page_viewed`
- `page_updated` -> `confluence_page_updated`

### Ambiguous legacy events

Some legacy names should not be preserved 1:1 because they are not semantically precise enough.

Most importantly:

- `edit_*` is too ambiguous

Split it into actual business facts:

- opening edit UI -> `diagram_edit_opened`
- saving an edited diagram -> `diagram_save_succeeded` with `operation_mode=edit`
- cancelling editing -> `diagram_edit_cancelled`

### Legacy fields

If the implementation needs to preserve old fields temporarily during migration, they should be isolated as explicitly legacy concepts, for example:

- `legacy_action`
- `legacy_event_category`
- `legacy_event_label`

Do not allow those fields to remain core to the canonical API.

### Unmappable legacy calls

When a legacy call cannot be mapped cleanly to a canonical event:

1. Do not drop the event.
2. Pass the event through using the legacy transport shape so telemetry is preserved during migration.
3. In local development and tests, emit `console.warn` with the legacy signature and a short reason.
4. In staging and production, emit a sampled Sentry message named `legacy_analytics_unmapped` with tags for `legacy_action`, `legacy_event_category`, and `legacy_event_label`.
5. Apply time-window deduplication to operational warnings:
   - frontend: at most once per unique legacy signature per page load
   - backend: low fixed sampling plus at most one Sentry message per unique signature per worker isolate per 10-minute window when isolate-local cache is available

This keeps migration gaps visible without creating data loss or overwhelming operational signals.

## Backend Transport Model

The backend transport and Mixpanel service model should be updated so the canonical event name is explicit.

### Canonical transport shape

```ts
type MixpanelEvent = {
  event: string;
  properties: Record<string, string | number | boolean | null | undefined>;
};
```

### `/track` endpoint contract

- Method: `POST`
- Path: `/track`
- Content-Type: `application/json`
- Request body: exactly one JSON object per request in Phase 1, not an array batch

Canonical request shape:

```ts
type TrackCanonicalRequest = {
  transport_version: 2;
  event: AnalyticsEventName;
  properties: AnalyticsProperties;
  addon_key: string;
  version: string;
};
```

Legacy request shape accepted during migration:

```ts
type TrackLegacyRequest = {
  transport_version?: 1;
  action: string;
  event_category?: string;
  event_label?: string;
  client_domain?: string;
  user_account_id?: string;
  addon_key: string;
  version: string;
  [legacyProperty: string]: string | number | boolean | null | undefined;
};
```

Response contract:

- `204 No Content`
  - request accepted for asynchronous forwarding to Mixpanel
- `400 Bad Request`
  - invalid JSON or schema validation failure
- `403 Forbidden`
  - rejected referer/origin
- `415 Unsupported Media Type`
  - non-JSON body

Do not add array batching to `/track` in Phase 1. If batching is ever introduced later, it should be a separate versioned contract rather than an overloaded endpoint shape.

### Backend requirements

1. Canonical payloads must send the actual Mixpanel event name as `event`.
2. The backend may continue to accept legacy payloads temporarily.
3. If legacy payloads are accepted, the backend should normalize them into canonical events before sending them to Mixpanel.
4. The Mixpanel import layer should not treat `action` as the long-term domain model for event identity.

### Forge behavior events

The Forge trigger event mapping is already structurally closer to a proper Mixpanel model because it uses meaningful event names such as page view and page update events. Those should be migrated into the canonical naming style:

- `page_viewed` -> `confluence_page_viewed`
- `page_updated` -> `confluence_page_updated`

The surrounding properties such as `cloud_id`, `content_id`, `content_type`, `space_key`, and Forge environment metadata should be retained where they are useful.

## Migration Plan

### Phase 1: Canonical contract

- add the event catalog
- add shared property enums/types
- add the canonical frontend tracking API
- add the canonical backend transport model

Phase 1 implementation targets:

- `shared/analytics/catalog.ts` exists and compiles
- `shared/analytics/types.ts` exists and compiles
- `src/utils/analytics/trackAnalyticsEvent.ts` exists and is used by at least one migrated call site
- `functions/track.ts` validates the new canonical request contract
- at least one unit test covers a canonical event payload end-to-end through normalization

Phase 1 is not complete until those artifacts exist, one real call site has been migrated, and at least one canonical-path test passes.

### Phase 2: Compatibility bridge

- keep the old wrapper as a legacy adapter
- normalize legacy payloads into canonical events where mapping is reliable
- add temporary legacy fields only where needed for migration support

### Phase 3: High-value event family migration

Migrate these first:

- diagram lifecycle
  - view, create, edit-open, save, cancel, export
- upgrade funnel
  - modal shown, CTA clicked, blocked, dismissed
- AI funnel
  - generation requested, succeeded, failed, feedback submitted
- feedback
  - CSAT and similar user feedback flows
- Forge page behavior
  - Confluence page view/update events

### Phase 4: Mixpanel validation

- verify canonical events appear in staging
- compare old vs new event volumes for key flows
- rebuild primary Mixpanel dashboards and funnels using canonical events

Acceptance thresholds for Phase 4:

- For direct 1:1 mappings such as `view_macro` -> `diagram_viewed`, daily canonical counts should be within +/-5% of the legacy baseline for 3 consecutive validation days.
- For split or merged mappings such as `edit_*`, the combined canonical event set should be within +/-10% of the legacy baseline after documented semantic changes are accounted for.
- Required shared-property completeness should be at least 99% for `client_domain`, `user_account_id`, `product_type`, and `environment_type`.
- Contextual property completeness should be at least 95% for `diagram_type`, `surface`, `entry_point`, and `macro_uuid` on events where those fields are expected.
- No unexpected enum drift is allowed in `feature_area`, `diagram_type`, `surface`, or `entry_point`.

Phase 5 should not begin until these thresholds pass for the migrated high-value event families.

### Phase 5: Legacy cleanup

- stop adding new legacy-style calls
- remove legacy mappings once key reports no longer depend on them
- delete the bridge once canonical coverage is sufficient

## Rollout Guidance

### High-priority migration order

1. `diagram_viewed`
2. diagram create/save/edit lifecycle
3. upgrade funnel events
4. AI generation funnel
5. CSAT and feedback

This order matches the stated optimization target of feature usage and conversion analysis.

### Low-priority migration candidates

These can be deferred if they are not used in meaningful reports:

- scattered debug events
- incidental warning/info events
- old low-signal operational tracking

### Rollback strategy

During Phases 1-4, the legacy path must continue to fire in parallel for migrated high-value flows unless a specific flow is proven safe to cut over earlier.

Rules:

- Canonical emission should be controlled by a kill switch or feature flag so it can be disabled quickly if a schema or enrichment bug is discovered.
- If canonical events are found to be malformed or materially incomplete during rollout, disable canonical emission and continue shipping the legacy path while the fix is prepared.
- Do not remove the legacy path for a migrated high-value flow until Phase 4 acceptance thresholds pass for that flow.

## Validation And Testing

### Validation rules

1. Canonical event names must come from the typed catalog.
2. Shared properties should use constrained enums where available.
3. The legacy adapter should emit warnings when a call cannot be mapped cleanly.
4. New code should not emit canonical events through raw stringly typed wrappers if a typed helper exists.

### Test coverage

- unit tests for event normalization
- unit tests for legacy-to-canonical mapping
- unit tests for important event family payloads
- backend tests for `/track` normalization when legacy payloads are accepted

### Mixpanel rollout checks

- confirm the new event names appear with expected property sets
- compare legacy and canonical counts on key funnels during migration
- validate property cardinality for fields like `entry_point`, `surface`, and `diagram_type`
- verify no new important report depends on `event_category` or `event_label`

## Governance

Treat the event catalog as product infrastructure rather than ad hoc logging.

### Ownership and approval

- The canonical catalog should live in a dedicated analytics module, for example under `src/utils/analytics/`.
- Ownership belongs to the app maintainers responsible for analytics and product instrumentation, not to an ad hoc rotating reviewer.
- Any PR that adds or changes canonical event names, shared-property enums, or legacy mappings should receive one approving review from an analytics owner.
- Catalog changes should land in the same product PR as the first usage change. There should not be a separate approval queue or tracking spreadsheet.
- If the repository does not yet have CODEOWNERS coverage for the analytics module, add it during implementation so this process is enforced by the repo rather than by memory.

Rules:

1. New analytics work should add or reuse canonical events, not invent new GA-style wrappers.
2. New canonical events should be added to the central catalog before use.
3. Shared property names must be reused consistently across event families.
4. The migration bridge should stay intentionally narrow and should not become a permanent abstraction layer.

## Example Mappings

### Upgrade funnel

Current shape:

- event name in Mixpanel: `impression`
- meaning hidden in property: `event_label=upgrade_modal_shown`

Canonical shape:

- event name: `upgrade_modal_shown`
- properties:
  - `feature_area=upgrade`
  - `surface=modal`
  - `persona=creator`
  - `product_option=marketplace`

### Diagram view

Current shape:

- event name in Mixpanel: `view_macro`
- category/property mix varies by call site

Canonical shape:

- event name: `diagram_viewed`
- properties:
  - `feature_area=diagram`
  - `diagram_type=sequence`
  - `surface=viewer`
  - `entry_point=page_view`

### AI feedback

Current shape:

- event semantics depend on positional arguments and are easy to call incorrectly

Canonical shape:

- event name: `ai_feedback_submitted`
- properties:
  - `feature_area=ai`
  - `surface=modal`
  - `feedback_value=good`

## Risks

1. Over-migrating low-value legacy events can slow the rollout without improving core reporting.
2. Carrying both schemas for too long will preserve ambiguity and increase maintenance cost.
3. If the typed catalog is weak, the codebase can drift back into arbitrary strings.
4. If error fields remain free-text and ubiquitous, Mixpanel cardinality can become noisy again.

## Success Criteria

The redesign is successful when:

1. Key Mixpanel reports use canonical event names instead of `action + event_label` conventions.
2. Product funnels for diagram usage, upgrade conversion, and AI generation are readable without translation rules.
3. New analytics code is written against the canonical API by default.
4. Legacy `event_category` and `event_label` are no longer required for key analytics.
5. The temporary compatibility bridge is small, explicit, and removable.

## Implementation Decision

Recommended implementation strategy:

- canonical Mixpanel schema plus compatibility bridge

This is the cleanest option that is still straightforward in a live product because it gives the codebase a correct long-term model without forcing a risky all-at-once cutover.
