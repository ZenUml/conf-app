# Helping customers standardize their diagrams

**Status:** proposal, not settled scope. Nothing here is validated against our own usage data yet —
see [Validate before building](#validate-before-building). Research backing:
[docs/research/architecture-diagram-frameworks.md](../research/architecture-diagram-frameworks.md).

## The strategic call: don't sell them a standard, remove their ambiguity

The instinct behind "help customers make their diagrams more standard" is usually *get them onto
C4 / ArchiMate / UML*. The evidence says that is the losing half of the market and the wrong
mechanism.

Measured, not assumed (§10 of the research note):

| Evidence | Number |
|---|---|
| Architectural views using **informal** notation (ECSA 2024, open-source corpus) | **96%** |
| Views using a semi-formal notation (UML) | **4%** |
| Views that use colour **without defining what the colours mean** | **81%** |
| Views with exactly one contributor | **>92%** |
| Professional engineers using UML at all (Petre, ICSE 2013, n=50) | **15 / 50**, none wholeheartedly |
| Practitioners choosing ad hoc boxes/lines even for complex decisions (Ozkaya, n=115) | **40%** |

Two conclusions follow directly:

1. **A feature that requires adopting a formal notation addresses ~4% of the behaviour.** Every
   attempt to push practitioners up the formality ladder for thirty years has lost. We should not
   re-run that experiment with a Confluence macro.
2. **"Standard" that wins means *internally consistent and unambiguous*, not *conformant to an
   external spec*.** A team whose forty diagrams agree with each other on what a red box and a
   dashed arrow mean has achieved the actual business outcome. Which external standard they
   resemble is irrelevant to them.

There is also a mechanism insight worth stating plainly, because it defines the product
opportunity. Research §10.3, reason 1: **notations standardise when a machine consumes them and
rejects malformed input.** Code has compilers; APIs have OpenAPI validators; BPMN has execution
engines. Architecture diagrams have no such consumer, so nothing punishes ambiguity.

**We are in a position to be that consumer.** That is the differentiated play, and it is not
available to a generic drawing tool.

## What "unambiguous" concretely means

The research pins the failure modes precisely. These are the things to fix — in priority order by
evidence strength:

| # | Failure mode | Evidence | Fix |
|---|---|---|---|
| 1 | Colour carries meaning that is never defined | 81% of views | Legend, generated not hand-written |
| 2 | Arrows don't say what flows, or whether they're sync/async | 74% unidirectional, semantics unstated | Typed connectors |
| 3 | Boxes have a name but no *type* | folk notation has no type slot | Typed elements (name + type + purpose) |
| 4 | One diagram mixes abstraction levels | the most common defect in review | Level hint / lint |
| 5 | Nobody reviews a diagram, so errors never surface | >92% single contributor | A checker that reviews it for them |

Note that #5 is why #1–#4 persist. There is no feedback loop. Supplying one is the leverage point.

## Proposed ladder

Ordered by evidence-to-effort ratio, not by ambition. Each tier is independently shippable.

### Tier 1 — make the folk notation self-documenting (highest leverage)

**1.1 Auto-legend.** Scan the diagram for the colours, shapes and line styles actually in use;
render a legend block; prompt the author to name each entry once. Attacks the single
best-evidenced defect (81%) and produces a *visible* improvement in the rendered macro, which is
what makes a viewer-side feature spread inside a customer.

**1.2 Typed connectors.** A control on any edge: `calls (sync)` / `sends (async)` / `data flow` /
`deploys to` / `depends on`, rendering as a consistent line style plus an optional label. Uses the
SEI connector vocabulary (call-return, pipe, pub-sub, data access) without ever showing the
customer that word.

**1.3 Typed elements.** A palette whose shapes carry a type: Person, System, Service/Container,
Component, Data store, External, Boundary. This is C4's `Name / [Type: tech] / purpose` labelling
discipline delivered as a shape library — the discipline spreads, the framework name never has to.

### Tier 2 — templates and house style

**2.1 Framework templates.** Start-from-template is how notation actually propagates: people copy.
Ship C4 context/container, arc42 §5 building block / §6 runtime / §7 deployment, DFD + trust
boundary, and deployment. This is the one place formal frameworks belong — as an *optional
starting point*, never as a constraint.

**2.2 Space- or site-level house style.** The customer's own palette, shape vocabulary and legend
definitions, saved at space/site scope and applied to new diagrams. This is the direct expression
of the strategic call: *their* standard, made consistent. Natural fit for a paid/Enterprise tier,
and it is the feature an architecture-governance buyer actually wants.

### Tier 3 — be the machine consumer (the differentiated bet)

**3.1 Diagram lint.** A checker in the editor and/or a quality score in the viewer. Rules map 1:1
to the failure-mode table: unlabeled arrows, colours used but undefined, untyped boxes, missing
title, no legend, mixed abstraction levels, orphan/unconnected nodes, ambiguous arrow direction.
Show findings with one-click fixes.

This is the forcing function that has never existed for architecture diagrams. If it works, it is
also the strongest reason for a customer to keep diagrams *in our macro* rather than as a pasted
image.

**3.2 AI-assisted normalization.** We already have the plumbing — `GenerateService`,
diagramly `fix-diagram`, `SyntaxErrorBox`, the `ai-repair-enabled` Forge flag. Extend it from *fix
broken syntax* to *bring this diagram up to the house style*: infer the legend, add missing arrow
labels, propose types for untyped boxes. Reuses an existing, shipped pipeline rather than building
a new one.

### Tier 4 — org-level

**4.1 Space consistency audit.** Admin-facing report across every macro in a space: which colours
are used with conflicting meanings, which diagrams lack legends, where the house style has drifted.
Enterprise-shaped, and only worth building once Tier 1–3 give it something to measure.

## Recommended first move

**Tier 1.1 (auto-legend) + Tier 3.1 (lint), scoped narrowly to the Graph/DrawIO macro.**

Rationale: DrawIO is where the folk notation lives in our product (research §10.5 — `Graph` serves
the 96%, `PlantUML` the 4%, `Mermaid` the converging middle), the two features share the same
analysis pass over the diagram model, neither asks the customer to adopt anything, and both produce
a visible artifact that a viewer — not just the author — benefits from.

## Validate before building

Do not take the ECSA numbers as our customers' numbers. We can measure our own corpus directly, and
should, because the ordering of the ladder depends on it:

- DrawIO XML carries explicit `fillColor` / `strokeColor` / edge `style` / `value` attributes, so
  "how many of our diagrams use colour without a legend" and "what fraction of edges are unlabeled"
  are *directly countable* from stored macro bodies.
- Mermaid and PlantUML bodies are text and are trivially greppable for the same signals.
- Sampling path: existing `find-macros-on-page` skill for body retrieval; internal/staging sites
  first.

**Client privacy applies**: this analysis runs on tenant content. Aggregate counts only, no tenant
names, no diagram content in any public-repo artifact — see
[docs/policies/client-privacy.md](../policies/client-privacy.md). Any per-tenant output belongs in
the `private/` submodule.

## Analytics (required before any implementation)

Per CLAUDE.md, events are defined *first* and land as the first commit of the feature branch, in
`src/utils/analytics/catalog.ts` and `src/utils/analytics/types.ts`. Draft set:

| Event | Trigger | Key properties |
|---|---|---|
| `diagram_lint_evaluated` | Checker runs on open or edit | `macro_type`, `rule_ids_failed[]`, `finding_count`, `score` |
| `diagram_lint_finding_shown` | A finding is surfaced to the author | `rule_id`, `surface` (editor/viewer) |
| `diagram_lint_fix_applied` | Author accepts a one-click fix | `rule_id`, `fix_source` (manual/ai) |
| `diagram_lint_dismissed` | Author dismisses findings | `rule_id`, `finding_count` |
| `legend_generated` | Auto-legend produces entries | `entry_count`, `undefined_entry_count` |
| `legend_entry_named` | Author names a legend entry | `entry_kind` (colour/shape/line) |
| `house_style_applied` | A space/site style is applied | `scope` (space/site), `element_count_restyled` |

`legend_generated.undefined_entry_count` is the one that matters most: it is our own measurement of
the 81% finding, per customer, over time. It tells us whether the feature moves the number.

## Open questions

1. Does our corpus actually show the ECSA failure rates? (Answerable this week — see above.)
2. Is the buyer the diagram author or an architecture-governance owner? Tier 2.2 and Tier 4 only
   make sense for the second, and we have no evidence yet which exists in our base.
3. Does lint belong in the editor (author-time, blocking-ish) or the viewer (reader-time, social
   pressure)? The >92% single-contributor finding argues the viewer creates the missing feedback
   loop, but that is an inference, not a result.
