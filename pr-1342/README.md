# PR #1342 evidence: fullscreen wheel and drag like the Confluence fullscreen viewer

- **AFTER:** `0e6007f5a` (#1342 head).
- **BEFORE:** main (`view-DjNJr0Bw.js`): fullscreen took every wheel event. Plain down zoomed out, sideways did nothing, and there was no drag.

## claude.ai (PR preview `conf-stg-lite-pr.zenuml.com`, bundle `view-nsLcszWe.js`, 2026-11-28 00:29 UTC)
A ZenUML sequence with 12 participants and 17 messages, through a claude.ai connector to the preview's `/mcp`.

| Step | Result | File |
|---|---|---|
| Inline, plain wheel 5 down / 5 up over the diagram | the chat scrolls; label stays 48% | — |
| Fullscreen fit | 47% | `fullscreen-fit-47pct.png` |
| Plain wheel up, 2 ticks over PricingService | 47% → 52% → 58%, zooming at the pointer (PricingService stays under the cursor) | `wheel-zoom-58pct.png` |
| Sideways wheel, 3 ticks right | pans to the right edge (NotificationService visible), label 58% | `sideways-pan.png` |
| Drag left to right | pans back to the left edge (Customer visible), label 58% | `drag-pan.png` |

Cropped to the side pane. The toolbar looks dimmed in `drag-pan.png` because it rests at 60% opacity when the pointer isn't over it.

## Local harness (`host-harness.html?mode=fullscreen&big=1`, `big.zenuml`)
At 230% on the small diagram (overflow 130×100 px), real input in Chromium:
| | BEFORE | AFTER |
|---|---|---|
| Scroll right | nothing | scrollLeft 0 → 130 |
| Drag | nothing | scrollLeft 130 → 2 |
| Plain wheel down | 230% → 160% | 230% → 208%, at the pointer |

Not driven: Shift + wheel (the test browser sends no modifier with a scroll; the sideways wheel covered panning), Safari's pinch gesture, and vertical panning in fullscreen.
