# Diagram Rules

Improve readability without silently redesigning the underlying diagram.

## Scope first

Unless the user explicitly authorizes structural redesign, preserve:

- every business node and its text;
- every relationship and its direction;
- the meaning of shapes and colors.

The first pass is visual: placement, spacing, connector routing, labels, line weight, arrowheads, and contrast. Do not merge nodes, remove paths, invent connections, or replace a process with a different abstraction.

### Semantic preservation

Group, subgraph, and container membership is business semantics. For each node, record its group/subgraph/container membership path from the source declaration and from the actual original rendered containment; node and edge counts, labels, and relationship directions do not replace this comparison. If the declaration and render disagree, record semantic ambiguity and **FAIL** the semantic-preservation check, then preserve the original visible membership by default; do not silently resolve the conflict from the declaration or reassign nodes. Any changed membership is a semantic-preservation failure even when every node and all edges match. Regrouping requires explicit user authorization.

## Route-aware node placement

First judge whether the diagram has meaningful layers. If it does, prefer a layered body; not every relationship needs to run down. Preserve all source nodes, directions, relationships and group semantics.

For orthogonal box layouts, treat node positions and connector routes as one layout problem. A **bend** is one 90-degree direction change in one logical relationship; a rounded fillet still counts as one bend. Count bends separately for every logical relationship, but count visible crossing locations once, deduplicating logical paths on shared geometry and excluding valid merge joins. A relationship's **detour** is its displacement perpendicular to its primary direction: vertical displacement for a horizontal relationship, and horizontal displacement for a vertical relationship.

Preserve node and relationship semantics, relationship direction, container membership, semantic order, container margins, uniform peer gaps, readable labels, and collision-free geometry. Within those constraints, a node is movable; do not preserve an arbitrary coordinate when moving it improves the routing of the complete diagram.

Before routing, generate candidate positions for each movable node at the median connection axis of its adjacent nodes and at direct alignments with each adjacent axis. Snap candidates to the shared grid, clamp them to the valid interior of their container, then reassign ports and reroute every logical relationship for each complete candidate layout. The median-axis candidate keeps a multi-edge hub near its neighbours instead of at an arbitrary container extreme.

Compare complete layouts lexicographically, in this exact order:

1. fewer connector crossings and geometry collisions; a feasible normal layout has zero (a dense diagram does not chase zero, see "Dense diagrams" below);
2. smaller aspect-band violation (see "Aspect band and track folding"); a layout inside the band scores zero;
3. fewer total bends across all logical relationships;
4. less total detour across all logical relationships;
5. less total Manhattan connector length;
6. less total node displacement from the prior layout.

An earlier metric always outranks every later metric. Accept a node move only when the full-diagram score improves; never improve one relationship at the expense of a worse global score. Report the before/after score tuple during verification, and inspect every moved node together with all incident connectors in the required 2× crop loop.

**Dense diagrams.** At or above 20 source relations (an empirical threshold; the Pi agent reads it from `PI_DIAGRAM_DENSE_RELATIONS`, default 20), zero crossings is no longer the goal. Still minimise crossings with port order and routing lanes, but do not chase zero: in a dense diagram crossings are measured and reported as minor, never as a blocking failure, and a minor crossing never needs a waiver. Every other connector rule stays in force.

### Aspect band and track folding

A diagram must fit its viewport before it is judged on routing elegance: a long single row scales down to unreadable text on a page, and no bend count compensates for that. Measure the **content box** — the union bounds of all nodes and connectors, excluding title, legend, and palette comment — as `W × H`.

- **Band.** The aspect-band violation is `max(0, |log2(W / H)| − log2(3))`: zero inside `[1:3, 3:1]`, growing with distance outside. When the user declares a viewport (for example a page content width of 760 px at the diagram's natural scale), replace the band with "natural `W` ≤ viewport width where any candidate achieves it; otherwise the smallest `W`", and report which form was used.
- **It is a metric, not a feasibility gate.** A two-node chain or a mandated swimlane may never reach the band; the metric then selects the closest layout instead of leaving no feasible layout.
- **Folding candidate.** For an ordered peer track of `n` nodes (a chain or a row/column of siblings), add candidate layouts that fold it into `k` tracks for every `k` from 2 up to the smallest `k` whose folded content box lies inside the band. Fold in **wrap order**: every track reads in the same direction, and the connector from the last node of one track to the first node of the next is routed and scored like any other relationship (its bends count normally). Do not use boustrophedon order — reversing direction on alternate tracks breaks the semantic order the rest of this document preserves. Peer boxes keep their size, gaps, and grid; only track membership changes.
- **Not a text rule.** Folding changes node placement; it does not shrink boxes or rewrap labels. Apply T2/B1 first so each box has its final size, then evaluate folding on the resulting tracks.

Measure the content box without the canvas padding: the viewBox is not the content box, and the two give different violations near the band edge.

Fixtures (Mermaid `flowchart LR`, six equal-tier nodes A→…→F, `htmlLabels:false`, `curve:linear`, content-box measures): the single row is `1754 × 84` (20.8:1, violation 2.80) and must fold. The k=2 fold (rows AB C / DEF) is `866 × 218` (3.97:1, violation 0.40): better, still rejected. The k=3 fold (rows AB / CD / EF) is `569 × 353` (1.61:1, violation 0) and is the selected layout: node count 6, edge count 5, two row-return connectors (B→C, D→E) each a complete 2-bend path, score tuple `(0, 0, 4, 1116, 868, 3754)` against the row's `(0, 2.80, 0, 0, 250, 0)`.

### Mandatory lower-bend route search

For every relationship between rectangular components, connector faces and anchor positions are routing variables. A route is a violation when it uses more bends than a feasible route with fewer bends. In particular, a three-bend route is invalid whenever a feasible one-bend L route exists; midpoint preference must never retain the extra bends.

For this rule, enumerate source and target face pairs and candidate anchors at face midpoints, projected alignment points, and the face positions induced by a one-bend orthogonal L. A candidate is **feasible** only when its two straight legs: leave/arrive perpendicular to their chosen faces; keep their interiors outside every unrelated component and container; create no non-shared connector crossing; avoid declared label, badge, and exclusion rectangles; and do not violate a declared port order or relationship-specific routing constraint. A source or target ancestor container is a routing transit region for its descendant connector: its interior and boundary may be crossed transversely unless explicit boundary or port metadata forbids it; positive-length riding on any group border is forbidden, including source and target ancestors. Group headings are not routing obstacles; node text and edge labels remain protected. For fixed node geometry, compare feasible port/route candidates with this lexicographic order: crossings/collisions first, then bend count, midpoint closeness, detour, and Manhattan length. This fixed-node candidate order is distinct from the complete-layout node-placement score above. A validator must report the lower-bend witness (faces, anchors, and segments) with the violation.

When component geometry, label/badge exclusion bounds, route ownership, port-order metadata, or a supported shape boundary is unavailable, this rule is NOT-CHECKABLE rather than inferred from pixels. Shared trunks require complete logical source-to-target paths and an explicit compatible family. Compare route alternatives for the whole family preserving its continuous shared suffix; an independent shortcut that breaks that suffix is not a feasible witness.

## Complete reusable rules

These rules apply in addition to the SVG-specific refinements below.

### Applicability and scale

- Universal for directed diagrams, including straight routes: connector rules 4–9 and 12–13, all colour rules, all text rules, and verification.
- Orthogonal box layouts only: connector rules 1–3 and 11, and all box rules. Relax those rules for genres where diagonal/curved edges or non-rectangular nodes are meaningful.
- Connector rule 14 applies to orthogonal connector geometry at native SVG scale: 1 SVG unit equals 1 CSS px. Compare post-fillet straight spans by centerline separation; if the required straight-span geometry is unavailable, report the rule as NOT-CHECKABLE.
- Sizes are relative to the diagram coordinate scale except where this document specifies an SVG value. Arrowheads should be slightly wider than title cap height; connector strokes must remain clearly thinner than node borders.

### Connectors: lines and arrows

1. Exit from the box face pointing towards the target, taking the most direct orthogonal route. Above/below targets use a straight top/bottom route; offset targets use the facing side, open space, then a turn. Leave and arrive perpendicular to the relevant faces.
2. Anchor endpoints at the middle of their box edge by default, but minimizing bends outranks midpoint centring. For fixed node geometry, compare feasible port/route candidates in this order: crossings/geometry collisions, bend count, midpoint closeness, detour, then Manhattan length. An endpoint may move along the same valid box face facing the other endpoint when the move reduces bends without increasing crossings, geometry collisions, label/badge conflicts, or semantic ambiguity. Also offset to distribute genuinely distinct edges on a shared face or to clear a badge/label. Among candidates with equal crossing/collision and bend scores, choose the anchors closest to the edge midpoints even when another candidate has a shorter detour or Manhattan route; departure and arrival remain perpendicular to their faces.
3. Use orthogonal polylines, not splines. A rounded corner is a small fillet on a right angle, never a Bézier substitute; use a uniform `r=5` fillet for comparable bends.
4. The arrowhead follows the final segment direction. The final segment must point into the target edge; do not terminate a horizontal segment with a down arrowhead, or vice versa.
5. Land clear of badges and titles. Offset an endpoint when the usual edge midpoint would put the arrowhead under a badge or label.
6. Leave whitespace between routes and unrelated node/container outlines. Positive-length riding on any group border is blocking, including source/target ancestors; transverse crossings are allowed. Group headings are not routing obstacles; nodes, node text and edge labels remain protected.
7. All arrowheads use one fixed absolute size: SVG markers use `markerUnits="userSpaceOnUse"`, one `markerWidth`/`markerHeight`, and a triangle tip reference point (for `M0,0 L10,5 L0,10`, use `refX="10"`). The tip lands exactly on the target edge—no gap, no intrusion.
8. **Use `stroke-width="1"` unless line weight is used for emphasis.** Node borders are a separate layer and may differ.
9. Lines are solid by default. Dashes/dots require actual documented meaning and apply consistently to that relationship class.
10. Semantically related incoming connectors at one target may explicitly declare one `data-shared-trunk` family; equal targets alone are insufficient. Keep compatible styles and every complete source-to-target path. Join as early as useful without premerge crossings, then share one continuous downstream suffix, possibly with bends, and one visible arrowhead. Never split and rejoin, or overlap an outgoing start. Common geometry overlaps; it is never a decorative replacement trunk.
11. Edge labels. (a) A label of fewer than 4 words floats on its own route, centred on a straight segment of that route. On a vertical or mostly vertical route the label is drawn vertically, rotated -90 degrees so it reads bottom to top. A label of 4 or more words sits beside its own route. This is a strong default, not a measured limit: the reviewer judges it. (b) An edge label has no border: no stroke on its pill or background shape. It always has a background, an opaque fill matching the canvas, so its own route is never struck through the text. (c) Placement priority, highest first: (1) the label is clearly owned by its own route; (2) the label background never hides another route; (3) the label sits on its own route, centred; (4) the label sits beside its route. If (1) and (2) cannot both hold, change the layout (widen the gap, spread the ports); never push the label away from its route.
12. Assign ordered ports and routing tracks before drawing; minimize crossings before minimizing length. Count each visible crossing location once, deduplicating shared logical paths and excluding valid merge joins. Any remaining intersection is a failure unless it is a shared endpoint or explicitly documented shared route. In a dense diagram (20 or more source relations) a crossing is minor, not a failure; see "Dense diagrams".
13. Arrowhead clearance is a hard feasibility requirement: the arrowhead must not overlap the final bend or intersect any earlier segment of its own connector. Keep a visible straight shaft of at least 8 SVG units from the end of the last fillet to the arrowhead base; if there is no bend, measure from the source boundary. The final theoretical segment must be at least `actual fillet trim + effective arrowhead axial length + 8` SVG units. Check this before route-length minimization; both generator and validator must enforce it. Fixture: with `r=5` and arrowhead axial length 12, a last leg of 10 fails and 25 passes.
14. Parallel-span clearance is a hard feasibility requirement: for every pair of distinct logical connectors, compare every pair of parallel straight centerline spans whose projected overlap is positive after the actual fillet trim. At native scale (1 SVG unit = 1 CSS px), their centerline separation must be at least 10 SVG units; measure centerline-to-centerline separation, not the visible stroke gap. Coincident distinct spans therefore fail unless the model explicitly declares an intentional shared bus or junction topology; sharing a source or target does not create an exemption. Apply this check before route-length or other aesthetic ranking, and enforce it independently in both the generator and validator. Fixture: positive-overlap spans separated by 9 fail, and spans separated by 10 pass.

### Boxes: nodes and containers

- **B1 — Quantized size.** Use the code-owned `BOX_RULES_PROFILE` label-box tiers: compact/S 96×40, standard/M 200×80, wide/L 320×120, extra/XL 480×160. Same semantic family, shape and layer use one tier; long text may enlarge it on the 4-unit grid. Declare optional `sizeFamily`, `sizeTier`, `layer` and `sizeExtension: {width,height}` in whole nonnegative grid steps (SVG `data-size-family`, `data-size-tier`, `data-layer`, JSON `data-size-extension`); geometry must verify them. The renderer draws declared coordinates without auto-resizing or routing.
- **B2 — Uniform gaps.** Use one vertical gap for stacks and one horizontal gap for lanes/columns; do not hand-tune neighbouring gaps.
- **B3 — Shared grid.** Snap boxes to a grid. Nodes connected across lanes share the appropriate connector axis, avoiding needless stepped connectors.
- **B4 — Uniform border.** Peer boxes use one border weight. A different weight needs a documented semantic class.
- **B5 — Floating labels clear boxes.** Pills, annotations, and edge labels live in open space; none touches a box outline.
- **B6 — Fixed internal anchors.** Equivalent box elements occupy equivalent positions: badge, title, body, and action/next-step hint.
- **B7 — Equal padding and margins.** Titles and body content share a consistent left margin (or consistent body indent) and even padding.
- **B8 — Compress empty space.** Keep lanes only as tall/wide as their content and necessary parallel work require.
- **B9 — Centre nested peer groups.** Treat peer children arranged in one row or column as one rigid group. Compute their union bounds within the parent container's declared `contentBox`, after excluding any explicitly reserved title or badge area. On the constrained axis, leading and trailing free space must differ by no more than 1 SVG unit. Correct an imbalance by translating the group as a whole while preserving child sizes and uniform internal gaps; do not hand-adjust individual children. If the translation changes connector routes, reassign endpoints and reroute using the existing lexicographic priorities.
- **B10 — Preserve container margin.** A nested box never touches or overlaps its container border. Sibling groups never overlap; only explicitly declared nesting permits group containment.

### Colours: one semantic palette

- **C1 — Declare it.** Put one semantic palette in a source comment: each role, its border/background/text/light-on-dark variants, and its meaning. Do not introduce off-palette near-duplicates.
- **C2 — Colour by meaning.** Colour nodes, arrows, and associated labels by the domain/state they represent. An arrow normally takes the semantic colour of its destination; its edge label uses that same colour.
- **C3 — Reserve neutral ink.** Grey/ink denotes raw data, secondary notes, or absence of semantic state—not a fallback when a semantic role applies.
- **C4 — Test palette membership.** A route intentionally matching a destination border is correct when it has the same documented meaning. Reject invented colours, not intentional same-role matches.
- **C5 — Keep legend and use aligned.** If a colour's actual use expands, update the declared meaning rather than allowing the palette documentation to drift.

Every normal-text foreground/background pair must meet 4.5:1 contrast. Preserve semantic hue when adjusting contrast: use a documented subtle background with dark text or a documented bold background with inverse light text; give warning/yellow its own tested dark-text pairing.

### Text

- **T1 — No collisions.** Protect node text and edge labels from text, connectors, arrowheads and borders. Group headings are not route obstacles; nodes still must clear heading text. Move, wrap or resize colliding text.
- **T2 — Fit within nodes.** Text stays inside its box padding. The longest line determines box width; wrap or grow the box using B1 when needed.
- **T3 — Align by content.** Centre a short title-only node. Left-align title and body together as soon as a node has body/detail lines. Decision diamonds remain centred.
- **T4 — Distinguish labels by size, not boldness.** Component or element primary labels and their descriptions/details use normal font weight (`400`). Make the primary label larger than its description/detail to express hierarchy; do not use bold or semibold weight for that distinction. Diagram-region headings and ordinal numerals may use a heavier weight as separately documented hierarchy roles.

## Decision-node text capacity

- Use a normal diamond with a 10-unit outline fillet for a short decision label.
- When a decision label needs more horizontal reading space, retain the decision silhouette by using a horizontally extended hexagon with its two points at the top and bottom, also with a 10-unit outline fillet. This is the Diagram Rules long-text-decision variant, not a claim of UML or BPMN notation.
- Use the left/right-pointed horizontal hexagon only when its separately documented meaning is intended; do not substitute it for a decision merely because it accommodates text.
- Keep the decision's incoming/outgoing relationships and Yes/No (or equivalent) labels unchanged when applying this visual variant.

## Rectangular nodes

- Apply explicit node-corner values: rectangular content/process/status nodes use `r=4`; diamonds and long-text decision hexagons use a 10-unit outline fillet. This is a node-shape rule, separate from connector-corner smoothing.
- Keep these fixed values for like-for-like nodes within one diagram; preserve the recognisable silhouette of each meaningful notation shape.
- Preserve a capsule/stadium node as a capsule; do not flatten it into a rounded rectangle merely to apply the rectangular corner radius.
- Centre a short, single statement within its node. When node content is a list, left-align the list in rectangles, diamonds, and hexagons, with consistent internal padding.
- Every shape renderer must explicitly provide a rectangular `labelBox`; text layout uses only that box and never a renderer-default text width. For rectangles and capsules, inset the node bounds by 8 units. For diamonds and long-text decision hexagons, define the central `labelBox` when defining the shape; if its content does not fit, enlarge the node rather than infer a wider region at runtime. Centre a single statement; left-align lists within the `labelBox`.
- Use the code-owned `labelBox` size tiers: S = 96×40, M = 200×80, L = 320×120, XL = 480×160 (compact, standard, wide, extra). Assign a consistent tier per semantic family/shape/layer; enlarge on the profile's 4-unit grid for long text. Shape outlines add their documented padding or points.
- Font fill: a node's primary label uses the largest font size (whole units, 14 to 28) at which its wrapped text fits its `labelBox`; padding is not a reason for a smaller font. Comparable nodes (same tier, same role) share one font size, the smallest of their individual maxima, so peers stay uniform. Descriptions stay smaller than the primary label (T4).
- Presentation legibility: use the externally declared `{mode: fit|native, width?, height?, scale?}`. Default fit is 1200×710: effective size = font-size × min(1200/viewBox width, 710/viewBox height). A declared fit derives scale from its width/height; native uses scale (default 1). The primary node label font must be at least 12 px in that presentation. If it is below that, the author must enlarge the font within the box, use a smaller tier with a larger font, or fold or relayout to reduce the canvas.
- Preserve the diagram's semantic background palette, including meaningful light/dark variants of a hue. Define explicit paired tokens—`background.<role>.subtle` with dark text, `background.<role>.bold` with inverse light text—rather than a universal text colour. Each pair must meet a 4.5:1 contrast ratio for normal text. A middle-tone fill that supports neither pair must be moved to a lighter or darker variant of the same semantic hue; warning/yellow receives its own tested dark-text pairing.

## Verification

After every layout change, call `diagram_inspect` and look at the full image and the close crops; fix every defect you see, then inspect again. Tool findings are measurements of these rules: act on them. Implementation guidance for generator and validator code (execution responsibility matrix, script-first geometry, verification loop) lives in `diagram-rules-implementation.md`; it is not part of the author's task.
