# Follow the Mermaid source caret

Baseline 9ce228899. Candidate fb66c38c6. The screenshots show the same 1440 × 900 Lite Workspace in Storybook. The source editor is focused with a zero-length selection inside the second occurrence of “Review”.

| Diagram | Before | After |
| --- | --- | --- |
| Sequence | before-sequence.png | after-sequence.png |
| Flowchart | before-flow.png | after-flow.png |

In each baseline the diagram shows no source-position ring. In the candidate, only the corresponding second label is outlined. A collapsed caret produces no instructional tooltip. The SourceCaretMessages, SourceCaretFlowchart and SourceSelectionHint play functions exercise movement, typing, clearing and the selection-only hint. compare.sh captures the four screenshots with fictional data.
