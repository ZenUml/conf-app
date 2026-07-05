---
name: find-macros-on-page
description: List ZenUML (and other) macros on any Confluence page in render order, with their customContentId, type, title, and ADF localId — and fetch a chosen macro's stored body (DrawIO XML / Mermaid / PlantUML / ZenUML DSL / OpenAPI). Two operations, one skill. Use whenever investigating a customer page, locating which macro to inspect/reproduce, correlating "the third diagram on page X" to a specific customContentId, or extracting a stored macro source for rebuild. Triggers on "what macros are on this page", "find the macro at <URL>", "fetch the macro source", "extract macro XML", "rebuild this customer's macro", or any starting step of a customer-page investigation.
---

# Find Macros on Page

Two atomic operations against the Confluence v2 REST API, both available as a browser snippet (universal) or a Node CLI (our tenants):

| Step | What | Output |
|---|---|---|
| 1. **list** | Walk the page ADF, join with `/custom-content` listing. | Per-extension row: pos, moduleKey, customContentId, title, localId. |
| 2. **fetch** | Pull one customContent body, parse the JSON wrapper. | `{ diagramType, graphXml \| code \| spec, ... }`. |

Use **list** to identify which macro to inspect, then **fetch** to get its source.

## Why this exists

Locating + extracting a macro on a customer page used to mean ~10 fragile tool calls: visual scrolling, iframe DOM inspection, decoding the `_ctx_` payload (red herring), listing custom-content, picking the right one by visually correlating IDs, then fighting the claude-in-chrome proxy filter and clipboard-hopping to actually get the bytes out. This skill collapses both halves to two REST calls each.

## Two recipes — pick by tenant

| Recipe | When | Auth |
|---|---|---|
| **A. Browser snippet** (default) | Any tenant the user can view in their browser, including customer sites where they're a guest. | Page cookies — no token needed. |
| **B. Node CLI** | Our tenants (`lite-dev`, `lite-stg`, `zenuml-stg`, `zenuml`). | API token in `.env.forge.local`. |

Try A first when access is uncertain. Fall back to B for piping into bash workflows on our own tenants.

### Why Recipe A works on customer tenants

Atlassian returns `404 NOT_FOUND` for permission-denied (it deliberately won't leak existence). An API token authenticates as the account that owns it (e.g. `support@zenuml.com`); customer pages typically aren't shared with that account. The user's **browser session** is their personal Atlassian identity, often a guest on customer tenants. Driving the v2 REST API from within that authenticated page context inherits the cookies, so the API behaves exactly as the browser does.

Confirmed end-to-end on a customer tenant where the API-token route 404'd.

---

## Recipe A — Browser snippets

### Prereqs

In Playwright MCP or claude-in-chrome, navigate the active tab to **any page on the target tenant**. The list snippet pulls the page id from `location.pathname`; the fetch snippet needs a specific customContentId you've already chosen.

### A1 — list

Read `.claude/skills/find-macros-on-page/scripts/snippet.js` and pass its body to `browser_evaluate` (Playwright MCP) or `javascript_tool` (claude-in-chrome). Returns `{ renderedCount, rendered, orphans, totalCC }`. `rendered` is in page document order; filter `moduleKey` matching `/^zenuml-.*-macro/` for just our macros.

### A2 — fetch

Read `.claude/skills/find-macros-on-page/scripts/fetch-source-snippet.js`. **Replace the `<CC_ID>` placeholder** with the customContentId you picked from A1, then pass to `browser_evaluate` / `javascript_tool`. Returns a summary; the full body is stashed on `window.__macroBody` (raw string) and `window.__macroBodyParsed` (parsed object).

#### Getting the bytes out

- **Via Playwright MCP**: no output filter. Just `browser_evaluate(() => window.__macroBody)` returns the full string. Done.
- **Via claude-in-chrome**: the proxy may block long base64-shaped output (`[BLOCKED: ...]`). Workaround: focus the tab and run `navigator.clipboard.writeText(window.__macroBody)`, then `pbpaste > /path/to/output.xml` on the host.

---

## Recipe B — Node CLIs

### One-time setup

```
# .env.forge.local
FORGE_EMAIL=<your-email>
FORGE_API_TOKEN=<token>
```

Token: https://id.atlassian.com/manage-profile/security/api-tokens.

### B1 — list

```bash
set -a; source .env.forge.local; set +a
node .claude/skills/find-macros-on-page/scripts/list.mjs \
  --site lite-dev --page 16941057
```

Output:

```
# Page 16941057 on lite-dev.atlassian.net
# 1 macro(s) in body, 0 other custom content

pos  module                       customContentId  title                                              localId
---  ---------------------------  ---------------  -------------------------------------------------  ------------------------------------
1    zenuml-graph-macro-lite      16973825         graph test content                                 ec16f5c5-df4f-47af-a6bd-13baad92b73b
```

| Flag | Notes |
|---|---|
| `--site` (required) | `lite-dev`, `lite-stg`, `zenuml-stg`, `zenuml`, or a hostname (`example-tenant-h` → `example-tenant-h.atlassian.net`). On unknown hosts the call usually 404s — fall back to A1. |
| `--page` (required) | Page ID (digits in `/pages/<id>/...`). |
| `--json` | JSON output instead of the table. |
| `--include-orphans` | Also list custom content owned by the page but unreferenced in its ADF body. |

### B2 — fetch

```bash
set -a; source .env.forge.local; set +a
node .claude/skills/find-macros-on-page/scripts/fetch.mjs \
  --site lite-dev --id 16973825 --out /tmp/diagram.xml
```

Writes the auto-detected body field (graphXml / code / spec) to `--out`. Metadata (type, title, diagramType, bytes) goes to stderr so stdout/`--out` stays clean for piping. Confirmed bit-exact: hashes match between fetched-back and the original XML used to seed the test page.

| Flag | Notes |
|---|---|
| `--site` (required) | Same conventions as B1. |
| `--id` (required) | The customContentId from B1. |
| `--out` | Path to write the body field to. If omitted, written to stdout. |
| `--field` | Force a specific body field (`graphXml`, `code`, `spec`, or any other key). Auto-detected by default. |
| `--json` | Emit the entire parsed body as JSON instead of just one field. |

---

## End-to-end: rebuild a customer macro on lite-dev

```bash
# 1. From Playwright/claude-in-chrome (browser snippet A1) on the customer page:
#    → got customContentId 6445039617 for the diagram of interest.

# 2. Fetch its body. For a customer tenant, use A2 (browser snippet) + clipboard;
#    for our tenants, B2:
node .claude/skills/find-macros-on-page/scripts/fetch.mjs \
  --site <site> --id 6445039617 --out /tmp/diagram.xml

# 3. Rebuild on lite-dev:
node .claude/skills/create-test-page/scripts/create-test-page.mjs \
  --site lite-dev --space SD --title "customer repro" \
  --macro graph:/tmp/diagram.xml
```

The endpoint prints the new page URL on success — open it to verify.

---

## Output schema reference

**A1 / B1 (list):**

```jsonc
{
  "rendered": [
    {
      "pos": 1,                                // 1-indexed render order, includes third-party extensions
      "moduleKey": "zenuml-graph-macro-lite",  // last path segment of extensionKey
      "customContentId": "6445039617",
      "title": ".",
      "contentType": "zenuml-content-sequence",
      "localId": "72887d79-..."
    }
  ],
  "orphans": [{ "id": "5553291585", "type": "zenuml-content-graph", "title": "..." }]
}
```

**A2 (browser fetch):**

```jsonc
{
  "ok": true,
  "contentType": "zenuml-content-sequence",
  "title": ".",
  "rawLen": 23751,
  "summary": {
    "diagramType": { "type": "string", "len": 5, "first120": "graph" },
    "graphXml":    { "type": "string", "len": 21817, "first120": "<mxfile host=\"...\"..." }
  },
  "full": null  // populated only if rawLen < 4000; otherwise read window.__macroBody
}
```

**B2 (CLI fetch):** writes the body string to `--out` (or stdout). Metadata on stderr.

## Caveats

- **`rendered` includes third-party extensions.** Other Forge apps (`details`, `lref-box-file`, etc.) get counted so `pos` matches visual order. Filter `moduleKey` if you want only ours.
- **`contentType` reflects the storage slot, not the rendered diagram type.** A diagram of `diagramType: graph` may be stored under `zenuml-content-sequence` for historical reasons. The body's `diagramType` field is authoritative.
- **Pre-Forge legacy macros not listed.** Connect-era `<ac:structured-macro>` storage nodes don't appear as ADF `extension` nodes. All current installs are Forge — only matters on very old pages.
- **claude-in-chrome proxy filter.** Base64-shaped output gets blocked. Either switch to Playwright MCP for the fetch step (no filter), or clipboard-hop via `navigator.clipboard.writeText(window.__macroBody)` + `pbpaste`.

## Related

- `create-test-page` — rebuild a fetched body as a new page on a target tenant.
