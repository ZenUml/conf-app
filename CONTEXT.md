# ZenUML for Confluence

The Confluence Cloud add-on (Forge app) that lets users author and render diagrams inside Confluence pages.

## Language

**Diagram macro**:
The Confluence macro that renders ZenUML, Mermaid, and PlantUML diagrams. Title shown in the macro browser is "Diagram (Mermaid, PlantUML & ZenUML)".
_Avoid_: Sequence macro (legacy internal key), bare "Diagram" (ambiguous with Confluence's native whiteboard).

**Graph macro**:
The Confluence macro that renders DrawIO-powered graph diagrams. Title is "Graph (DrawIO)".

**OpenAPI macro**:
The Confluence macro that renders OpenAPI / Swagger API specifications.

**Embed macro**:
A Confluence macro that embeds an existing Diagram, Graph, or OpenAPI rendering from elsewhere.

**DiagramType**:
Internal enum identifying the rendering engine of a stored diagram: `Sequence` (= ZenUML), `Mermaid`, `PlantUml`, `Graph`, `OpenApi`, `Embed`. One macro can host multiple DiagramTypes — the [[Diagram macro]] hosts `Sequence`, `Mermaid`, and `PlantUml`.
_Avoid_: engine, kind.

**Variant**:
A build flavour of the add-on: **lite** (free, paywalled), **full** (paid), **diagramly** (Diagramly-branded). All three are pure Forge.

**Surface**:
Where a piece of UI is mounted inside Confluence — the closed union in `src/utils/analytics/catalog.ts` (`Surface`). UI-bearing values: `viewer`, `editor`, `modal`, `page_banner`, `dashboard`, `route`, `byline`, `byline_modal`, `fullscreen`. Non-UI values (`forge_trigger`, `scheduled_job`, `support_automation`) exist only to label backend events. Surface is the organising axis for the Storybook sidebar, so one word names the same thing in Mixpanel, in `CONTEXT.md`, and in the component tree. The sidebar groups are *derived* from the union rather than equal to it: `editor` is subdivided into the two independent editor shells (`Workspace.vue`, `DrawIoExtension.vue`), and the `route` catch-all is split into the real pages behind it. Enforced by `src/components/storyTitles.spec.ts`.
_Avoid_: "screen", "page", "context" — and do not organise UI by component type (atom/molecule/layout), which cuts across this axis.

**Cross-surface component**:
A component whose surface is decided by its caller, not by where it lives — `UpgradePrompt` (its surface comes from `surfaceForActionType()`: `editor`, `viewer`, or `byline`), `PublishButton`, `TabSwitcher`, `DocumentList`. These have no single home in a surface-organised tree and are grouped under `Shared`.

**Export annotation（导出标注）**:
A text label, arrow, callout, or rectangle added to an image in the export workspace.

**Export watermark（导出水印）**:
A single text watermark applied to an image in the export workspace.

## Relationships

- A **macro** (Diagram, Graph, OpenAPI, or Embed) appears in the Confluence macro browser and renders one or more **DiagramType**s.
- The **Diagram macro** renders three DiagramTypes (Sequence/ZenUML, Mermaid, PlantUml); the others map 1:1.
- An exported image may contain multiple **Export annotations**, including multiple annotations of the same type; each can be selected, moved, and deleted independently.
- An exported image has at most one **Export watermark**.
- The export workspace downloads PNG or copies a PNG image to the clipboard; PNG is a fixed format label, not a format selector.
- **Export annotations** and the **Export watermark** affect only the exported image, never the source diagram.
- Export annotations and watermark settings belong to the current diagram's page visit: closing and reopening export preserves them, including reopening its fullscreen window; refreshing or leaving the page discards them. They are not saved annotation drafts.

## Error taxonomy

Errors are grouped by the phase of the macro lifecycle where they occur. All emit Mixpanel events via `trackEvent(label, action, category)`.

| Group | Mixpanel event(s) | Phase | Health signal |
|---|---|---|---|
| **Save errors** | `save_failed`, `update_custom_content_error`, `save_existence_check_failed` | User hit Save → content not persisted | Any spike is a red flag |
| **Load errors** | `load_macro`, `load_custom_content` | Macro opening → content not readable | Any spike means macros fail to open |
| **Render errors** | `render_failed` (`event_category` = diagram type) | Content loaded → diagram not displayed | Any spike is a red flag |
| **Orphan errors** | `customcontent_orphan_observed`, `load_custom_content_v2_missing` | Load: CC ID no longer resolves | Track orphan total, `recovery_used=false`, and `v2_missing` separately; `v2_missing` spike without matching orphan spike = gap in orphan detection |
| **Export errors** | `attachment_upload_failed` | Export/PNG write | Any spike means export broken |

_Avoid_: calling all `*_failed` events "errors" without grouping — they have different severities and owners. AI generation failures (`ai_title_generation_failed`) and feature-flag fetch failures (`feature_flags_fetch_failed`) are soft degradations, not core errors.

## Flagged ambiguities

- `Sequence` (DiagramType enum value) and "ZenUML" (user-facing brand) refer to the same rendering engine — resolved: prefer "ZenUML" in user-facing text; keep `Sequence` only in code that references the enum.
- **Is the paywall gate dead code?** The [[Paywall banner]] is described as the only in-app paywall surface, with editing never blocked, but `utils/paywall/mountPaywallGate.ts:258` still evaluates `editBlocked` / `createBlocked` and fires `PAYWALL_BLOCKED_EDIT` / `_CREATE`, mounting `PaywallGate.vue` → `UpgradePrompt.vue` from 8 entry points. Unresolved — settle it by reading `paywall_blocked_*` volume in Mixpanel, not from code. If the volume is zero, the description is right and the gate should be deleted; if not, that description is stale.
