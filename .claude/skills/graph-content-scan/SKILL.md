---
name: graph-content-scan
description: >
  Decode Graph (DrawIO) macro content from the D1 CustomContent mirror and count cells, image sources
  by host (img/lib, icons.diagrams.net, other external, data:), stencil families and math. Use to
  check what a customer's graph diagram loads before blaming CSP, icons or capture failures, or to
  sample many graph macros. Triggers on "what icons does this diagram use", "scan graph content",
  "decode graphXml", "does this macro have external images", "看看这个图里有哪些图标".
---

# Graph content scan

Read-only. One script, `scripts/scan.mjs`, run with plain `node` from any worktree.

```bash
S=.claude/skills/graph-content-scan/scripts/scan.mjs
node $S --macro-uuids <uuid>,<uuid>          # query D1 by macro UUID (Mixpanel macro_uuid)
node $S --content-ids <id>,<id>              # query D1 by Confluence custom content id
node $S --file d1.json                       # reuse saved `wrangler d1 execute --json` output
# options: --json   --list-images out.json   --save-d1 out.json
```

Example line:

```
<contentId> macro=<uuid> v5 current type=graph compressed=false pages=1 cells=283 images=80 {"img/lib":75,"icons.diagrams.net":3,"data:":2} math=false
  stencils {"kubernetes":26,"cisco_safe":1,"webicons":1}
  img/lib {"azure2":73,"mscae":2}
```

## What the script handles for you

| Layer | Shape | Handling |
|---|---|---|
| D1 `CustomContent.body` | Confluence wrapper `{"raw":{"representation":"raw","value":"<diagram JSON>"}}` | unwrap `raw.value` |
| diagram JSON | `{diagramType:"graph", graphXml, compressed?}` | other types print `SKIPPED` |
| `compressed: true` | `graphXml` is **lzutf8 Base64**, not deflate | `lzutf8.decompress(x, {inputEncoding:'Base64'})` |
| `<diagram>` body not starting with `<` | DrawIO's own page compression: base64 → inflateRaw → decodeURIComponent | expanded per page |
| styles | XML-escaped `image=...;` and `shape=mxgraph.<family>.…` | unescaped, then counted |

- D1 access: runs `npx wrangler d1 execute conf-zenuml-prod --remote --env production --json` in the **main checkout** (found with `git rev-parse --git-common-dir`), with `CLOUDFLARE_ACCOUNT_ID` from its `.env`.
- lzutf8 comes from the main checkout's `node_modules`; if the top-level symlink is broken it falls back to `node_modules/.pnpm/lzutf8@*/`.
- The script ends with `process.exit()`: lzutf8 leaves timers that kept node alive for minutes after printing.

## Reading the result

- `img/lib` icons are bundled under `public/drawio/img/lib/`; they render only if the viewer resolves them against our own `drawio/` base, not `app.diagrams.net`.
- `icons.diagrams.net` and any `external:<host>` are outside the Forge CSP allowlist unless the manifest says otherwise; they fail in the viewer and in PNG capture.
- `data:` images are embedded and need no network.
- `math=true` means MathJax must load before capture (`graph_math_not_ready`).

## Limits

- D1 is a **mirror**, not the system of record. Confluence holds the real body; sync can fail or lag, and rows with a NULL `cloudId` exist. A missing row is not proof the diagram does not exist; a stale row may differ from what the user sees.
- The scan counts style references. It does not prove an image loads; for that, open the page or read a replay ([replay-forensics](../replay-forensics/SKILL.md)).
- Content ids and macro UUIDs are customer data: keep outputs in the scratchpad or `private/`, never in public files.

Related: [png-capture-triage](../png-capture-triage/SKILL.md), [graph-macro](../graph-macro/SKILL.md).
