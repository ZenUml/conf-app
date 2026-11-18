# Current-code migration provenance

Imported from the independent `pi-diagram-agent` prototype at source Git HEAD `23d6906555f008031407b5c0debd180c405fd96c` (2026-10-02). This is a snapshot of the supported agent-led entry point and its dependency closure, rather than a historical Git import. The source repository and private evidence remain separate.

This includes the synthetic fixture correction committed as `23d6906` after base `442ebc4`: the Chromium test writes a self-contained SVG instead of relying on a historical output artifact. The supported source modules and pinned rules are unchanged from that base.

Supported entry point: `pi-extension.ts`, which provides `/magic` and `diagram_inspect`. Dependencies: `src/agent-led.mjs`, `src/original-render.mjs`, `src/agent-render.mjs`, `src/agent-audit.mjs`, `src/parser.mjs`, and the dynamically imported `src/rules-profile.mjs` sizing contract. Tests cover task preparation, exact source/rules binding, resume behavior, browser evidence, and independent semantic and geometry checks.

The old deterministic layout and CLI fallback, generated diagrams, screenshots, private customer sources, and historical evidence documents are excluded.

The canonical rules are pinned to SHA-256 `e444fde4612ccc4f1d6a386af6c6c3c259fceda20b962b51898debe6be731f92`. A source-declared group conflict with the actual rendered original remains a semantic failure; preserving original visible grouping does not erase that conflict.

Remaining quality work: independently prove all applicable rules, perform comparative image review, repair unresolved defects, and define certification before publishing a validated Magic artifact. The two private historical candidates remain UNCERTIFIED.

Local policy update (2026-10-05): independent group-border and sibling-overlap checks, continuous multi-bend shared suffixes, early-merge advice, visible-crossing deduplication, traversable group headings, suffix-preserving route witnesses, caller-controlled presentation, and profile-backed peer sizing. Synthetic tests cover both allowed geometry and rejected defects; historical candidates are not certified by this rule update.

## Conf-app bundled runtime (2026-11-15)

The current snapshot was recovered from conf-app parked commit `f0607412f` (`park/pi-semantic-layout-contract-2026-10-10`), restricted to `tools/pi-diagram-agent/**`; the older independent prototype provenance above remains historical. This import includes the source dependency closure, Python standard-library drawing kit, pinned rules, synthetic fixtures, tests and benchmark harness. No generated candidates or private customer sources were imported. Runtime dependency versions are exact and recorded in the package-local `pnpm-lock.yaml`. Personal browser/cache paths and global Pi SDK paths were replaced with local installed package resolution. The Type schema import follows the pinned Pi 1.5.2 API (`typebox`). The pinned rules bytes/hash are unchanged.

`cli.mjs --help` and `cli.mjs doctor` never call a model. `refine` requires an explicit model, uses the installed Pi RPC CLI, fixes provider to `openai-codex`, and sets author/reviewer/judge to that selected model. Existing Pi subscription OAuth is required; authentication is a separate user action. `quality.json` explicitly reports incomplete versus reviewed candidate; it never claims human acceptance or certification.

Font portability correction (2026-11-15): Linux CI exposed system-UI font fallback widths that exceeded the original macOS glyph estimates. The kit and spec renderer now request Arial, retain prior conservative per-glyph bounds and raise individual bounds only where actual Arial probes require it (sizes 12-28, repeated 1/2/6). The spec renderer no longer discounts those bounds for font selection. A narrow-box browser regression proves the selected font fits and the next whole size does not. Auditor thresholds and pinned normative rules remain unchanged. The earlier live model smoke remains evidence for commit `b7b03755`; this typography change is verified separately with browser measurements and CI.

Linux glyph bound follow-up: CI run `43657020581` measured Arial-compatible fallback glyphs `?`, `K`, `Y` and `a` slightly wider than the macOS Arial probes. Only these four per-glyph bounds were raised to the next 0.01em covering the observed Linux widths. A regression records all seven failing Linux text/size/width observations and checks both estimators, alongside the live browser glyph watchdog. Font preflight reports unsupported metrics rather than assuming a font is absent.
