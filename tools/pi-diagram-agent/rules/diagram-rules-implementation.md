# Diagram Rules — implementation guidance

Moved out of `diagram-rules.md` on 2026-10-03 so that the author prompt carries only the rules the author applies. This file is for whoever writes or changes the generator, renderer, auditor or reviewer code. `diagram-rules.md` remains the normative source for the rules themselves.

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
2. Check that node count, labels, and relationship count/direction are unchanged unless the user explicitly approved a semantic change. A relationship whose endpoint is a subgraph (`A --> SomeGroup`) is a relationship too: draw it to the group outline and count it; redrawing it to a member node changes the semantics (one extra and one missing relationship).
3. Run geometric checks for unintended crossings, node collisions, marker orientation, endpoint placement, and label/line overlap.
4. Inspect representative rendered regions; report remaining visual defects separately from semantic/design questions.
