# Mermaid sequence inline edit

In the editor preview, an author double-clicks a participant name or a message
text of a Mermaid sequence diagram and types where the text is, Figma-style.
The diagram re-lays out on every keystroke; the Mermaid source is written once,
when the edit is committed, and the preview keeps its zoom and position. The
diagram stays text-first: the source is the only state, and every edit is a
source edit that CodeMirror undo can reverse.

Code: `src/features/mermaidInlineEdit/` (`types.ts` contract, `sourcemap/`
position parser, `edit/` pure edit functions, `codec/` display-text codec,
`ui/` interaction layer, `index.ts` wiring). Host side: `Mermaid.vue`
(`renderPreview`, the view keeper) and `DiagramViewport.vue` (`holdView`,
`setRealZoom`, `panByScreen`, `flushView`).

No feature flag: the editor is on for everyone in the editor preview (decided
2026-11-20). To turn it off, remove the `mountMermaidInlineEdit` call in
`Mermaid.vue` `startInlineEdit` (revert that mount); nothing else depends on it.

## Behaviour

| Action | Result |
|---|---|
| Pointer over the diagram while editing is available | Blue arrow cursor (Figma-style, `#0052CC`); it stays while pressed and while dragging the canvas |
| Pointer over a message text or participant label | Thin blue outline around all lines of the message, or around the participant copy under the pointer |
| Double-click a participant (top box, or the bottom box when it can be mapped) | A text layer opens exactly over the label (same font, size and colour; the SVG text under it is hidden), with the word under the pointer selected |
| Double-click a message text (any line of a multi-line label) | Same, over all its lines. The layer shows the rendered lines (`Hello<br/>two lines` reads as two lines), not the source spelling |
| Type | The preview re-renders the candidate (built from the source as it was when the layer opened) on every keystroke, latest wins. The store, CodeMirror and the draft are not touched. The zoom stays, and the edited text keeps its screen position |
| Shift+Enter | New line in a message or alias (written as the source's own `<br>` spelling); refused in a participant id |
| Enter, or click elsewhere (pointer down outside the layer, or blur while the page has focus) | Commit: one store write (same write as AI chat apply), the layer goes when the commit render lands |
| Esc | Cancel: no write; the stored picture comes back |
| Commit with unchanged text (also typed and typed back, or only trimmed whitespace) | Layer closes: no write, no toast |
| Text that cannot be used (a participant name that exists, an empty name, characters Mermaid can't use) | Red outline (`#DE350B`) and a hint under the text; nothing is rendered and the last valid picture stays. Enter keeps editing; Esc restores; click elsewhere restores and shows the hint as a toast for 4 s |
| Source changes while the layer is open (typing in the code, AI apply) | Layer closes without a write, toast "The diagram changed while you were editing. Try again." |
| A real re-render of the same source while editing, or export capture | Layer closes quietly; export capture first puts the stored picture back |
| Composing with an IME | No render while composing; one render when the composition ends; Enter that confirms a composition does not commit |

| Rejection | Hint / toast |
|---|---|
| `stale_source` | The diagram changed while you were editing. Try again. |
| `name_exists` | A participant with that name already exists. |
| `invalid_characters` | That text has characters Mermaid can't use here. |
| `empty` | A name can't be empty. |
| `position_mismatch` | Couldn't edit this element. Edit it in the code instead. |

A participant without an alias is renamed by its id, so the id changes on
every keystroke; the layer finds the element again by `data-id` = the
candidate's id, never by its text. With an alias, the id stays and the alias
changes. Both the top and the bottom copy show the new text; the layer covers
the copy that was clicked.

Only one layer is open at a time. While it has focus, key, copy, cut and paste
events stop at a window capture listener, so they do not reach CodeMirror, the
viewport or document listeners, such as GenericViewer's capture Escape
handler. Pointer and wheel events on the layer do not reach the pan/zoom
viewport. The layer lives in the viewport element, outside the v-html svg, so
a re-render never destroys it. A wheel zoom or pan during the edit moves the
layer with the text.

How the view is kept: while a layer is open, `DiagramViewport.holdView(true)`
stops `attach()` from refitting a new svg. Mermaid.vue calls the controller's
view keeper right after each attach, in the same task as the svg swap; the
keeper sets the zoom back, pans the edited text's first-line centre to its old
screen point and re-places the layer. `flushView()` writes svg-pan-zoom's
matrix at once, because the library applies it only on the next animation
frame.

## Gate

All must hold. Otherwise the feature is inert: no cursor, no outline, no
layer, no toast.

| # | Condition | Where |
|---|---|---|
| 1 | Editor surface: `Workspace.vue` provides `mermaidInlineEditSurface`, the store is not in display mode, `readOnly` is false, not the Export PNG host (`modal.openExport`) | `Mermaid.vue` `inlineEditAllowed` |
| 2 | Not during export capture (`setCaptureMode(true)` suspends) | `Mermaid.vue` |
| 3 | The rendered svg says `aria-roledescription="sequence"` | controller |
| 4 | The source has no U+00A0 (see below) | controller |
| 5 | `getSourceMap(code)` returned a map | controller |
| 6 | Three-way equality: the code the svg on screen was rendered from = `map.code` = the store's current `mermaidCode`. Checked when the map arrives, on double-click, and on commit (`stale_source` there) | controller |
| 7 | Render parity: the drawn lines of the element equal its source text decoded (`codec/renderParity`). Otherwise that element is inert | controller |

Page viewer, Fullscreen, export, byline preview, title draft, Markdown and the
MCP view do not mount `Workspace`, so they never get the surface key, and the
feature module is never downloaded there (it is a dynamic import).
`forgeIndex.ts` mounts `Workspace` whenever `isEditorMode()` is true: the
editor modal (`macroMode: 'editor'`) and the native macro config surface
(`extension.macro.isConfiguring`). Both are the same editor, so the feature is
on in both.

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
| Empty message label | One `text.messageText` holding U+200B | Tagged, but its box is 0 px wide, so a real double-click cannot hit it (see Known inert cases) |
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
| `editor_inline_edit_started` | The layer opened | `inline_edit_kind`, `inline_edit_had_alias` (participant) |
| `editor_inline_edit_succeeded` | The edit was written to the source | `inline_edit_kind`, `inline_edit_had_alias`, `inline_edit_ms_open` |
| `editor_inline_edit_rejected` | The layer closed with text that cannot be used (click elsewhere), the stale check refused the commit, or the element had no source range (no layer opened). Invalid text while typing sends nothing | `inline_edit_kind`, `inline_edit_rejection`, `inline_edit_had_alias`, `inline_edit_ms_open` (absent when the layer never opened) |
| `editor_inline_edit_cancelled` | Esc (also while the text is invalid), or closed with unchanged text | `inline_edit_kind`, `inline_edit_cancel_reason` (`escape` / `unchanged`), `inline_edit_ms_open` |
| `editor_inline_edit_unavailable` | A sequence diagram rendered in the editor, but the parser gave no map. At most once per editor session (iframe page load) | none |

`inline_edit_kind` is `participant_label` or `message_text`. One event per
session step (open, close), never one per keystroke.

Volume: these are user actions in the editor preview of Mermaid sequence
diagrams only. Mermaid and PlantUML editor sessions together are about 13k a
month (estimate in `docs/features/editor-preview-click.md`); sequence diagrams
are a part of the Mermaid share. If every one of those sessions opened and
committed five edits, that is about 130k events a month (13% of the 1M cap),
an upper bound; the expected volume is a small fraction of it. With no flag the
upper bound applies from the first release. Not measured with `mp_quota.py` in
this change. `unavailable` is at most one per
editor session.

## Interaction with the P6 click count

`editor_preview_element_clicked` (`docs/features/editor-preview-click.md`)
counts presses and double-clicks on preview elements, and
`preview_source_changed_in_window` turns true on any store write. Every inline
edit therefore also produces a P6 event with a source change, which inflates
its read-out rules 1 and 3. The P6 100% window runs to 2026-12-23. The editor
ships without a flag, so exclude editor sessions that have
`editor_inline_edit_started` from that read-out.

## Known inert cases

- KaTeX message labels.
- Bottom boxes of typed participants (database, queue and the other `@{ type }`
  shapes): no `name` attribute. Their top box works.
- Notes, loop/alt labels, activation boxes and arrows: not editable kinds.
- An empty message label (`A->>B:`). It is tagged, but Mermaid draws it as one
  U+200B, a 0 px wide box that a pointer cannot hit. Emptying a message in the
  layer is allowed and writes `A->>B:`; after that, the text is edited in the
  code panel. Measured in Chromium 2026-11-20.
- A source with U+00A0.
- An element whose drawn lines differ from its decoded source text (render
  parity), for example text Mermaid rewrites when it draws it.
- A diagram the position parser does not accept, or disagrees on with the
  official parser (`getSourceMap` returns null; one `unavailable` event).
- While the code on screen and the store disagree, for example while a new
  render is still running or after a syntax error left the last good render on
  screen.
- Any surface other than the editor preview, and narrow or touch layouts (the
  editor is desktop only).

## Not verified

- Escape inside the Forge editor modal: the layer calls `preventDefault` on
  Esc and stops it at window capture, but whether the Confluence host still
  closes the modal has not been checked on a tunnel.
- A real OS IME (measured only with CDP `imeSetComposition`).
- Browsers other than Chromium: alignment and the custom cursor were measured
  in Chromium only.
