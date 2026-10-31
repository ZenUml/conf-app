# Evidence for ZenUml/conf-app#1030

- **BEFORE:** `c2f0796930a875c925e3436293cb698b335db69f` (merge-base with `main`)
- **AFTER:** `3ad07bc86823572ee29ceac40c3087b3f89ddf41` (PR head)
- **Environment:** the remote agent container, Node 22, vitest from the repo's lockfile. No live Confluence or MCP host is involved; every check runs the server code in-process.

## 1. Tests: the PR's new tests against both versions

The three changed spec files were copied from AFTER onto a BEFORE worktree and run there, then run on AFTER:

```
npx vitest run functions/agent-link/oauth/headlessWrite.spec.ts \
  functions/agent-link/oauth/headlessMcp.spec.ts functions/agent-link/renderMcp.spec.ts
```

| | BEFORE | AFTER |
|---|---|---|
| Result | 4 failed, 114 passed ([log](tests-before.log)) | 118 passed ([log](tests-after.log)) |

The four that fail on BEFORE are the new ones, each for the reason this PR fixes:

- `keeps every tool and parameter description about that tool alone`: "list_diagrams mentions list_sites".
- `keeps the tool description to the tool itself…` (render): the description matches `dsl-guide`.
- `update_diagram › returns the updated diagram in the shape the view draws`: `extractDiagram` returns `null`, which the view shows as "No diagram in this result."
- `create_diagram › returns the new diagram in the shape the view draws`: `extractDiagram` returns `null`.

## 2. Probe: which other tools each description names

[`probe.spec.ts`](probe.spec.ts) reads `HEADLESS_TOOLS` and `RENDER_TOOL` and lists the other tool names, or a dsl-guide pointer, found in each tool's description and input schema. Raw output: [before](descriptions-before.json), [after](descriptions-after.json).

| Tool | BEFORE mentions | AFTER mentions |
|---|---|---|
| list_sites | none (but said "Start here") | none |
| list_diagrams | list_sites, read_diagram | none |
| read_diagram | list_sites, list_diagrams, update_diagram | none |
| read_page | list_sites | none |
| create_page | list_sites | none |
| update_page | list_sites, read_page | none |
| get_status | none | none |
| update_diagram | list_sites, list_diagrams | none |
| create_diagram | list_sites | none |
| render_diagram | dsl-guide resource | none |

## Limitations

- **Not checked in a real host.** The fix to the view under `update_diagram` and `create_diagram` is proven against the view's own `extractDiagram` in unit tests, not yet in claude.ai. That needs this change deployed to `conf-stg-lite` (PR validation) and a run through a custom connector.
- **Fixture data.** All Confluence responses are the specs' fictional fixtures.
