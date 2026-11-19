# PR #1225 evidence: foreign-dialect hint on Mermaid macros

- Baseline: `origin/main` `066e4a01` (ForeignDialectHint.vue from main swapped into the candidate worktree for BEFORE captures).
- Candidate: `bdf5c370` on `fix/mermaid-foreign-dialect-hint`.
- Environment: local Storybook (`PRODUCT_TYPE=lite storybook dev`), story `Editor/ForeignDialectHint on a Mermaid macro`, headless Chrome 1280x720.
- Fixtures: fictional diagrams in `src/components/ForeignDialectHint.stories.ts` (no customer data).

| Story | BEFORE | AFTER |
|---|---|---|
| PlantUML in Mermaid | Syntax error + AI Repair, no hint | Hint "Switch to PlantUML" |
| Prose above diagram | Syntax error + AI Repair, no hint | Hint "Turn it into comments"; click comments out line 1 and the flowchart renders |
| Markdown document | Syntax error + AI Repair, no hint | Hint "Switch to Markdown"; click moves source to the Markdown tab with mermaid fences, both diagrams render |

Page errors during capture: none.
