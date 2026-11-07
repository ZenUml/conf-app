# Bun test compatibility

The optional Bun test commands are validated with Bun 1.4.4, Node 24.20.0,
and the repository's frozen pnpm dependency tree. They do not change the
default Node CI runtime or replace pnpm as the package manager.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --dir tests/e2e-tests install --frozen-lockfile --ignore-scripts --ignore-workspace
bun --version
pnpm test:unit:bun
pnpm test:ci:bun
```

`test:unit:bun` runs the existing Vitest runner under Bun. `bun test` uses
Bun's own runner, so it is used only for the separate CI script tests.

## Vitest module mocks

Vitest 2.1.9 locates the caller of `vi.mock()` by parsing an error stack.
Bun prints a method frame as `at mock (...)`, while the existing parser
expects `at Object.mock (...)`. A missed frame makes relative module mocks
resolve from the project root instead of the calling test file.

The pnpm patch accepts the bare method name only when the frame comes from
the same Vitest implementation chunk. Existing Node stack handling stays
first. The nested-module regression test exercises the failure directly.

Upstream references: [Bun #43685](https://github.com/oven-sh/bun/issues/43685)
and [Bun PR #43695](https://github.com/oven-sh/bun/pull/43695). Recheck the
regression without this patch when Bun ships the upstream fix.

The survey-timer component test supplies its own complete Forge identity.
Without an account ID, its vote cannot persist and a later async initialization
can clear the fixture's vote. Explicit context setup and restoration make the
existing assertions independent of a preceding test's cached identity.

## CI script tests

The fixtures expose the selected runtime as `node` through a private
launcher. When tests run under Bun, that launcher executes Bun; it does not
fall back to Node. Inline module programs use an explicit stdin marker.

The Mermaid test gate consumes the standard `node:test` event stream
instead of importing `node:test/reporters`, which Bun does not implement.
Its real child-process regressions verify that a passing test succeeds and
that a failed or skipped test fails the gate. Parser integration tests have
a bounded timeout that covers their two existing subprocess timeouts.

These changes affect test tooling and CI command compatibility. They do not
change Confluence application UI; Storybook, Forge Tunnel and deployed
staging UI validation are not applicable to this change.
