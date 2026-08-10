# core-bench

Compare two `@zenuml/core` versions head-to-head on a corpus of real diagrams:
**render performance**, **output parity**, and **parser compatibility**.

Built to answer "does upgrading the renderer actually help, and is it safe?"
without deploying anything. `render_ms` is pure local parse + render with zero
network, so this needs no Confluence, no Forge, and no staging.

## Setup

```bash
cd tools/perf/core-bench
npm install          # installs the versions aliased in package.json
npm run serve        # vite on :5599 — leave running
```

To compare different versions, edit the `core-old` / `core-new` / `core-v4`
aliases in `package.json` and re-install.

## Corpus

By default the harness uses `diagrams.sample.json` (3 synthetic diagrams) so a
fresh clone runs out of the box. For a realistic signal, pull production
diagrams:

```bash
node fetch-corpus.mjs 100     # writes diagrams.json
```

> **`diagrams.json` is customer content and is gitignored. Never commit it, and
> never paste diagram bodies into issues or PRs** — see
> [docs/policies/client-privacy.md](../../../docs/policies/client-privacy.md).
> Report findings as counts and shapes, not verbatim source.

## The three checks

Run each from the **repo root** (they import `@playwright/test`, which resolves
there, not from this directory):

### 1. Render performance

```bash
REPS=7 N=16 node tools/perf/core-bench/run-bench.mjs
```

Renders the corpus under each version, `serial` (one at a time — the per-diagram
cost) and `concurrent` (all at once — approximates N macros mounting together on
one page). Fresh browser context per rep, so no module-cache or JIT carryover.
Prints medians plus the per-rep spread — check the spread before believing a
delta.

### 2. Output parity

```bash
node tools/perf/core-bench/diff-output.mjs
```

Renders every diagram under both versions and compares the serialized DOM.
Reports byte-identical count, diagrams whose HTML differs, anything that threw
on only one version, and parser errors unique to one version.

**A vanished parser error is not a fixed render.** If a diagram diverges, look at
what actually changed before claiming an improvement — diff the DOM, screenshot
both. (This harness was built during an upgrade where "the error went away" was
initially misread as "the diagram got fixed"; it had not.)

### 3. Parser compatibility

```bash
node tools/perf/core-bench/compat-check.mjs
```

Runs the hand-written edge cases in `cases.json` (PlantUML wrapper directives,
block/hash/quote comments, …) and reports parser errors per version. Add a case
here whenever a syntax-handling difference shows up.

## Interpreting concurrency numbers

`concurrent` mode runs N renders as N promises on **one** main thread. Real Forge
macros each get their own iframe (and often their own renderer process), so the
contention shape differs. Treat concurrent numbers as indicative of direction,
not as a model of the real page. The `serial` per-diagram figure is what maps
cleanly onto the `render_ms` analytics property.
