# Semantic and visual quality

## Semantic contract before drawing

Extract exact nodes/labels/diacritics, shapes, group nesting/membership, and every edge's identity, endpoints, direction, style and label. Preserve parallel relations and semantic colors/legends. Do not invent bidirectional arrows or merge opposite single-direction edges. If a source already contains a bidirectional relation, preserve and surface it rather than deleting meaning.

Write roles, justified hierarchy/reading order, peers, governance layers, business/data flow and uncertainties. A governance node can occupy a separate top layer without being a group. Choose the topology that explains this source; do not force all diagrams into one hierarchy. Semantic planning precedes positioning.

## Repair moves

These are **preferences**, not unconditional gates. Choose what makes this diagram clearer and explain material exceptions.

- Give crowded nodes/groups/labels room at the intended viewing scale. Widen/rearrange a group before squeezing text; check clipping at full size and fit view.
- Move nodes **with ports, routes and labels**. Straighten avoidable doglegs and center-align meaningful peers. Check terminal nodes and return paths too. Do not optimize only routes on fixed node positions.
- Remove avoidable crossings by changing source/target order or moving clusters. If unavoidable, make non-connection explicit (for example a bridge), retain direction and disclose it. Shorter routes cannot justify obscured relations.
- Give nested groups a visible inset/title clearance. Check sibling-container overlap too; membership/ID parity does not prove separation.
- Use related, restrained, modern, elegant colors when the palette is unattractive. Preserve colors that encode meaning, maintain contrast and meaningful group distinctions.
- Edge-label backgrounds default to **50% opacity** with fully opaque text. Apply `fill-opacity` to the background shape, not its parent. Inspect labels over real routes; explain justified exceptions. Preserve raw audit failures with a separate soft-preference disposition.
- Inspect **visible arrow orientation** as well as endpoint metadata. Invisible/tiny heads or physically reversed arrows can pass structural checks.

## Review and feedback

View the original/current candidate, whole diagram, fit view and all crowded/crossing/terminal/return-path crops. Inspect all groups, not only the user's latest example. Independently review remaining defects; the main agent chooses repairs.

After each revision compare exact entities/text, edge multiplicity/direction/style, shapes and group ownership. Keep raw audits, with separate dispositions for preferences/tradeoffs/non-checkable curves. Metadata, unit tests and Judge scores do not certify paint. A score belongs only to its exact source/SVG/runtime/model versions. A timed-out/censored run remains a draft; a later repair needs its own review.

Feedback may return to semantic planning, generation or visual repair. Preserve original/prior accepted candidate/new proposal. Do not stage a changed image using the old image's review hashes or approval. A useful suggestion and request for feedback can be a valid outcome; do not force one-shot completion.

## Viewer and comparison behavior

Use the verified product's Mermaid/prepared-SVG adapters and shared interaction runtime. Hover/selection highlights actual associated relations and dims unrelated nodes, edges and labels. Do not infer relations from proximity. Preserve original behavior and clearing selection.

Give **each mounted SVG** unique IDs and rewrite fragment references together: marker/clip/mask/filter/gradient `url(#...)`, href and relevant style references. Original/refined/side-by-side and hidden copies can share a document; hidden duplicate IDs must not steal markers. Keep canonical artifact identity metadata unchanged when namespacing gallery copies.

Observe arrow visibility and highlighting/dimming in single, switched and side-by-side modes at actual scale. Structural resolution does not prove browser paint/hit testing. Mark unavailable UI checks `NOT_VERIFIED`/`SKIPPED` with the reason. Honor access refusals; do not route around a rejected surface through another browser or endpoint.
