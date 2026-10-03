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

For orthogonal box layouts, treat node positions and connector routes as one layout problem. A **bend** is one 90-degree direction change in one logical relationship; a rounded fillet still counts as one bend. Count shared visual tracks separately for every logical relationship. A relationship's **detour** is its displacement perpendicular to its primary direction: vertical displacement for a horizontal relationship, and horizontal displacement for a vertical relationship.

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

For this rule, enumerate source and target face pairs and candidate anchors at face midpoints, projected alignment points, and the face positions induced by a one-bend orthogonal L. A candidate is **feasible** only when its two straight legs: leave/arrive perpendicular to their chosen faces; keep their interiors outside every unrelated component and container; create no non-shared connector crossing; avoid declared label, badge, and exclusion rectangles; and do not violate a declared port order or relationship-specific routing constraint. A source or target ancestor container is a routing transit region for its descendant connector: its interior and boundary may be traversed unless explicit boundary or port metadata forbids it. For fixed node geometry, compare feasible port/route candidates with this lexicographic order: crossings/collisions first, then bend count, midpoint closeness, detour, and Manhattan length. This fixed-node candidate order is distinct from the complete-layout node-placement score above. A validator must report the lower-bend witness (faces, anchors, and segments) with the violation.

When component geometry, label/badge exclusion bounds, route ownership, port-order metadata, or a supported shape boundary is unavailable, this rule is NOT-CHECKABLE rather than inferred from pixels. Shared trunks remain valid only where each logical relationship retains its own complete source-to-target route and the shared geometry is explicitly compatible with the relationship constraints.

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
6. Leave whitespace between a route and every non-target box or container. A connector must not graze or ride along an unrelated outline.
7. All arrowheads use one fixed absolute size: SVG markers use `markerUnits="userSpaceOnUse"`, one `markerWidth`/`markerHeight`, and a triangle tip reference point (for `M0,0 L10,5 L0,10`, use `refX="10"`). The tip lands exactly on the target edge—no gap, no intrusion.
8. **Use `stroke-width="1"` unless line weight is used for emphasis.** Node borders are a separate layer and may differ.
9. Lines are solid by default. Dashes/dots require actual documented meaning and apply consistently to that relationship class.
10. For multiple edges converging on the same target from the same direction, merge them into one visual final trunk and one arrowhead. Every logical relationship nevertheless remains a complete source-to-target SVG path; common geometry overlaps rather than being replaced by a decorative trunk.
11. Edge labels. (a) A label of fewer than 4 words floats on its own route, centred on a straight segment of that route. On a vertical or mostly vertical route the label is drawn vertically, rotated -90 degrees so it reads bottom to top. A label of 4 or more words sits beside its own route. This is a strong default, not a measured limit: the reviewer judges it. (b) An edge label has no border: no stroke on its pill or background shape. It always has a background, an opaque fill matching the canvas, so its own route is never struck through the text. (c) Placement priority, highest first: (1) the label is clearly owned by its own route; (2) the label background never hides another route; (3) the label sits on its own route, centred; (4) the label sits beside its route. If (1) and (2) cannot both hold, change the layout (widen the gap, spread the ports); never push the label away from its route.
12. Assign ordered ports and routing tracks before drawing; minimize crossings before minimizing length. Any segment intersection is a failure unless it is a shared endpoint or explicitly documented shared route. In a dense diagram (20 or more source relations) a crossing is minor, not a failure; see "Dense diagrams".
13. Arrowhead clearance is a hard feasibility requirement: the arrowhead must not overlap the final bend or intersect any earlier segment of its own connector. Keep a visible straight shaft of at least 8 SVG units from the end of the last fillet to the arrowhead base; if there is no bend, measure from the source boundary. The final theoretical segment must be at least `actual fillet trim + effective arrowhead axial length + 8` SVG units. Check this before route-length minimization; both generator and validator must enforce it. Fixture: with `r=5` and arrowhead axial length 12, a last leg of 10 fails and 25 passes.
14. Parallel-span clearance is a hard feasibility requirement: for every pair of distinct logical connectors, compare every pair of parallel straight centerline spans whose projected overlap is positive after the actual fillet trim. At native scale (1 SVG unit = 1 CSS px), their centerline separation must be at least 10 SVG units; measure centerline-to-centerline separation, not the visible stroke gap. Coincident distinct spans therefore fail unless the model explicitly declares an intentional shared bus or junction topology; sharing a source or target does not create an exemption. Apply this check before route-length or other aesthetic ranking, and enforce it independently in both the generator and validator. Fixture: positive-overlap spans separated by 9 fail, and spans separated by 10 pass.

### Boxes: nodes and containers

- **B1 — Quantized size.** Use one content formula: equal top/bottom padding plus line count × line height. Peer boxes share width; equal line counts yield equal height.
- **B2 — Uniform gaps.** Use one vertical gap for stacks and one horizontal gap for lanes/columns; do not hand-tune neighbouring gaps.
- **B3 — Shared grid.** Snap boxes to a grid. Nodes connected across lanes share the appropriate connector axis, avoiding needless stepped connectors.
- **B4 — Uniform border.** Peer boxes use one border weight. A different weight needs a documented semantic class.
- **B5 — Floating labels clear boxes.** Pills, annotations, and edge labels live in open space; none touches a box outline.
- **B6 — Fixed internal anchors.** Equivalent box elements occupy equivalent positions: badge, title, body, and action/next-step hint.
- **B7 — Equal padding and margins.** Titles and body content share a consistent left margin (or consistent body indent) and even padding.
- **B8 — Compress empty space.** Keep lanes only as tall/wide as their content and necessary parallel work require.
- **B9 — Centre nested peer groups.** Treat peer children arranged in one row or column as one rigid group. Compute their union bounds within the parent container's declared `contentBox`, after excluding any explicitly reserved title or badge area. On the constrained axis, leading and trailing free space must differ by no more than 1 SVG unit. Correct an imbalance by translating the group as a whole while preserving child sizes and uniform internal gaps; do not hand-adjust individual children. If the translation changes connector routes, reassign endpoints and reroute using the existing lexicographic priorities.
- **B10 — Preserve container margin.** A nested box never touches or overlaps its container border.

### Colours: one semantic palette

- **C1 — Declare it.** Put one semantic palette in a source comment: each role, its border/background/text/light-on-dark variants, and its meaning. Do not introduce off-palette near-duplicates.
- **C2 — Colour by meaning.** Colour nodes, arrows, and associated labels by the domain/state they represent. An arrow normally takes the semantic colour of its destination; its edge label uses that same colour.
- **C3 — Reserve neutral ink.** Grey/ink denotes raw data, secondary notes, or absence of semantic state—not a fallback when a semantic role applies.
- **C4 — Test palette membership.** A route intentionally matching a destination border is correct when it has the same documented meaning. Reject invented colours, not intentional same-role matches.
- **C5 — Keep legend and use aligned.** If a colour's actual use expands, update the declared meaning rather than allowing the palette documentation to drift.

Every normal-text foreground/background pair must meet 4.5:1 contrast. Preserve semantic hue when adjusting contrast: use a documented subtle background with dark text or a documented bold background with inverse light text; give warning/yellow its own tested dark-text pairing.

### Text

- **T1 — No collisions.** No text overlaps text, a connector, arrowhead, or border. Move, wrap, or resize it instead.
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
- Every shape renderer must explicitly provide a rectangular `labelBox`; text layout uses only that box and never a renderer-default text width. For rectangles and capsules, inset the node bounds by 12 units. For diamonds and long-text decision hexagons, define the central `labelBox` when defining the shape; if its content does not fit, enlarge the node rather than infer a wider region at runtime. Centre a single statement; left-align lists within the `labelBox`.
- Use only four fixed `labelBox` size tiers: S = 96×40, M = 200×80, L = 320×120, XL = 480×160. Assign the smallest tier that fits the content; do not stretch a tier. Comparable nodes use the same tier, and a shape's outline adds only its documented fixed padding or points around that box.
- Preserve the diagram's semantic background palette, including meaningful light/dark variants of a hue. Define explicit paired tokens—`background.<role>.subtle` with dark text, `background.<role>.bold` with inverse light text—rather than a universal text colour. Each pair must meet a 4.5:1 contrast ratio for normal text. A middle-tone fill that supports neither pair must be moved to a lighter or darker variant of the same semantic hue; warning/yellow receives its own tested dark-text pairing.

## Execution split: script first

### Rule execution responsibility matrix

This Markdown file is the normative source for **all** Diagram Rules. A rule may then have one or more execution owners:

| Rule family | Generator responsibility | Validator responsibility | AI / human review |
|---|---|---|---|
| Preserve nodes, text, relationships, direction, and group/subgraph/container membership | Carry the declared architecture model and original visible containment into the output without semantic edits | Compare per-node source membership, actual original rendered containment, and output bindings; reject missing, extra, or mismatched entities or membership | Resolve declared-versus-rendered membership ambiguity before generation; require explicit authorization to regroup |
| Grid, row/column tracks, peer alignment, equal gaps, nested-group centring, and container margins | Calculate positions from declared tracks, content boxes, and spacing tokens | Measure declared groups, axes, gaps, padding, and boundary containment | Decide which semantic peers belong to a shared track when the model does not declare it |
| Aspect band and track folding | Generate wrap-order fold candidates for every ordered peer track and score them at metric 2 | Measure the content box, compute the band violation, and reject a layout when a fold candidate with a lower lexicographic score exists | Confirm the viewport when undeclared and judge whether a track is semantically foldable |
| Orthogonal routing, crossing avoidance, minimum bends, midpoint preference, clearance, and ordered ports | Enumerate feasible node/port/route candidates and choose them by the documented lexicographic score | Reconstruct feasible witnesses and reject crossings, collisions, illegal junctions, avoidable bends, inferior midpoint choices, and inadequate clearance | Judge exceptions whose business routing constraints are not machine-readable |
| Parallel connector span clearance | Enumerate distinct-connector parallel straight-span pairs after actual fillet trim and reject centerline separations below 10 SVG units before aesthetic ranking; preserve explicit shared bus/junction declarations | Independently reconstruct post-fillet straight spans, test positive projected overlap and centerline separation, and reject sub-10 or coincident spans without an explicit shared bus/junction topology | Confirm whether any coincident route is an explicitly intentional shared bus/junction topology; same-source or same-target relationships are not sufficient |
| Arrow direction, marker geometry, stroke width, corner radius, and palette membership | Emit the declared marker, stroke, corner, and semantic-colour tokens | Inspect the SVG attributes and geometry for exact conformance | Review whether a colour or emphasis role expresses the intended meaning |
| Annotation ownership, enumerable placement, fallback order, standard gap, collision avoidance, and owner-colour inheritance | Resolve each annotation from its declared owner and placement candidates; never invent free coordinates | Check one-to-one model/SVG binding, owner, selected candidate, gap, collisions, ordinal content, and inherited colour | Confirm ownership when the source material itself is ambiguous |
| External actors, outside-container placement, aligned entry routes, and comparable target distances | Jointly place movable actors and generate their connectors | Check labels, container exclusion, entry midpoint geometry, straightness, and declared distance-track tolerance | Decide whether actors are external and which entry relationships are comparable when undeclared |
| Text fit, collision, contrast, and label/description typography | Lay out text inside the declared `labelBox`; use normal weight for component labels and descriptions and distinguish them by size | Check bounds, overlaps, contrast, allowed font weights, and that primary-label size exceeds description size | Inspect optical balance, legibility, and overall hierarchy at 2× render |
| Overall visual coordination and genre-appropriate exceptions | Provide deterministic candidates and expose declared exceptions | Report `NOT-CHECKABLE` when evidence or supported geometry is missing; never guess a pass | Make the final render-and-crop judgment and document any accepted exception |

The generator and validator must be independent consumers of the same model and tokens: generator success is not validation. A mechanically testable rule is incomplete until the validator has a failing fixture and a passing fixture. Rules that require semantic judgment remain normative here and must be verified in the final 2× render review.

Put deterministic geometry in scripts, not in an AI-only workflow:

- assign ordered source and target ports;
- allocate orthogonal routing tracks;
- when relationships share a visual trunk or rail, keep every relationship as its own complete source-to-target SVG path; make common segments geometrically overlap rather than replacing them with a separate decorative connector;
- minimize crossings before minimizing length;
- avoid unrelated nodes and keep endpoints perpendicular to box faces;
- render every logical 90-degree connector bend with one uniform `r=5` corner radius; preserve straight T-junctions and shared trunks;
- make arrowheads follow the final segment and place the tip exactly on the target edge: never leave a visible gap and never let the marker intrude into the target; use one uniform marker size across the diagram;
- enforce at least 10 SVG units of centerline separation for every pair of distinct parallel straight spans with positive projected overlap after fillet trimming, unless an explicit shared bus/junction topology is declared;
- enforce line width, marker size, corner treatment, and contrast;
- detect segment intersections after generation.

An intersection is a failure unless it is a shared endpoint or an explicitly documented shared route. The generated SVG must not retain conflicting default and replacement marker or stroke rules.

Keep connector routing orthogonal: corner smoothing is a fillet on a right-angle route, not a Bézier/spline substitute. The same radius must be used for comparable bends within a diagram; a corner split across multiple SVG segments is still one logical bend and must be smoothed.

## AI's limited role

Use AI for decisions a geometry script cannot establish reliably:

- whether a Diagram Rule applies to this diagram genre;
- whether multiple paths represent the same handoff and may visually share a final trunk;
- whether the task is faithful reproduction or has permission for structural redesign;
- diagnosing exceptions and performing final render-and-look review.

AI does not substitute for deterministic routing or validation.

## Verification

For every SVG generation or transformation, run this loop before claiming completion: render the standalone SVG at 2×, crop each changed or high-risk region, inspect it, fix every discovered defect, then re-render and re-inspect the affected crop. A full-canvas render alone is not validation.

For every transformation:

1. Compare the rendered original and transformed SVG.
2. Check that node count, labels, and relationship count/direction are unchanged unless the user explicitly approved a semantic change.
3. Run geometric checks for unintended crossings, node collisions, marker orientation, endpoint placement, and label/line overlap.
4. Inspect representative rendered regions; report remaining visual defects separately from semantic/design questions.
