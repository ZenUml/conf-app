---
name: better-ui
description: Audit and tighten the visual design of an existing UI (component, page, Storybook story, HTML) against eleven concrete rules — copy, colour (Radix UI Colors), alignment, borders, motion, type scale, decision load, radius/shadow, eyebrows. Use when the user says "better ui", "polish this UI", "make this look better", "优化界面", "UI 看着糙", or asks for a visual pass on a surface that already works.
---

# Better UI

A pass over a UI that already works, to make it look deliberate. Not for logic, layout architecture from scratch, or brand direction (use **frontend-design** for new aesthetic direction, **prototype** for exploring alternatives).

## Procedure

1. **Scope.** Name the files and the rendered surface (Storybook story, dev URL, HTML file). If the surface renders, look at it before and after; a rule violated in source is only confirmed in pixels.
2. **Audit.** Walk the eleven rules below in order. For each, list every violation as `file:line — what — fix`. Zero findings for a rule is a valid result; say so.
3. **Fix.** Apply fixes in rule order. One commit or one coherent diff per surface. Do not add features, copy, or decoration while fixing.
4. **Verify.** Re-render. Compare before/after screenshots. Report findings fixed, findings left, and why.

For the Confluence app in this repo the validation order is Storybook → Forge tunnel → CI staging (see root `CLAUDE.md`, "Confluence UI changes require ordered visual validation"). Desktop only.

## The eleven rules

### 1. No middle dot as a separator
Remove `·` (U+00B7) and `•` used between text fragments. Replace with a comma, a line break, spacing, or a vertical divider element. Grep: `rg '·|•'`.

### 2. No redundant explanatory text
Delete helper sentences that restate what the control already says, or explain the obvious. Text that stays must change what the user does. Placeholder text is not a tooltip; tooltips are not a second label.

### 3. Copy fits the audience
Review every visible string. Target the people who use this surface (for conf-app: Confluence authors and engineers). Plain, not chatty. Length matches the slot — a button is one to two words, a toast is one clause, an empty state is one sentence. No invented terms; reuse the product's existing vocabulary. Keep the project's domain terminology (`CLAUDE.md`, "Domain terminology").

### 4. Radix UI Colors only
Replace every hex, rgb, hsl and named colour with a Radix scale step (`gray`, `slate`, `blue`, `red`, `amber`, `green`, … steps 1–12, plus alpha variants). Apply the scale's role convention:

| Step | Role |
|---|---|
| 1–2 | app and subtle backgrounds |
| 3–5 | component backgrounds: normal, hover, active |
| 6–8 | borders: subtle, UI element, hover / focus ring |
| 9–10 | solid fills: normal, hover |
| 11–12 | text: low contrast, high contrast |

Reference: https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale. Use the CSS variables (`var(--gray-11)`) or the package `@radix-ui/colors`; do not paste resolved values. Dark mode comes from the matching `*Dark` scale, not from inverted hand-picked values. If the surface must stay inside a host design system (Atlaskit tokens in a Forge iframe), map each token to the nearest Radix role rather than mixing both.

### 5. Optical alignment and concentric radii
Align by visual weight, not by bounding box: icons next to text sit on the text's optical centre; triangles and arrows shift toward their point; text with descenders aligns by baseline. Nested rounded elements use concentric radii — inner radius = outer radius − padding — so corners share a centre. Check every card-in-card, button-in-input, avatar-in-badge.

### 6. Hairline borders
Borders and dividers are `0.5px`. On displays that cannot render it, fall back to `1px` with a lower-alpha Radix step (6 or 7 alpha) so the weight stays light. Never `2px` for structure.

### 7. Minimal motion
Remove transitions and animations that do not communicate state change. Where one is needed: `ease-out`, `250ms` as the base. Hover colour shifts may be instant. Nothing loops. Respect `prefers-reduced-motion`.

### 8. Type scale of at most four sizes, ideally three
Count distinct `font-size` values on the surface. Reduce to three (four at most). Minimum size `12px`. Build hierarchy with weight, colour (Radix steps 11 vs 12), spacing and whitespace before adding another size.

### 9. Fewer decisions, clearer order
Remove interactions that force the user to judge before continuing (confirm dialogs for reversible acts, mode pickers, optional toggles shown by default). When a decision must exist, place it where the user is already choosing. Then rank the surface's elements by information priority and reorder, group, or demote (collapse, secondary styling) so the eye meets them in that order.

### 10. Radius and shadow by function
Default to none. No coloured left-edge stripe on cards. A radius is justified by a role (interactive control, floating layer) and sized to it — small on controls, larger on overlays. A shadow signals elevation only: one soft shadow for a floating layer, nothing for inline content. Values stay consistent across the surface.

### 11. No decorative eyebrows or overlines
Remove uppercase labels above headings that repeat the heading, label the obvious, or exist for texture. Keep an eyebrow only when it carries a category, context, or key fact the heading does not. Hierarchy comes from type size, weight, spacing and whitespace.

## Output

Report as a numbered list, one rule per item, each with findings fixed and findings left. Attach before/after screenshots when the surface renders. Stop there.
