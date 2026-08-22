# Frameworks, standards, and methodologies for architecture diagrams

Research note — 2026-08-22.

Scope: what formalisms exist for *describing software/system architecture visually*, how they
relate to each other, and how to choose between them. Every claim links to a primary source at
the bottom.

---

## 1. The landscape has four distinct layers

The single most useful thing to know is that "architecture diagram framework" is an ambiguous
phrase covering four different kinds of artifact that are frequently confused with each other:

| Layer | Answers the question | Examples |
|---|---|---|
| **Meta-standard** | What *is* an architecture description, formally? | ISO/IEC/IEEE 42010 |
| **Notation / language** | What do the boxes and lines *mean*? | UML, SysML, ArchiMate, BPMN, DFD, IDEF |
| **View framework** | *Which* diagrams should I produce, and for whom? | 4+1, Views & Beyond, TOGAF, Zachman, UAF, C4, arc42 |
| **Method / practice** | *How* do I arrive at the content, and keep it alive? | EventStorming, Domain Storytelling, Wardley mapping, ADRs, diagrams-as-code |

Most real-world confusion ("should we use C4 or UML?") dissolves once you notice these are
orthogonal: C4 is a view framework and is explicitly *notation-independent*, so you can render
C4 views in UML, in PlantUML, in Mermaid, or in hand-drawn boxes.

---

## 2. Meta-standard: ISO/IEC/IEEE 42010

The only genuine international standard for architecture description. Current edition is
**42010:2022** ("Software, systems and enterprise — Architecture description"), superseding
42010:2011, which itself superseded IEEE 1471-2000.

It does not define a notation or a set of diagrams. It defines the *conceptual model* everyone
else borrows:

- **Entity of Interest** — the thing being described (a system, an enterprise, a product line).
- **Stakeholders** — parties with an interest in it.
- **Concerns** — what those stakeholders care about (performance, security, cost, modifiability).
- **Architecture Viewpoint** — a reusable *specification* for how to build a view: which
  stakeholders, which concerns, which model kinds, which conventions.
- **Architecture View** — the actual artifact produced by applying a viewpoint.
- **Model kind** — the conventions for one kind of model inside a view.
- **Correspondence rules** — how elements across views relate, so views stay consistent.
- **Architecture decisions and rationale** — the *why*, treated as a first-class part of the AD.

The 2022 edition additionally specifies conformance for an **ADF** (architecture description
framework), an **ADL** (architecture description language), a viewpoint, and a model kind — i.e.
it gives TOGAF/ArchiMate/UAF-style frameworks a common yardstick.

**Why it matters practically:** the viewpoint/view/concern vocabulary is the lingua franca. If
you invent your own diagram set, defining each diagram as "viewpoint → stakeholder → concern" is
the cheapest way to make it defensible and to stop diagram sprawl.

---

## 3. Notations and modelling languages

### UML (OMG)
The general-purpose one. UML 2.5.1 defines **14 diagram types**, split into structure diagrams
(class, component, composite structure, deployment, object, package, profile) and behaviour
diagrams (activity, sequence, communication, interaction overview, timing, state machine, use
case). For *architecture* work only a handful are used in practice: component, deployment,
package, sequence, state machine.

Strengths: universally recognised, precise, huge tooling base, formal semantics for code
generation. Weaknesses: heavyweight, most teams know only a fragment, and full-fidelity UML
models rot fast. Simon Brown created C4 explicitly as a lighter alternative.

### SysML (OMG) — v1.x and the v2 reset
SysML is the systems-engineering profile of UML (hardware + software + people + processes). It
adds requirement diagrams and parametric diagrams.

**SysML v2 is the big recent change:** OMG approved final adoption on 2025-07-21 and published it
2025-09-03, together with **KerML 1.0** (the semantic foundation) and the **Systems Modeling API
and Services 1.0**. v2 is not a UML profile — it is a ground-up metamodel with a textual notation
alongside the graphical one and a standard REST API for model interchange. If you work anywhere
near MBSE (aerospace, defence, automotive, medical devices), this is the direction of travel.

### ArchiMate (The Open Group) — enterprise architecture
Current version **3.2**. A dedicated EA modelling language, structured as layers:

- Motivation elements (stakeholder, driver, goal, requirement, principle)
- Strategy layer (capability, resource, course of action, value stream)
- **Business / Application / Technology** core layers
- Physical elements, and Implementation & Migration layer

It defines relationships *between* layers (that's the point — traceability from a business goal
down to a server) and ships a catalogue of **example viewpoints** (Chapter 13 + Appendix C) that
map directly onto the ISO 42010 viewpoint mechanism. It is the natural notation companion to
TOGAF.

### BPMN 2.0 (OMG)
Process notation, not architecture notation — but it is the standard for the "how does this
business flow actually work" diagrams that sit next to architecture diagrams, and it has
executable semantics (BPMN engines).

### Data Flow Diagrams (DeMarco / Gane-Sarson / Yourdon)
Four symbols — external entity, process, data store, data flow — organised by levels: **Level 0**
context diagram (system as one process), **Level 1** major processes, **Level 2+** decomposition.
Pre-dates UML and is still the dominant notation in threat modelling (see §6).

### IDEF0 / IDEF1X, and the ER family
IDEF0 (function modelling, ICOM arrows) is still mandated in some government and manufacturing
contexts. Chen / Crow's-foot / IDEF1X ER notation remains the standard for data architecture
diagrams.

---

## 4. View frameworks: which diagrams to draw

### 4+1 (Kruchten, 1995)
The original and still the clearest general answer. Five views, each aimed at different
stakeholders:

| View | Content | Audience |
|---|---|---|
| **Logical** | Functionality, domain structure (classes, state) | End users, analysts |
| **Process** | Runtime concurrency, processes, communication, performance | Integrators |
| **Development** | Modules, packages, layering, build organisation | Developers |
| **Physical** | Mapping of software to nodes and networks | System engineers, ops |
| **+1 Scenarios** | Key use cases that tie the other four together and validate them | Everyone |

The "+1" is the load-bearing idea: scenarios are how you *check* that the four structural views
agree. Everything since (including C4) is a re-cut of this.

### Views and Beyond (SEI — Clements et al., *Documenting Software Architectures*)
The most rigorous general framework. Three **viewtypes**, each with a catalogue of styles:

- **Module** viewtype — units of implementation (decomposition, uses, layered, generalisation).
- **Component-and-connector (C&C)** viewtype — runtime elements (pipe-and-filter, client-server,
  peer-to-peer, shared-data, publish-subscribe, communicating-processes).
- **Allocation** viewtype — mapping software onto non-software structures (deployment,
  implementation, work-assignment).

Plus a documentation package template ("beyond views"): view templates, a documentation roadmap,
mapping between views, rationale. Heavier than C4, far more complete, and the source of the
module-vs-runtime-vs-deployment distinction that most modern frameworks quietly reuse.

### Rozanski & Woods — viewpoints *and* perspectives
Extends the above with six viewpoints (Context, Functional, Information, Concurrency,
Development, Deployment, Operational) crossed with **perspectives** — quality-attribute lenses
(security, performance & scalability, availability, evolution, usability, regulation) applied
*across* every view. The perspective idea is the contribution: quality attributes are not a view,
they are a filter you run over all views.

### C4 model (Simon Brown)
The dominant lightweight framework in software teams today. Four levels of a single hierarchy of
abstractions — **software system → container → component → code**:

1. **System Context** — your system as one box, surrounded by users and neighbouring systems.
2. **Container** — separately deployable/runnable things (apps, services, databases, SPAs).
   *"Container" here predates and does not mean Docker.*
3. **Component** — groupings of code inside one container.
4. **Code** — optional, rarely maintained by hand; Brown recommends generating it if you want it.

Plus **supplementary diagrams**: system landscape, dynamic (numbered interactions), and
deployment. Explicitly **notation-independent and tooling-independent**. Created between 2006 and
2011; the O'Reilly book *The C4 Model: Visualizing Software Architecture* is the current canonical
write-up. The reference implementation is **Structurizr** (DSL + Java/.NET/Python libraries):
model once, generate all levels, which structurally eliminates the "diagrams disagree with each
other" failure mode.

Its key discipline rules — worth adopting even if you never say "C4": one level of abstraction
per diagram, every diagram has a title and a legend, every box has a name *and* a type *and* a
one-line description, every line is labelled with what actually flows.

### arc42
Not a diagram framework — a **12-section documentation template** into which diagrams slot. The
architecturally load-bearing sections:

1. Introduction & goals · 2. Constraints · 3. Context & scope · 4. Solution strategy ·
**5. Building block view** (static decomposition, hierarchically refined) ·
**6. Runtime view** (scenarios, behaviour) · **7. Deployment view** (infrastructure) ·
8. Cross-cutting concepts · 9. Architecture decisions · 10. Quality requirements ·
11. Risks & technical debt · 12. Glossary.

arc42 and C4 compose cleanly and are commonly used together (C4 diagrams filling arc42 §3/§5/§6/§7).

### TOGAF (The Open Group) — enterprise
Two relevant parts. The **ADM** (Architecture Development Method) is the process cycle
(Preliminary → Vision → Business → Information Systems → Technology → Opportunities & Solutions →
Migration Planning → Implementation Governance → Change Management). The **Architecture Content
Framework** defines the deliverables, classifying every artifact as one of three kinds:

- **Catalogs** — lists of things (e.g. an application portfolio catalog)
- **Matrices** — relationships between things (e.g. application/function matrix)
- **Diagrams** — pictures of things

Each ADM phase has a prescribed artifact set. TOGAF is method + content structure; ArchiMate is
the notation you draw it in.

### Zachman Framework
An **ontology**, not a methodology — explicitly so. A 6×6 matrix: columns are the interrogatives
**What (data) · How (function) · Where (network) · Who (people) · When (time) · Why (motivation)**;
rows are perspectives/reification levels from contextual (executive) down to implementation. 36
cells classify every artifact an enterprise could produce. It tells you what is *missing*, not how
to produce it. Originated at IBM in 1987.

### UAF (and its ancestors DoDAF / MODAF / NAF)
The defence/aerospace lineage. **UAF** (OMG, first released 2017, current **1.2**, 2022) unifies
DoDAF, MODAF, NAF and UPDM on a UML/SysML foundation. It defines a **grid**: 10 domains as rows
(architecture management, strategic, operational, services, personnel, resources, security,
projects, standards, actual resources) × 11 aspects as columns (motivation, taxonomy, structure,
connectivity, processes, states, sequences, information, constraints, roadmap, traceability) —
producing **71 view specifications**. This is the heaviest option in existence and only makes
sense under a contractual mandate.

---

## 5. Methods and practices (how the content gets made and stays true)

- **EventStorming** (Alberto Brandolini) — workshop format; orange stickies = domain events on a
  timeline, then commands, aggregates, policies, read models, hot-spots. Produces the behavioural
  understanding that later becomes bounded contexts and service boundaries. Big-picture →
  process-level → design-level.
- **Domain Storytelling** (Hofer & Schwentner) — pictographic actor/work-object/activity sentences
  numbered in sequence; captures how the business actually works today, in the domain's own words.
- **Context Mapping** (DDD) — bounded contexts plus the relationship patterns between them
  (partnership, shared kernel, customer/supplier, conformist, anticorruption layer, open host
  service, published language, separate ways). The closest thing DDD has to an architecture
  diagram, and the one that best predicts organisational friction.
- **Wardley Mapping** (Simon Wardley) — value chain on the y-axis (visible to user → invisible)
  against **evolution** on the x-axis (genesis → custom-built → product → commodity). Answers
  "build, buy, or outsource, and what will move" — strategy, not structure.
- **Architecture Decision Records (ADRs)** (Michael Nygard) — one short markdown file per
  decision: context, decision, status, consequences. This is the text counterpart to the diagram
  and is what ISO 42010 calls decisions + rationale. Cheapest high-value practice on this list.
- **Diagrams-as-code** — the delivery mechanism that makes all of the above survive: diagrams
  live in the repo, review in PRs, and render in CI.
  - **Mermaid** — renders natively in GitHub/GitLab/Notion markdown; lowest friction; weakest
    layout control.
  - **PlantUML** — broadest coverage of formal UML, plus C4-PlantUML macro libraries.
  - **D2** — modern syntax, multiple layout engines, better aesthetics than Mermaid.
  - **Structurizr DSL** — the C4 reference implementation; one model, many generated views.
  - **LikeC4**, **Ilograph**, **Graphviz/DOT** — model-driven and interactive variants.

---

## 6. Domain-specific diagram standards worth knowing

- **Threat modelling** — DFDs plus **trust boundaries**, analysed with **STRIDE** (Spoofing,
  Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege).
  Every trust-boundary crossing is a point to enumerate threats against. Levelled like ordinary
  DFDs (L0 context → L1 processes → L2 services). OWASP and Microsoft both document the practice;
  ThreatModeler argues for Process Flow Diagrams instead, oriented around attacker-visible flows.
- **Cloud reference architectures** — AWS, Azure and Google Cloud each publish official icon sets
  (AWS Architecture Icons, quarterly, PPTX/Visio/SVG; Azure icon library on Microsoft Learn; GCP
  icons in the architecture docs) with usage rules: don't recolour, don't rotate, don't crop,
  always label the service by name. Their well-architected frameworks (AWS Well-Architected,
  Azure WAF, Google Architecture Framework) act as de facto review checklists that architecture
  diagrams get judged against.
- **Network / infrastructure** — Cisco's icon vocabulary is the closest thing to a standard;
  otherwise the deployment view (4+1) or allocation viewtype (SEI) covers it.
- **Data** — ER diagrams (Chen, crow's-foot, IDEF1X), plus data-lineage and data-mesh diagrams.
- **C&C runtime styles** — the pipe-and-filter / pub-sub / client-server style catalogue from SEI
  is still the standard vocabulary for describing runtime topology.

---

## 7. How to choose

| Situation | Use |
|---|---|
| One product team documenting one system | **C4** for the diagrams + **arc42** for the surrounding doc + **ADRs** |
| You need a defensible viewpoint set (audit, regulator, contract) | **ISO/IEC/IEEE 42010** vocabulary; declare each diagram as a viewpoint |
| Quality attributes are the hard part | **Rozanski & Woods** perspectives over your existing views |
| Rigour, large system, long life | **SEI Views and Beyond** |
| Enterprise portfolio, many systems, business-to-IT traceability | **TOGAF ADM** + **ArchiMate 3.2**; **Zachman** as a completeness checklist |
| Hardware + software + people (MBSE) | **SysML v2** |
| Defence / aerospace contract | **UAF 1.2** |
| You don't yet understand the domain | **EventStorming** / **Domain Storytelling** *before* drawing any architecture |
| Build-vs-buy, strategy, roadmap | **Wardley maps** |
| Security review | **DFD + trust boundaries + STRIDE** |

Rules that hold regardless of which you pick:

1. **One level of abstraction per diagram.** Mixing them is the most common defect.
2. **Every diagram has a title, a legend, and a stated audience/concern.** If you can't name the
   concern, the diagram probably shouldn't exist.
3. **Label every line** with what flows and how (protocol, sync/async, direction).
4. **Name + type + one-line description** in every box.
5. **Colour and shape must mean something, and the legend must say what.**
6. **Diagrams live next to code** and are regenerated, or they lie within a quarter.
7. **Record the decision, not just the picture** — a diagram shows the *what*, an ADR the *why*.

---

## 8. Relevance to this product (ZenUML conf-app)

Mapping the frameworks above onto our `DiagramType` enum (`src/model/Diagram/Diagram.ts`):

| Framework need | Covered by | Gap |
|---|---|---|
| 4+1 scenarios / arc42 runtime view / C4 dynamic diagram | `Sequence` (ZenUML DSL), `Mermaid` sequence | — |
| C4 context/container/component, SEI module & allocation views | `Graph` (DrawIO), `Mermaid` flowchart, `PlantUML` | No native C4 shape/level semantics — users draw them by hand |
| UML structure diagrams | `PlantUML` | — |
| Interface contracts (a genuine architecture viewpoint) | `OpenApi`, `AsyncApi` | — |
| ArchiMate / BPMN / DFD-with-trust-boundaries | — | Not covered; DrawIO shape libraries are the only route |

Two observations worth flagging for product discussion (not conclusions):

- **C4 is the highest-leverage framework we don't explicitly support.** Partial support may
  already exist incidentally via the rendering path: our PlantUML type renders through the public
  server at `https://www.plantuml.com/plantuml/` (`src/model/Attachment.ts:284`), which is where
  `C4-PlantUML` `!include <C4/...>` stdlib resolution would happen, and we ship `mermaid ^11.6.0`
  (`package.json`), a line that carries a C4 diagram type. **Neither is verified** — both need an
  actual render test before anyone repeats them as fact.
- **The frameworks that matter to Confluence users are the documentation-shaped ones** (C4,
  arc42, ADRs), because Confluence is where architecture *documentation* lives. arc42 is
  distributed as templates for exactly this kind of wiki, and a diagram macro that understands
  the arc42 section it sits in would be a differentiator over generic drawing tools.

Both need validation against actual usage data before anyone acts on them.

---

## 9. Common component (element) types

Across every framework in this note, the boxes people draw collapse into eight archetypes. The
notations disagree on *names*, not on the archetypes.

### 9.1 The eight archetypes

| # | Archetype | What it is | Typical labels |
|---|---|---|---|
| 1 | **Actor** | A human or organisation using the system | person, user, role, actor, business actor, external entity |
| 2 | **External system** | Something you depend on but don't own | external system, third-party service, SaaS, upstream/downstream system |
| 3 | **Boundary** | A scope line, not a thing | system boundary, bounded context, trust boundary, VPC/subnet, availability zone, tenant, security zone |
| 4 | **Deployable unit** | Something that runs as its own process | container (C4), service, application, worker, daemon, function, job |
| 5 | **Internal unit** | A grouping of code inside a deployable unit | component, module, package, layer, class, library |
| 6 | **Data store** | State at rest | database, table, cache, object/blob store, file system, queue, topic, index, data object |
| 7 | **Connector** | The lines — as typed as the boxes | request/response, event, data flow, dependency, hosting/deployment, pipe, shared-data access |
| 8 | **Infrastructure** | What the deployable units sit on | node, device, host, VM, cluster, load balancer, gateway, CDN, firewall, DNS, identity provider |

### 9.2 The same archetype across notations

| Archetype | C4 | UML | ArchiMate 3.2 | SEI Views & Beyond | DFD / threat model |
|---|---|---|---|---|---|
| Actor | Person | Actor | Business Actor / Business Role | (outside scope) | External entity / interactor |
| Whole system | Software System | Subsystem | Application Component (coarse) | — | Process (Level 0) |
| Deployable unit | **Container** | Artifact deployed on a Node | Application Component / Node | C&C Component | Process |
| Internal unit | Component | Component, Package, Class | Application Component (nested) | Module | Process (Level 2) |
| Data store | Container with the database shape | Artifact / Node | Data Object, Artifact | Repository (shared-data style) | Data store |
| Interface | (implicit on the relationship) | Interface, Port | Application / Technology Interface | Port | (implicit on the flow) |
| Behaviour | Dynamic diagram step | Activity, Interaction | Application Service / Function / Process | — | Process |
| Connection | Labelled relationship | Association, Dependency | Serving, Flow, Triggering, Access, Realization | Connector | Data flow |
| Boundary | Boundary box | Package, Namespace | Grouping | — | **Trust boundary** |
| Infrastructure | Deployment node | Node, Device, Execution Environment | Node, Device, System Software, Technology Service | Deployment (allocation viewtype) | — |

Two notation notes worth carrying:

- **C4 "container" does not mean Docker.** It means *a separately deployable/runnable thing* — a
  web app, an API service, a database, a single-page app, a mobile app, a shell script on a cron.
  This is the single most common misreading of the model.
- **ArchiMate 3.2 reclassified Device, System Software, Facility and Equipment** as *technology
  internal active structure elements* rather than specialisations of Node, adding composition and
  aggregation relationships to Node for flexibility. If you're reading a 3.1-era diagram or
  tutorial, that hierarchy has changed.

### 9.3 Connector types (the half everyone under-specifies)

A box's type is usually written on it; a line's type usually isn't, and that's where diagrams
lose their meaning. The SEI component-and-connector styles give the standard vocabulary:

- **call-return** — synchronous request/response (HTTP, gRPC, RPC, SQL query)
- **pipe** — streaming, ordered, one-way (pipe-and-filter style)
- **event / publish-subscribe** — asynchronous, fan-out, sender doesn't know receivers
- **data access** — reads/writes against a shared repository
- **shared data** — two components coupled through a common store (usually a smell worth marking)

At minimum, label each line with **what flows**, **the protocol**, and **sync vs async**. Direction
of the arrow should mean one thing consistently across the diagram — either "who calls whom" or
"where the data goes", never both on the same page.

### 9.4 The modern cloud vocabulary

The cloud vendors' icon sets encode a de facto element taxonomy that most contemporary
architecture diagrams use, whether or not they say so:

- **Compute** — VM/instance, container/pod, cluster, serverless function, batch job
- **Storage** — object/blob, block, file share, archive
- **Data** — relational DB, NoSQL/document, key-value, cache, search index, warehouse, lakehouse
- **Messaging** — queue, topic, event bus, stream, scheduler/cron
- **Networking & edge** — VPC, subnet, load balancer, API gateway, CDN, DNS, WAF, private link
- **Identity & security** — identity provider, secrets manager, KMS, IAM role, certificate
- **Observability** — logs, metrics, traces, alerting

Recent additions that now appear routinely and have no settled standard notation: **BFF**
(backend-for-frontend), **feature-flag service**, **model/LLM endpoint**, **vector store**,
**agent/tool runtime**, and **webhook receiver**.

### 9.5 The labelling rule that matters more than the shape

Whatever vocabulary you pick, C4's convention is the one that makes a diagram readable by someone
who wasn't in the room. Every box carries three things:

```
Name                 <- what it is called
[Type: technology]   <- which archetype, and what it is built with
One line of purpose  <- why it exists
```

If a box can't be given a type, it usually means two archetypes have been merged into one shape,
and the diagram is mixing levels of abstraction.

---

## 10. What notation do people actually use — and why isn't there a standard one?

### 10.1 The answer: informal boxes-and-arrows, by a wide margin

This is measurable, and it has been measured.

- **ECSA 2024** (Migliorini, Verdecchia, Malavolta, Lago, Vicario — *Architectural Views: The State
  of Practice in Open-Source Software Projects*): **96% of architectural views use an informal
  notation; only 4% use a semi-formal one (UML).** Same study: **81%** of views use colour, but the
  meaning of the colours is *seldom defined*; **74%** of connectors are unidirectional; **more than
  92%** of views have exactly one contributor.
- **Petre, ICSE 2013** (*UML in practice*): of 50 interviewed professional software engineers,
  **only 15 used UML at all, and none used it wholeheartedly**. Eleven used it selectively,
  adapting it to the audience. Diagram types among those: class 7, sequence 6, activity 6, state 2,
  use case 1.
- **Ozkaya, Information & Software Technology (2018)** — survey of 115 practitioners across 28
  countries: non-formal notations are the top choice at **94%**, and **40%** deliberately use ad hoc
  boxes/lines plus natural language even for complex design decisions. Cited reasons: low learning
  curve (**79%**), visuality (**62%**), general-purpose scope (**66%**).

*Terminology caveat:* the two big surveys don't slice the same way. Ozkaya's "informal" means
"not a formal ADL with mathematical semantics" and includes UML; the ECSA study's "informal" means
"not UML either — ad hoc boxes and lines". Read together they say the same thing from two
directions: formal ADLs are essentially unused, and UML is a minority even among the survivors.

So the honest answer to "what's the most common notation" is: **an unstandardised folk notation**,
drawn in draw.io / Lucidchart / Excalidraw / Miro / PowerPoint, increasingly in Mermaid inside
markdown, using cloud-vendor icons for infrastructure.

### 10.2 The folk notation is real, and remarkably consistent

Nobody specified it, yet it is broadly mutually intelligible:

| Convention | Meaning |
|---|---|
| Rectangle | A thing (service, app, module) |
| Cylinder | A database or store |
| Arrow | A call or a data flow (direction rarely defined as one or the other) |
| Dashed line | Async, optional, or a boundary — three incompatible meanings |
| Stick figure / avatar | A person |
| Cloud shape | The internet, or "something we don't own" |
| Dotted rounded box around a group | A boundary of some sort |
| Colour | Something important that is **not** written down (per ECSA: 81% coloured, meaning seldom defined) |

Its strength is zero learning cost. Its weakness is exactly the ECSA finding: the two channels
carrying the most meaning — colour and line style — are the two the author never defines.

### 10.3 Why no standard notation took hold

Eight structural reasons, roughly in order of force:

1. **No forcing function.** Notations standardise when a *machine* consumes them and rejects
   malformed input. Code has compilers; schemas have DDL; APIs have OpenAPI validators; BPMN has
   execution engines; SysML has contractual deliverables in defence. Architecture diagrams have no
   consumer that fails the build. Nothing punishes deviation, so deviation is free.
2. **The purpose is communication, not specification.** A diagram's job is shared understanding
   across a mixed audience — PM, security reviewer, SRE, new hire. That rewards tuning the picture
   to the room, which is the opposite of conforming to a spec.
3. **The subject matter outruns any fixed vocabulary.** UML's 14 diagram types have no symbol for
   a Kafka topic, a CDN, a feature flag, a vector store, or an LLM endpoint. Any standardised
   element set lags the technology it describes by years, so practitioners extend it informally —
   permanently.
4. **The cost/benefit is an externality.** Learning ArchiMate costs weeks; five boxes on a
   whiteboard costs thirty seconds and unblocks the meeting. The cost of the resulting ambiguity is
   deferred and paid by a *different person* six months later. Individually rational, collectively
   bad — the classic shape of a coordination failure.
5. **Precision that requires training reduces reach.** Formal notations optimise for the specialist
   reader. Architecture diagrams are mostly read by non-specialists. A notation only a trained
   reader can decode has negative value in the room where the diagram is actually used.
6. **UML's own history poisoned the well.** It was large, weakly defaulted, tied to heavyweight
   process (RUP), poorly served by tooling, and its killer app — round-trip code generation from
   models — never materialised. Without that payoff, the learning cost bought nothing mechanical.
7. **Diagrams are treated as disposable.** ECSA found >92% of views have a single contributor:
   these are individual artifacts, not collaboratively maintained assets. You standardise things
   many people must edit; you don't standardise a sketch.
8. **Several standards bodies, none owning the problem.** OMG (UML, SysML, BPMN), The Open Group
   (ArchiMate, TOGAF), ISO/IEC/IEEE (42010), plus three mutually incompatible cloud-vendor icon
   dialects. Several overlapping standards is functionally equivalent to none — the practitioner
   still has to choose, and choosing is the cost they were avoiding.

### 10.4 What is converging instead

Not a notation — **conventions and a delivery mechanism**:

- **C4's labelling discipline** (name + type + purpose on every box, one abstraction level per
  diagram, mandatory legend) spreads because it is additive: it costs nothing and works on top of
  whatever shapes you already draw.
- **Cloud vendor icon sets** are the closest thing to a de facto element standard for
  infrastructure, precisely because the vendor supplies the artwork for free and the icons are
  self-documenting.
- **Diagrams-as-code** (Mermaid especially, because GitHub renders it with no build step) is
  standardising the *pipeline* — version control, review, CI rendering — while leaving the notation
  free. This is the one place a forcing function is appearing: a parser that rejects invalid input.

### 10.5 What this means for a diagramming product

Direct consequence for us: the 96%/4% split is the market. A tool that only serves formal
notations is addressing the 4%. Our `Graph` (DrawIO) macro serves the folk notation and is
therefore aimed at where the volume is; `PlantUML` serves the formal minority; `Mermaid` sits in
the converging middle (text-based, low ceremony, renders anywhere). The unserved opportunity is
not "add ArchiMate" — it is **helping the folk notation be less ambiguous**: prompting for a
legend, making colour semantics explicit, labelling arrows with sync/async. That is a product
question, not a research finding, and would need usage data to justify.

---

## Sources

- [ISO/IEC/IEEE 42010:2022 — Software, systems and enterprise — Architecture description](https://www.iso.org/standard/74393.html) · [arc42 quality model summary](https://quality.arc42.org/standards/iso-42010)
- [C4 model — c4model.com](https://c4model.com/) · [The C4 Model: Visualizing Software Architecture (O'Reilly)](https://www.oreilly.com/library/view/the-c4-model/9798341660113/)
- [arc42 template overview](https://arc42.org/overview/) · [§5 Building block view](https://docs.arc42.org/section-5/) · [§6 Runtime view](https://docs.arc42.org/section-6/) · [§7 Deployment view](https://docs.arc42.org/section-7/)
- [Kruchten, "Architectural Blueprints — The 4+1 View Model of Software Architecture" (PDF)](https://www.cs.ubc.ca/~gregor/teaching/papers/4+1view-architecture.pdf) · [Wikipedia summary](https://en.wikipedia.org/wiki/4%2B1_architectural_view_model)
- [SEI — Creating and Using Software Architecture Documentation (Views and Beyond)](https://www.sei.cmu.edu/documents/2057/2004_004_001_14351.pdf) · [Viewtypes and styles](https://flylib.com/books/en/2.121.1/p5_viewtypes_and_styles.html)
- [ArchiMate 3.2 Specification (The Open Group)](https://pubs.opengroup.org/architecture/archimate32-doc/) · [Example viewpoints](https://pubs.opengroup.org/architecture/archimate32-doc/ch-Example-Viewpoints.html) · [Application Layer](https://pubs.opengroup.org/architecture/archimate32-doc/ch-Application-Layer.html) · [Technology Layer](https://pubs.opengroup.org/architecture/archimate3-doc/ch-Technology-Layer.html) · [What changed in 3.2](https://goodelearning.com/articles/whats-changed-in-archimate-3-2/) — note: pubs.opengroup.org now sits behind an SSO redirect, so the layer chapters could not be fetched directly for this note
- [OMG — final adoption of SysML v2, KerML 1.0, Systems Modeling API 1.0 (2025-07-21)](https://www.omg.org/news/releases/pr2025/07-21-25.htm) · [SysML v2 release repo](https://github.com/Systems-Modeling/SysML-v2-Release)
- [TOGAF ADM and Architecture Content Framework](https://www.visual-paradigm.com/guide/togaf/togaf-adm-and-architecture-content-framework/) · [TOGAF viewpoints — catalogs, matrices, diagrams](https://meta.linked.archi/togaf/viewpoints/)
- [Zachman Framework — CIO overview](https://www.cio.com/article/193229/what-is-the-zachman-framework-a-matrix-for-managing-enterprise-architecture.html) · [Zachman International](https://zachman-feac.com/zachman/about-the-zachman-framework)
- [OMG — Unified Architecture Framework](https://www.omg.org/uaf/) · [UAF Wiki](https://www.omgwiki.org/uaf/) · [UAF overview, The Aerospace Corporation](https://aerospace.org/story/unified-architecture-framework-uaf)
- [Microsoft — Uncover Security Design Flaws Using the STRIDE Approach](https://learn.microsoft.com/en-us/archive/msdn-magazine/2006/november/uncover-security-design-flaws-using-the-stride-approach) · [OWASP Threat Modeling Process](https://owasp.org/www-community/Threat_Modeling_Process) · [PFD vs DFD (ThreatModeler)](https://threatmodeler.com/resource/white-papers/process-flow-diagrams-vs-data-flow-diagrams/)
- [EventStorming (Avanscoperta)](https://www.avanscoperta.it/en/eventstorming/) · [Domain Storytelling (InformIT)](https://www.informit.com/store/domain-storytelling-a-collaborative-visual-and-agile-9780137458912) · [Collaborative modelling overview](https://www.avanscoperta.it/en/collaborative-modelling/)
- [Azure architecture icons (Microsoft Learn)](https://learn.microsoft.com/azure/architecture/icons) · [Cloud provider icon set roundup](https://revision.app/blog/top-icon-resources-for-diagrams)
- [Diagram-as-code tool comparison 2026](https://infrasketch.net/blog/best-diagram-as-code-tools-2026)
- Notation-in-practice evidence: [Migliorini et al., *Architectural Views: The State of Practice in Open-Source Software Projects*, ECSA 2024](https://link.springer.com/chapter/10.1007/978-3-031-70797-1_27) ([PDF](https://robertoverdecchia.github.io/papers/ECSA_2024.pdf)) · [Petre, *UML in practice*, ICSE 2013 (PDF)](https://oro.open.ac.uk/35805/8/UML%20in%20practice%208.pdf) · [Ozkaya, *Do the informal & formal software modeling notations satisfy practitioners for software architecture modeling?*, Information and Software Technology](https://www.sciencedirect.com/science/article/abs/pii/S0950584917304834) · [*How are informal diagrams used in software engineering? An exploratory study of open-source and industrial practices*, SoSyM 2024](https://link.springer.com/article/10.1007/s10270-024-01252-3)
