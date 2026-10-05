# Current-code migration provenance

Imported from the independent `pi-diagram-agent` prototype at source Git HEAD `23d6906555f008031407b5c0debd180c405fd96c` (2026-10-02). This is a snapshot of the supported agent-led entry point and its dependency closure, rather than a historical Git import. The source repository and private evidence remain separate.

This includes the synthetic fixture correction committed as `23d6906` after base `442ebc4`: the Chromium test writes a self-contained SVG instead of relying on a historical output artifact. The supported source modules and pinned rules are unchanged from that base.

Supported entry point: `pi-extension.ts`, which provides `/magic` and `diagram_inspect`. Dependencies: `src/agent-led.mjs`, `src/original-render.mjs`, `src/agent-render.mjs`, `src/agent-audit.mjs`, `src/parser.mjs`, and the dynamically imported `src/rules-profile.mjs` sizing contract. Tests cover task preparation, exact source/rules binding, resume behavior, browser evidence, and independent semantic and geometry checks.

The old deterministic layout and CLI fallback, generated diagrams, screenshots, private customer sources, and historical evidence documents are excluded.

The canonical rules are pinned to SHA-256 `e444fde4612ccc4f1d6a386af6c6c3c259fceda20b962b51898debe6be731f92`. A source-declared group conflict with the actual rendered original remains a semantic failure; preserving original visible grouping does not erase that conflict.

Remaining quality work: independently prove all applicable rules, perform comparative image review, repair unresolved defects, and define certification before publishing a validated Magic artifact. The two private historical candidates remain UNCERTIFIED.

Local policy update (2026-10-05): independent group-border and sibling-overlap checks, continuous multi-bend shared suffixes, early-merge advice, visible-crossing deduplication, traversable group headings, suffix-preserving route witnesses, caller-controlled presentation, and profile-backed peer sizing. Synthetic tests cover both allowed geometry and rejected defects; historical candidates are not certified by this rule update.
