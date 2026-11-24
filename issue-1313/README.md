# Mermaid source-selection hint

Baseline: a6718484b. Candidate: 33950b208. Desktop Chromium, 1440 × 900, Lite Storybook, fictional order-tracking sequence diagram in the real Workspace editor.

| Capture | Action and observation |
| --- | --- |
| before.png | Select the second “Track shipment” on the baseline. Only the source shows a selection. |
| selected.png | Select the same range on the candidate. Only the reply message gets the blue ring and the double-click hint. |
| typing.png | Replace that selection with “Confirm delivery”. Source focus stays active, the label updates, the ring remains, and the hint clears. |
| multiline.png | Extend the selection across two messages. Both decorations disappear. |
| inline.png | Double-click the reply message. The existing inline editor opens at that label. |
| flow.png | Select the second “Review” in a flowchart with two identically named nodes. The ring lies within node B only. |

The SourceSelectionHint Storybook play function checks source focus, source offsets, the ring's position against the selected message, multiline clearing and the inline editor handoff. The screenshots capture the matching manual states using the TryByHand stories. No customer diagrams were used.
