---
name: extract-itxt
description: Extract iTXt chunks from a local PNG file — specifically the zenumlDiagram chunk that embeds diagram source and type. Use after download-attachment, or directly against any PNG in ~/Downloads or /tmp. Triggers on "extract iTXt", "read iTXt", "what's in the PNG", "check the attachment text content", "read the embedded source", or any time a zenuml-*.png is on disk and you need to verify what diagram data is inside.
---

# Extract iTXt from a PNG

Reads a local PNG file, finds all `iTXt` chunks, and prints their keyword + decoded text.
Handles both uncompressed and zlib-compressed payloads.

## Usage

```bash
# Plain PNG file (most common — after download-attachment)
node .claude/skills/extract-itxt/scripts/extract.mjs /tmp/recovered.png

# Session tool-result file (Playwright saved base64 PNG data)
node .claude/skills/extract-itxt/scripts/extract.mjs \
  --tool-result /path/to/mcp-playwright-browser_run_code_unsafe-*.txt

# Raw base64 string
node .claude/skills/extract-itxt/scripts/extract.mjs --b64 <base64>

# Filter to one keyword (e.g. zenumlDiagram)
node .claude/skills/extract-itxt/scripts/extract.mjs /tmp/recovered.png \
  --keyword zenumlDiagram

# Machine-readable output
node .claude/skills/extract-itxt/scripts/extract.mjs /tmp/recovered.png --json
```

## Output

Default (human-readable):

```
keyword: zenumlDiagram
compressed: false
text: {"diagramType":"mermaid","source":"sequenceDiagram\n    Alice->>John: …"}
  diagramType: mermaid
  source: sequenceDiagram
    Alice->>John: Hello John, how are you?
    …
```

`--json` emits a JSON array — one object per iTXt chunk:

```json
[
  {
    "keyword": "zenumlDiagram",
    "compressed": false,
    "text": "{\"diagramType\":\"mermaid\",\"source\":\"…\"}"
  }
]
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | At least one iTXt chunk found (and printed) |
| 1 | Not a PNG, no iTXt chunk present, or malformed chunk |

## What `zenumlDiagram` contains

The app writes a single `zenumlDiagram` iTXt chunk into every exported PNG
(feature added in the `feat/png-embedding` branch, released ~2026-05-27).
The text is a UTF-8 JSON object:

```json
{ "diagramType": "<mermaid|sequence|plantuml|graph|openapi>", "source": "<raw DSL text>" }
```

The attachment's `comment` field will contain `<hash>|<diagramType>|itxt:v1` when embedding
succeeded. If the comment ends with just `<hash>|<diagramType>` (no `itxt:v1`), the PNG was
created before this feature shipped or `toPng()` returned before the injection ran — the
iTXt chunk will be absent.

## Common workflow

```bash
# 1. Find the attachment filename
node .claude/skills/find-macros-on-page/scripts/find.mjs --site zenuml --page 2793308335

# 2. Download it
node .claude/skills/download-attachment/scripts/download.mjs \
  --site zenuml --page 2793308335 --filename zenuml-2794848388.png --out /tmp/recovered.png

# 3. Extract iTXt
node .claude/skills/extract-itxt/scripts/extract.mjs /tmp/recovered.png
```

## Related skills

- `download-attachment` — gets the PNG onto disk
- `find-macros-on-page` — reveals the attachment filename and `customContentId`
