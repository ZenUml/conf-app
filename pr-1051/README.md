# PR #1051: Bun compatibility evidence

Candidate: [`d3910aa9c96654351adbac1baaa62e4cce08dbc1`](https://github.com/ZenUml/conf-app/commit/d3910aa9c96654351adbac1baaa62e4cce08dbc1). Baseline: [`fadc1009fd3e9ea5d7aad20337e980cbedd9a34a`](https://github.com/ZenUml/conf-app/commit/fadc1009fd3e9ea5d7aad20337e980cbedd9a34a). This package provides selected diagnostics and summaries, plus full successful CI-script and browser-runner logs. Large unit-test logs are deliberately not included.

## Platforms and provenance

- Original benchmark: isolated Linux x86_64 GCP e2-standard-4, Intel Broadwell, Ubuntu 24.04. Its failures below are inherited benchmark evidence, **not candidate Linux results**.
- Local reproduction: macOS arm64. Separate committed candidate validation also completed on Ubuntu 24.04 x86_64. Tool versions: Node 24.20.0, Bun 1.4.4 (`38afee6c8`), pnpm 10.34.5, Vitest 2.1.9, Vite 7.3.0, Playwright 1.59.1, Chromium 147.0.7727.15 / Playwright build 1217.
- Unit and CI/browser checks executed while candidate runtime/test contents were still uncommitted; those contents match the candidate commit. The eight CI file hashes were independently checked against candidate git objects. The Full build ran after commit creation and prints `d3910aa9`.
- Exit codes are observed process results, not inferred from log text. [Local verification metadata](local-verification.json) records parent-observed unit/lint/build results; CI/browser exit results were independently captured by the worker. [Machine-readable results](results.json) gives counts, provenance, and artifact hashes.

## Before and after

| Platform / source | Check | Outcome |
|---|---|---|
| Original Linux baseline, inherited | Bun full Vitest | 5,801 passed; 258 failed; 3 existing skips |
| Original Linux baseline, inherited | Bun CI script tests | 105 passed; 13 failed |
| Same macOS, before Vitest patch | New nested relative-mock regression | 1 failed: missing `mockResolvedValue` API |
| Same macOS, before Vitest patch | Two existing test files | 1 passed; 87 failed |
| Same macOS, after Vitest patch | Those files plus new regression | 89 passed; no failures or skips |
| macOS candidate | Node full Vitest | 6,060 passed; 3 existing skips; no failures |
| macOS candidate | Bun full Vitest | 6,060 passed; 3 existing skips; no failures |
| macOS candidate | Node CI script tests | 121 passed; no failures or skips |
| macOS candidate | Bun CI script tests | 121 passed; no failures or skips |
| macOS candidate | Real Chromium Mermaid runner, Node | 22 passed; no failures or skips |
| macOS candidate | Real Chromium Mermaid runner, Bun | 22 passed; no failures or skips |
| macOS baseline and candidate | Lint | Both exit 0, both 0 errors / 138 warnings |
| macOS committed candidate | Node Full frontend + MCP Apps build | Both build stages completed; command exit 0 |
| Linux committed candidate | Node full Vitest | 6,060 passed; 3 existing skips; no failures |
| Linux committed candidate | Bun full Vitest | 6,060 passed; 3 existing skips; no failures |
| Linux committed candidate | Node CI script tests | 121 passed; no failures or skips |
| Linux committed candidate | Bun CI script tests | 121 passed; no failures or skips |
| Linux committed candidate | Real Chromium Mermaid runner, Node | 22 passed; no failures or skips |
| Linux committed candidate | Real Chromium Mermaid runner, Bun | 22 passed; no failures or skips |

The new regression was run before and after the dependency fix on the same machine. Its red run includes the added synthetic test fixture; it is not an untouched baseline checkout. The full candidate suite adds one unit regression, explaining 6,060 passed versus the baseline's 6,059. CI script coverage retains all 118 existing tests and adds three actual reporter pass/fail/skip regressions. A skipped child must make the reporter gate fail; no assertion was skipped to obtain these green CI results.

The original Linux and candidate macOS totals are **not a same-machine comparison**. On macOS, the original CI suite reproduced 11 of the 13 original Linux failures; the Linux parser timeout pair did not reproduce on the faster local run. The parser now has a bounded timeout appropriate for its two existing 30-second child-process limits. The exact committed candidate subsequently passed all six checks on Linux as well. These are correctness checks, not repeated performance measurements: no speed or memory improvement is claimed; timings retained in full logs are observations only.

## Reproduce candidate validation

Use the pinned tool versions above and the candidate commit. `bun` below means the verified Bun 1.4.4 binary.

```sh
pnpm install --frozen-lockfile --ignore-scripts
(cd tests/e2e-tests && pnpm install --frozen-lockfile --ignore-scripts --ignore-workspace)

CI=true VITE_APP_VERSION=benchmark NODE_OPTIONS=--max-old-space-size=8192 node node_modules/vitest/vitest.mjs --run --maxWorkers=3 --minWorkers=1
CI=true VITE_APP_VERSION=benchmark NODE_OPTIONS=--max-old-space-size=8192 bun node_modules/vitest/vitest.mjs --run --maxWorkers=3 --minWorkers=1

node --test scripts/ci/*.node-test.mjs scripts/test-selection/tests/*.node-test.mjs
bun test ./scripts/ci/*.node-test.mjs ./scripts/test-selection/tests/*.node-test.mjs

pnpm exec playwright install chromium
CI=true node scripts/ci/mermaid-highlights.mjs
CI=true bun scripts/ci/mermaid-highlights.mjs

pnpm lint
CI=true VITE_APP_VERSION=benchmark NODE_OPTIONS=--max-old-space-size=8192 pnpm build:full
```

The browser runner executes real Mermaid rendering and export assertions in local Chromium pages. It does not visit Confluence or external application services. Both runtime checks assert zero skipped tests. Node remains installed for tools that explicitly launch it; these checks do not establish that every dependency or deployment tool can replace Node.

## Verified Linux candidate artifacts and final GitHub CI

All six checks passed at exact committed candidate `d3910aa9` on Ubuntu 24.04 x86_64. The downloaded raw bundle's SHA-256 was independently verified as `5b1baec943dacd9977dd2a26900cc7ec2cc15f6bb96b0711fa168e81dbf4856b`; the source record identifies the candidate SHA. The original bundle contains 42 verified raw files. This public package includes selected unit summaries and full positive CI/browser logs, not server environment or VM records.

[Sanitized Linux summary](linux-summary.json) records all six observed exit codes and exact counts. Unit summary excerpts on both platforms carry separately labelled metadata headers with runtime, source, command, and exit provenance. Linux unit commands use `--maxWorkers=3`; macOS commands additionally use `--minWorkers=1`. CI retains 118 original tests plus three real reporter regressions; units retain the baseline coverage and three pre-existing skips, adding one nested-mock regression.

All three GitHub workflows were independently verified through read-only `gh run view` as completed/success at the exact candidate SHA:

- [PR validation](https://github.com/ZenUml/conf-app/actions/runs/41983502346)
- [Export modal validation](https://github.com/ZenUml/conf-app/actions/runs/41983502449)
- [Render MCP Worker](https://github.com/ZenUml/conf-app/actions/runs/41983502310)

[Verification metadata](github-ci.json) records the workflow results and source SHA. Application UI is unchanged; Storybook → Forge Tunnel → staging UI validation is not applicable to these runtime/test-tooling changes. Local browser-runner success does not establish deployed application or Confluence UI behavior.

## Privacy review

Local user, repository, evidence, and temporary paths were replaced with placeholders such as `<repo>` and `<evidence>`. Included full positive CI/browser logs contain no customer hostnames, email addresses, or UUIDs. GitHub URLs and public source SHAs appear only in provenance metadata. Linux server hostname, IP, user-account records, environment dumps, VM configuration, cleanup, and billing metadata were not copied. Other logs are selected synthetic-fixture diagnostics or summary excerpts. No real customer identifiers, credentials, tokens, private investigation files, or noisy full unit logs are included. ANSI control formatting was removed. Nothing was posted or published while preparing this package. [SHA256SUMS](SHA256SUMS) covers every included file except itself.
