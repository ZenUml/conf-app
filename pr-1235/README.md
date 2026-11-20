# PR #1235 evidence: edit Mermaid sequence diagram text in place

Baseline (BEFORE): `main` @ a3acc96af (no inline edit on the preview).
Candidate (AFTER): branch `claude/mermaid-sequence-inline-edit-ee4991` @ 7772f8df6.

Where: Storybook story `Editor/Diagram/MermaidInlineEdit > Try by hand` (local Storybook, candidate commit). Viewport 1280x720, deviceScaleFactor 2, full-page PNG, so the code panel (left) and the rendered diagram (right) are both visible.
Drive: Playwright headless Chromium with real mouse double-click and real key presses (Meta+ArrowRight moves the caret to the end on macOS). The SVG is given 8 s to render after load.

Fixture (fictional): participants `A as Alice`, `Bob`, `C as Carol`, `Bo`; messages `Hi`, `Hello<br/>two lines`, `Fine`, `Ping`.

| Image | Steps | Observed (code panel / diagram) |
|---|---|---|
| 01-idle.png | Load story, wait 8 s | Code panel = fixture. Diagram: Alice, Bob, Carol, Bo; 4 messages. No edit layer. |
| 02-message-editing.png | Double-click message "Hi", Meta+ArrowRight, type " there" | Layer open with text `Hi there` (blue outline). Diagram label reads "Hi there". Code panel still `A->>Bob: Hi`. |
| 03-message-committed.png | Press Enter | Layer closed. Code panel line 6 = `A->>Bob: Hi there`. Diagram "Hi there". |
| 04-participant-editing.png | Fresh page. Double-click header "Bob", Meta+ArrowRight, type "by" | Layer `Bobby`. Header and footer boxes both show Bobby. Code panel still `participant Bob`, `A->>Bob: Hi`. |
| 05-participant-committed.png | Press Enter | Code panel: `participant Bobby`, `A->>Bobby: Hi`, `Bobby->>C: Hello<br/>two lines`. Diagram header and footer Bobby. |
| 06-invalid-duplicate.png | Fresh page. Double-click header "Bo", Meta+ArrowRight, type "b" (gives "Bob", already used) | Red outline on the edited box, red hint "A participant with that name already exists." Diagram keeps the last valid picture (Bob and Bo unchanged). Code panel unchanged. Known: the hint is clipped at the right edge of the diagram pane in this screenshot ("already e..."). |
| 07-two-line-editing.png | Fresh page. Double-click message "Hello / two lines" | Layer shows two lines in place: `Hello` / `two lines`, selected. Code panel unchanged. |
| 08-cursor-4x.png | Copy of spike capture | The arrow cursor image (4x). OS cursors cannot be screenshotted, so the cursor is shown as an image. |

Limitations: Storybook only. This is not the Confluence UI, so Forge Tunnel and CI-deployed staging evidence are separate. Keys are real key presses via Playwright headless Chromium, not a human typing. Images contain only the fictional fixture data above.
