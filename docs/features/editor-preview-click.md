# Editor preview click counter (P6 measurement)

Question: do authors click elements of the editor preview, expecting to edit a
node or to find it in the source? The answer decides whether to build "click a
node to select its source line". Nothing is built yet; this is the count.

## Event

`editor_preview_element_clicked`, at most one per editor session, Mermaid and
PlantUML only (the Sequence preview already edits names in place; Graph is
DrawIO). Code: `src/utils/viewport/previewClickTracker.ts`, attached by
`src/components/Workspace.vue` to the preview pane.

| Situation | Result |
|---|---|
| Press on a node, moves ≤ 4 px | Opens a 10 s window; event sent when it closes |
| Press that moves > 4 px (pan drag) | Counted in `preview_drag_count_before`; no window |
| Click on the svg background | Counted in `preview_background_click_count_before`; no window |
| Click on the toolbar | Ignored |
| Editor closes inside the window | Event sent at once, `preview_window_completed: false` |
| Second element click after the event | Nothing more this session |
| Sequence, Graph, OpenAPI preview | No event |

Properties: `macro_type`, `preview_target_kind` (node / cluster / edge /
label), `preview_zoomed_in_before`, `preview_code_panel_hidden`,
`preview_drag_count_before`, `preview_background_click_count_before`,
`preview_click_count_in_window`, `preview_double_click_count_in_window`,
`preview_source_focused_in_window`, `preview_source_changed_in_window`,
`preview_window_completed`, `preview_ms_since_editor_open`.

Sample rate: 100% until 2026-12-23 (UTC), then 10% with `sample_rate`
(`DATED_SAMPLE_RATES` in `src/utils/analytics/eventSampling.ts`).

Volume: at most one event per Mermaid/PlantUML editor session, about 13k a
month (1.3% of the 1M cap); expected 1.3k to 4k a month if 10% to 30% of
sessions click an element.

## Read-out rule

Read 28 days after the Lite production release that carries the event, per
diagram type (Mermaid, PlantUML separately).

Denominator: editor sessions that showed that type. A new diagram opens as
Sequence and authors often switch to Mermaid before pasting, and
`macro_create_started` / `macro_authoring_ended` keep the type the editor
opened with. So count, per account and editor session, `macro_edit_started`
or `macro_create_started` with that `macro_type`, plus `macro_type_changed`
with `to_macro_type` = that type. The numerator's `macro_type` is the type at
click time.

The 100% window ends on a fixed date, 2026-12-23. If Lite reaches production
later than 2026-11-25, move that date (one line in `DATED_SAMPLE_RATES`) so the
first 28 days stay at 100%.

Build "click a node to select its source line" for a type only when all three
hold:

| # | Measure | Threshold |
|---|---|---|
| 1 | Sessions with `preview_target_kind` = node, divided by the denominator above | ≥ 10% |
| 2 | Those sessions (after `sample_rate` extrapolation) | ≥ 50 |
| 3 | Of those, share with `preview_source_focused_in_window` or `preview_source_changed_in_window` | ≥ 30% |

Examples:

| Type | Editor sessions | Node-click sessions | Looked at / changed source | Decision |
|---|---|---|---|---|
| Mermaid | 11,000 | 1,320 (12%) | 500 (38%) | Build |
| Mermaid | 11,000 | 660 (6%) | 300 (45%) | Do not build (rule 1) |
| PlantUML | 550 | 40 (7%) | 20 (50%) | Do not build (rules 1 and 2) |
| Mermaid | 11,000 | 1,320 (12%) | 200 (15%) | Do not build (rule 3): clicks do not lead to the source |

Exclude internal sites (`is_internal_client_domain = "false"`).

## Known limits

- A pan drag shorter than 4 px counts as a click.
- "Looked at the source" is a focus event or a press inside the code pane, so
  a click into the code without reading counts too. (A press is needed: when
  the code editor already has focus, clicking it again fires no focus event.)
- `preview_zoomed_in_before` is true after any zoom-in (button or Ctrl/Cmd
  wheel), even if the author zoomed out again.
