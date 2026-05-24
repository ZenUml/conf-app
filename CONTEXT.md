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

## Relationships

- A **macro** (Diagram, Graph, OpenAPI, or Embed) appears in the Confluence macro browser and renders one or more **DiagramType**s.
- The **Diagram macro** renders three DiagramTypes (Sequence/ZenUML, Mermaid, PlantUml); the others map 1:1.

## Error taxonomy

Errors are grouped by the phase of the macro lifecycle where they occur. All emit Mixpanel events via `trackEvent(label, action, category)`.

| Group | Mixpanel event(s) | Phase | Health signal |
|---|---|---|---|
| **Save errors** | `save_failed`, `update_custom_content_error`, `save_existence_check_failed` | User hit Save → content not persisted | Any spike is a red flag |
| **Load errors** | `load_macro`, `load_custom_content` | Macro opening → content not readable | Any spike means macros fail to open |
| **Render errors** | `render_failed` (`event_category` = diagram type) | Content loaded → diagram not displayed | Any spike is a red flag |
| **Orphan errors** | `customcontent_orphan_observed`, `load_custom_content_v2_missing` | Load: CC ID no longer resolves | Track orphan total, `recovery_used=false`, and `v2_missing` separately; `v2_missing` spike without matching orphan spike = gap in orphan detection |
| **Export errors** | `attachment_upload_failed` | Export/PNG write | Any spike means export broken |

_Avoid_: calling all `*_failed` events "errors" without grouping — they have different severities and owners. AI generation failures (`ai_generation_failed`) and feature-flag fetch failures (`feature_flags_fetch_failed`) are soft degradations, not core errors.

## Flagged ambiguities

- `Sequence` (DiagramType enum value) and "ZenUML" (user-facing brand) refer to the same rendering engine — resolved: prefer "ZenUML" in user-facing text; keep `Sequence` only in code that references the enum.
