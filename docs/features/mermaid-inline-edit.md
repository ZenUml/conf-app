# Mermaid sequence inline edit

In the editor preview, an author double-clicks a participant name or a message
text of a Mermaid sequence diagram, types, and presses Enter. The change is
written to the Mermaid source, and the preview renders again. The diagram
stays text-first: the source is the only state, and every edit is a source
edit that CodeMirror undo can reverse.

Code: `src/features/mermaidInlineEdit/` (`types.ts` contract, `sourcemap/`
position parser, `edit/` pure edit functions, `ui/` interaction layer,
`index.ts` wiring). Flag: `mermaid-inline-edit-enabled`.

## Behaviour

| Action | Result |
|---|---|
| Double-click a participant (top box, or bottom box when it can be mapped) | Text box opens over it, prefilled with the alias, or with the id when there is no alias, all text selected |
| Double-click a message text (any line of a multi-line or wrapped label) | Text box opens, prefilled with the source text, for example `Hello<br/>two lines`, not the rendered lines |
| Enter, or click elsewhere (blur) | Commit |
| Esc | Cancel: no write |
| Commit with unchanged text | Box closes: no write, no toast |
| Commit accepted | Source updated through the store (same write as AI chat apply); the element flashes for about 1 s after the re-render (static highlight with `prefers-reduced-motion`) |
| Commit refused | Box closes, toast for 4 s (table below) |
| Source changes while the box is open (typing in the code, AI apply) | Box closes without a write, toast "The diagram changed while you were editing. Try again." |

| Rejection | Toast |
|---|---|
| `stale_source` | The diagram changed while you were editing. Try again. |
| `name_exists` | A participant with that name already exists. |
| `invalid_characters` | That text has characters Mermaid can't use here. |
| `empty` | A name can't be empty. |
| `position_mismatch` | Couldn't edit this element. Edit it in the code instead. |

Only one box is open at a time. While it has focus, key, copy, cut and paste
events stop at a window capture listener, so they do not reach CodeMirror, the
viewport or document listeners, such as GenericViewer's capture Escape
handler. Pointer and wheel events on the box do not reach the pan/zoom
viewport. The box is fixed on `document.body`, outside the svg.

## Gate

All must hold. Otherwise the feature is inert: no affordance, no box, no
toast.

| # | Condition | Where |
|---|---|---|
| 1 | Flag `mermaid-inline-edit-enabled` is on (fail closed; standalone/Storybook: `localStorage.mockMermaidInlineEditEnabled = 'true'`) | `isMermaidInlineEditEnabled` in `src/apis/aiTitleFeatureFlag.ts` |
| 2 | Editor surface: `Workspace.vue` provides `mermaidInlineEditSurface`, the store is not in display mode, `readOnly` is false, not the Export PNG host (`modal.openExport`) | `Mermaid.vue` `inlineEditAllowed` |
| 3 | Not during export capture (`setCaptureMode(true)` suspends) | `Mermaid.vue` |
| 4 | The rendered svg says `aria-roledescription="sequence"` | controller |
| 5 | The source has no U+00A0 (see below) | controller |
| 6 | `getSourceMap(code)` returned a map | controller |
| 7 | Three-way equality: the code the svg on screen was rendered from = `map.code` = the store's current `mermaidCode`. Checked when the map arrives, on double-click, and on commit (`stale_source` there) | controller |

Page viewer, Fullscreen, export, byline preview, title draft, Markdown and the
MCP view do not mount `Workspace`, so they never get the surface key, and the
feature module is never downloaded there (it is a dynamic import).
`forgeIndex.ts` mounts `Workspace` whenever `isEditorMode()` is true: the
editor modal (`macroMode: 'editor'`) and the native macro config surface
(`extension.macro.isConfiguring`). Both are the same editor, so the feature is
on in both.

Hover marks every element of the target: all lines of a message, and both the
top and bottom box of a participant.

## DOM mapping rule

Exact attributes only, never text content. Measured on Mermaid 11.17.2 with a
real `mermaid.render` in Chromium (strict security level, so the output has
passed DOMPurify, and `data-et` / `data-id` survive). Fixture:
`src/features/mermaidInlineEdit/ui/__fixtures__/sequence-11.17.2.svg`.

| Element | Rendered as | Mapping |
|---|---|---|
| Participant, top | `g[data-et="participant"][data-id=<actor id>]` | actor id = source-map key |
| Participant, bottom (mirror) | No `data-et`. `.actor-bottom[name=<actor id>]`: a `rect` inside an unclassed `g` (participant) or the `g.actor-man` itself (actor) | We tag the group `data-seq-participant-for=<id>` when exactly one top participant has that id |
| Typed participant bottom (for example `@{ "type": "database" }`) | `g.actor-bottom` with no `name` | Inert |
| Message | `line\|path[data-et="message"][data-id="i<N>"]`; the label is one `text.messageText` per line (`<br>`, and the lines `wrap:` makes), appended just before the line in the same parent | Every `text.messageText` in the contiguous run of previous siblings gets `data-seq-for="i<N>"`. N = source-map message index |
| Empty message label | One `text.messageText` holding U+200B | Tagged; the box opens empty |
| KaTeX message label (`$$...$$`) | `foreignObject`, no class | Run is empty, untagged, inert |

Two identical messages get different tags because the tag comes from the
line's own `data-id`. Tags are written on the rendered DOM after each render;
the Mermaid renderer is not changed.

## Whitespace normalisation

`Mermaid.vue` renders `normalizeMermaidWhitespace(code)`, which replaces
U+00A0 with a space (one character for one, so offsets keep their place). The
store string keeps U+00A0. The position parser reads the store string. An actor
id that holds U+00A0 would then be rendered with a `data-id` different from
the map key, and the message records could differ as well. This was not
proved equal, so a source that the normaliser changes is read-only on the
canvas. No `unavailable` event is sent for it.

## Events

All have `feature_area: 'macro'`, `surface: 'editor'`, `macro_type: 'mermaid'`.
They never carry diagram text, actor ids or message indexes. Rate 1
(`OCTOBER_RETAINED_EVENTS`), not in `FORCED_REPLAY_SOURCES`.

| Event | When | Extra properties |
|---|---|---|
| `editor_inline_edit_started` | The box opened | `inline_edit_kind`, `inline_edit_had_alias` (participant) |
| `editor_inline_edit_succeeded` | The edit was written to the source | `inline_edit_kind`, `inline_edit_had_alias`, `inline_edit_ms_open` |
| `editor_inline_edit_rejected` | The edit function, the stale check, or a missing source range refused it | `inline_edit_kind`, `inline_edit_rejection`, `inline_edit_had_alias`, `inline_edit_ms_open` (absent when the box never opened) |
| `editor_inline_edit_cancelled` | Esc, or closed with unchanged text | `inline_edit_kind`, `inline_edit_cancel_reason` (`escape` / `unchanged`), `inline_edit_ms_open` |
| `editor_inline_edit_unavailable` | Flag on, a sequence diagram rendered, but the parser gave no map. At most once per editor session (iframe page load) | none |

`inline_edit_kind` is `participant_label` or `message_text`.

Volume: these are user actions in the editor preview of Mermaid sequence
diagrams only. Mermaid and PlantUML editor sessions together are about 13k a
month (estimate in `docs/features/editor-preview-click.md`); sequence diagrams
are a part of the Mermaid share. If every one of those sessions opened and
committed five edits, that is about 130k events a month (13% of the 1M cap),
an upper bound; the expected volume is a small fraction of it. Not measured
with `mp_quota.py` in this change. `unavailable` is at most one per
editor session.

## Interaction with the P6 click count

`editor_preview_element_clicked` (`docs/features/editor-preview-click.md`)
counts presses and double-clicks on preview elements, and
`preview_source_changed_in_window` turns true on any store write. Every inline
edit therefore also produces a P6 event with a source change, which inflates
its read-out rules 1 and 3. The P6 100% window runs to 2026-12-23. If this flag
is turned on for any site before the P6 read-out, exclude editor sessions that
have `editor_inline_edit_started` from that read-out.

## Known inert cases

- KaTeX message labels.
- Bottom boxes of typed participants (database, queue and the other `@{ type }`
  shapes): no `name` attribute. Their top box works.
- Notes, loop/alt labels, activation boxes and arrows: not editable kinds.
- A source with U+00A0.
- A diagram the position parser does not accept, or disagrees on with the
  official parser (`getSourceMap` returns null; one `unavailable` event).
- While the code on screen and the store disagree, for example while a new
  render is still running or after a syntax error left the last good render on
  screen.
- Any surface other than the editor preview, and narrow or touch layouts (the
  editor is desktop only).

## Not verified

- Escape inside the Forge editor modal: the box calls `preventDefault` on Esc
  and stops it at window capture, but whether the Confluence host still closes
  the modal has not been checked on a tunnel.
- The hover affordance and the flash were not checked by eye in all browsers;
  they use `filter: drop-shadow` because `outline` does not paint on SVG `g`
  and `text` everywhere.
