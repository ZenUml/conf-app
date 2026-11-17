# PR 1211: paste handling in the Sequence and Mermaid editors

| | Commit |
|---|---|
| BEFORE | `57482a74` (`main`, the PR base) |
| AFTER | `74edc98c` (`feat/mermaid-paste-handling`) |

Fixture (fictional): `logs/fixture-fenced-mermaid.txt`, a Mermaid `sequenceDiagram` (Robot, Gateway) inside a ```` ```mermaid ```` fence.

## Storybook (`storybook/`)

- Story file: `src/components/Editor/DiagramPaste.stories.ts`, title `Editor/Diagram/DiagramPaste`, five stories.
- AFTER: `pnpm storybook` on the branch. BEFORE: a worktree of `57482a74` with only that story file copied in.
- Each story mounts the real `Workspace` and dispatches a real `ClipboardEvent('paste')` on the CodeMirror content element after select-all.
- Capture: `agent-browser`, viewport 1280x800, `iframe.html?id=editor-diagram-diagrampaste--<story>&viewMode=story`, screenshot after the play function ended.
- Play result per story: `logs/storybook-play-status.txt` (port 6006 = AFTER, port 6007 = BEFORE). AFTER: no exception in 5 of 5. BEFORE: the expected assertion fails in 5 of 5.

| Story | BEFORE | AFTER |
|---|---|---|
| Fenced paste into the Mermaid tab | fence stays, Mermaid syntax error | fence removed, diagram drawn |
| Mermaid paste into the starter Sequence tab | paste stays in Sequence, syntax error and hint | paste is in the Mermaid tab, toast with Undo, diagram drawn |
| Undo on the toast | no toast exists | paste is back in the Sequence tab without the fence, hint shown |
| Fenced paste into an authored Sequence tab | fence stays | fence removed, stays in Sequence, hint shown, no move |
| Hint "Switch to Mermaid" on prose + fenced source | no hint (detector does not see the fence after prose) | hint shown; after the click only the diagram body is in the Mermaid tab |

## Forge tunnel (`tunnel/`)

- 2026-11-17, Lite variant, Forge `development` environment, a development Confluence site, real Chrome signed in as the tunnel owner.
- Local Vite dev server on port 8080 behind `pnpm forge:tunnel`. The dev bar in each screenshot shows `feat/mermaid-pa…@74edc9…`. Vite had 2 to 4 established connections during the check.
- Input: the fixture on the system clipboard, pasted with Cmd+A then Cmd+V in the macro editor of a new, unpublished macro.

| File | Steps | Observed |
|---|---|---|
| `tunnel-1-fenced-paste-mermaid-tab.jpg` | Mermaid tab, paste | 8 lines, no fence, diagram drawn |
| `tunnel-2-mermaid-tab-authored-no-move.jpg` | then Sequence tab (starter), paste | stays in Sequence without the fence, hint shown, no move (the Mermaid tab already held pasted code) |
| `tunnel-3a-sequence-starter-before-paste.jpg` | new macro, Sequence tab with the starter | starting state |
| `tunnel-3b-moved-to-mermaid-with-undo.jpg` | paste | Mermaid tab selected, toast "This looks like Mermaid, so it is now in the Mermaid tab." with Undo, diagram drawn |
| `tunnel-4-after-undo.jpg` | new macro, paste, Undo within the toast's 8 s | Sequence tab selected, pasted code without the fence, hint shown |
| `tunnel-5-hint-switch-after-undo.jpg` | then "Switch to Mermaid" on the hint | Mermaid tab selected, diagram drawn |

Limits of the tunnel check:

- The first Undo attempt came after the toast had closed (8 s); the check was repeated with the click inside the 8 s.
- No macro was published. Analytics events were not read from Mixpanel.
- The hint path with a fence still in the Sequence editor (typed, or saved before this change) was not exercised here; Storybook and unit tests cover it.

## Logs (`logs/`)

- `red-run-summary.txt`: the tests of commit `9d086743` before the implementation, 69 failed.
- `local-unit-summary.txt`: the local full unit run and the isolated reruns of its 15 failures.
- `storybook-play-status.txt`: Storybook channel events per story.

## CI-deployed staging (`staging/`)

- 2026-11-17, Lite variant, the Lite staging Confluence site, non-admin robot test account, `agent-browser`.
- Deployed by the `PR validation` run 44069878353 (`Deploy: Lite`), not from a local shell.
- Build under test: the dev bar in each screenshot shows `430926fe…@430926f`. `430926fe` is the PR merge candidate (`refs/pull/1211/merge`); its parents are `57482a74` (base) and `74edc98c` (head).
- Input: the same fixture. Paste was a `ClipboardEvent('paste')` dispatched on the CodeMirror content element inside the macro iframe after select-all (the same method as the Storybook stories). A real system-clipboard paste was done in the Forge tunnel stage, not here.

| File | Steps | Observed |
|---|---|---|
| `staging-1-moved-to-mermaid-with-undo.png` | new macro, Sequence tab with the starter, paste | Mermaid tab selected, toast "This looks like Mermaid, so it is now in the Mermaid tab." with Undo, 8 lines, no fence, diagram drawn |
| `staging-2-after-undo.png` | then Undo on the toast | Sequence tab selected, 8 lines, no fence, hint "This looks like Mermaid, not ZenUML" with "Switch to Mermaid" |
| `staging-3-fenced-paste-mermaid-tab.png` | then Mermaid tab, paste | 8 lines, no fence, diagram drawn, no syntax error |

Limits of the staging check:

- Paste was a synthetic event, not the system clipboard.
- No macro was published; the page is an unpublished draft.
- Only the Lite macro editor was opened. The fullscreen editor and the Full, Diagramly and AsyncAPI variants were not opened by hand.
- Analytics events were not read from Mixpanel.
