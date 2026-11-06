---
name: create-test-page
description: Create a Confluence page with one or more ZenUML macros entirely via REST API — no browser, no editor UI. Use whenever you need to render a macro with specific content (e.g. a known-wide DrawIO XML, a specific Mermaid input) to validate a rendering change. Triggers on "create test page", "render test", "API test page", "skip the editor", or when validating a viewer/renderer fix. Built for ZEN-1168-style use cases.
---

# Create Test Page (API-only)

Render a ZenUML macro on a real Confluence page through the REST API. No Playwright snapshots, no slash menu, no Publish button. The command verifies the page and custom content before returning the URL and IDs.

## When to use

You're testing a **rendering** change — the question is "does the macro display correctly given content X?" Examples:

- ZEN-1168: does a 5000px-wide DrawIO diagram fit inside the 760px iframe?
- Mermaid renderer change: does a 200-line sequence diagram still lay out correctly?
- OpenAPI viewer change: does a spec with many endpoints scroll without overflow?

Do NOT use for testing the editor/insertion path (use `/smoke-test` for that), the slash menu, the macro browser, or any other user-input flow.

## Why this exists

The `/smoke-test` skill drives Playwright through the editor to create a page. That's ~20+ tool calls per page (snapshot, click, fill, snapshot again, wait, snapshot, …). It's also brittle — slash-menu refs, Browse dialog timing, ProseMirror quirks.

When the only thing you actually need is "a page that renders this content," the API does it in a single `Bash` invocation. The body is read from a local file, so you never pay tokens to inline a 70KB DrawIO XML in a tool argument.

| Approach | Tool calls per page | Tokens (small body) | Tokens (~70KB body) |
|---|---|---|---|
| `/smoke-test` (Playwright editor flow) | ~20 | ~15K | ~15K (body typed via keystrokes) |
| `browser_evaluate` with inline fetch() | 2–3 | ~3K | ~80K (body in tool arg) |
| **This skill** | 1 Bash | ~200 | ~200 (body in file, just outputs URL) |

## One-time setup

Create an Atlassian API token at https://id.atlassian.com/manage-profile/security/api-tokens and add to `.env.forge.local`:

```
FORGE_EMAIL=<your-email>
FORGE_API_TOKEN=<token>
```

These reuse the same env-var names the Forge CLI documents (see [docs/debugging/forge-cli-auth.md](../../../docs/debugging/forge-cli-auth.md)) — same token works for both.

## Usage

```bash
set -a; source .env.forge.local; set +a
node .claude/skills/create-test-page/scripts/create-test-page.mjs \
  --app lite \
  --environment development \
  --site lite-dev \
  --space SD \
  --title "Wide graph render test" \
  --macro graph:.claude/skills/create-test-page/fixtures/graph-wide.xml
```

Output: the page URL followed by `pageId=... customContentIds=...`. Hand the URL to a browser skill for screenshot/inspection, or `open` it.

### Args

| Flag | Required | Notes |
|---|---|---|
| `--app` | yes | `lite`, `full`, `diagramly`, or `asyncapi` |
| `--environment` | yes | `development`, `staging`, or `production` (validated for the selected app) |
| `--site` | yes | Approved site alias for the selected app/environment |
| `--space` | yes | Space key (e.g. `SD`, `ZEN`, `ZS`) |
| `--title` | no | Defaults to `Test page <ISO timestamp>` |
| `--parent` | no | Parent page ID for placement |
| `--macro` | yes (repeatable) | `<type>:<path-to-content-file>` — at least one; pass multiple for several macros on one page |

### Macro types

| Type | Content format | Custom-content type |
|---|---|---|
| `graph` | DrawIO mxGraphModel XML | `…:zenuml-content-graph` |
| `sequence` | ZenUML source | `…:zenuml-content-sequence` |
| `mermaid` | Mermaid source | `…:zenuml-content-sequence` |
| `plantuml` | PlantUML source | `…:zenuml-content-sequence` |
| `openapi` | OpenAPI YAML or JSON | `…:zenuml-content-sequence` |
| `asyncapi` | AsyncAPI YAML or JSON | `…:async-api-doc` (AsyncAPI app only) |

## What it does internally

1. `POST /wiki/rest/api/content` — create empty page (storage representation)
2. For each `--macro`: `POST /wiki/rest/api/content` — create custom content of the right type, with the type-specific body (`graphXml`, `code`, `mermaidCode`, or `plantUmlCode`) in `raw` representation, container = the new page
3. `PUT /wiki/rest/api/content/{pageId}` — update page with `atlas_doc_format` body containing a Forge `extension` ADF node per macro, with `guestParams['custom-content-id']` pointing at each created custom content

4. Read the page ADF and each custom-content body back. The command checks extension keys, custom-content IDs, content types, and diagram types before printing success.

Auth: Basic with `FORGE_EMAIL` + `FORGE_API_TOKEN`. The token still needs access to the selected site; AsyncAPI may require a different credential profile.

The Forge extension key is `<APP_ID>/<ENV_ID>/static/<macro-module-key>`. App identity, environment, and site are explicit at invocation; the internal registry resolves verified Forge IDs and app-specific content keys.

## Caveats

- **Target registry.** Add a target only with an environment ID verified by `forge environments list`; do not guess one.
- **Pages are not auto-cleaned.** They sit in the space until you delete them. The script doesn't tag them — add `--title 'Throwaway …'` and clean up periodically.
- **Custom content size limits.** Confluence rejects content bodies over ~5MB. The 70KB ZEN-1168 reference XML is fine; very large generated diagrams might not be.
- **Cleanup is best effort.** If creation or verification fails, the command attempts to delete created custom content and the page. Check Confluence if a request fails midway.

## Fixtures shipped

- `fixtures/graph-wide.xml` — 4-box DrawIO diagram spanning x=40 → x=2350 (well outside the 760px iframe). The regression fixture for ZEN-1168.

Add more fixtures here when a rendering bug reappears — keep them small and synthetic so they describe the trigger condition clearly.
