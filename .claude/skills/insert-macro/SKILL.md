---
name: insert-macro
description: Insert a Confluence macro (ZenUML diagram, Graph/DrawIO, OpenAPI, etc.) via the editor's slash menu, driven by a single fast agent-browser batch script. Use whenever a task needs to insert a macro into a Confluence page through the real editor UI — spot checks, PVT, branch validation, ad hoc UI verification. Not for macro-content-only rendering checks (use create-test-page for that) and not for a full multi-macro regression sweep (use smoke-test for that). Triggers on "insert a macro", "add the zenuml macro", "test the editor insertion", "插入宏", "试一下宏插入".
---

# Insert Macro

Reliable, scriptable primitive for inserting a Confluence macro through the real slash-menu UI, extracted from the `smoke-test` skill's insertion logic so any skill can reuse it without re-deriving the gotchas.

## Hard rule: tool choice

**Never use `claude-in-chrome` for this.** Forge Custom UI macros render inside sandboxed cross-origin iframes (OOPIFs). `claude-in-chrome` cannot reach OOPIF snapshot, `eval`, or console — confirmed dead end (see `CLAUDE.md` § "Browser automation and Forge iframes", row `claude-in-chrome | ❌ | ❌ | ❌`). Its `computer` tool's `type` action also silently drops a leading `/` from strings like `/zenuml`, so even the slash-menu trigger fails before the OOPIF question comes up.

1. **`agent-browser` (default)** — reaches OOPIFs, has real-keystroke `keyboard type`, and is what `scripts/insert-macro.sh` drives.
2. **Playwright MCP (fallback)** — use only if `agent-browser` itself fails (extension relay issue, missing frame patch). Reaches OOPIFs too, but the global single-pairing relay makes it slower and flakier under concurrent sessions — see `CLAUDE.md`'s measured comparison.

## Use the script, not ad hoc commands

```bash
.claude/skills/insert-macro/scripts/insert-macro.sh --url "<edit-url>" --macro zenuml [options]
```

Runs the whole slash-menu → Browse-dialog → search → mark-then-click sequence as **one `agent-browser batch --bail` call** (one process, one daemon round-trip) instead of ~10 separate tool calls. See `--help` for the full option list; the two entry points:

```bash
# Insert into an existing page already open in edit mode
scripts/insert-macro.sh --url "https://lite-dev.atlassian.net/wiki/spaces/SD/pages/edit-v2/123" \
  --macro zenuml --match Lite

# Create a fresh page first, then insert (avoids stale-cursor / collaborative-edit noise —
# always prefer a fresh page over reusing one someone else might have open)
scripts/insert-macro.sh --new lite-dev.atlassian.net:SD:67371062 \
  --macro zenuml --match "ZenUML for Confluence" --exclude Lite --tab Mermaid
```

Options worth knowing:

| Flag | Purpose |
|---|---|
| `--macro <term>` | slash-search term: `zenuml`, `graph`, `openapi`, … |
| `--label` / `--match` / `--exclude` | disambiguate when multiple variants are installed on the same site (Lite vs Full vs Diagramly — see the table below) |
| `--tab <Sequence\|Mermaid\|PlantUML>` | click a diagram-type tab inside the iframe after the macro mounts |
| `--dismiss-paywall` | best-effort dismiss the Lite paywall / draft-recovery banner inside the iframe (needed on macro-limit-exceeded test spaces like `lite-stg`'s `SD`) |
| `--screenshot <path>` | capture the end state |

### Disambiguating Lite vs Full vs Diagramly

Full and Diagramly share the exact same display name (`Diagram (Mermaid, PlantUML & ZenUML)`) on sites where multiple variants are installed side by side — name-only matching picks one non-deterministically. Disambiguate by description text via `--match` / `--exclude`:

| Variant | `--match` | `--exclude` |
|---|---|---|
| Lite | (LABEL already matches; add) `Lite` | — |
| Full | `ZenUML for Confluence` | `Lite` |
| Diagramly | `Diagramly for Confluence` | — |

Full detail and rationale: `smoke-test` SKILL.md § "Disambiguating Full vs Diagramly when both are installed".

## Why a script instead of narrating each step

Every one of these was learned the hard way in this session and in `smoke-test`'s history — encode them once:

- **`fill`/`type` on a selector never opens the slash menu** — ProseMirror needs a real keydown, so the script uses `keyboard type` throughout.
- **The inline slash-menu list does not reliably filter** on fast synthetic keystrokes, even with real `keyboard type` — the script always routes through "View more" → the Browse dialog's own search input, which does filter correctly.
- **Click the Insert/option button by ref or by attribute, never by exact text** — `find text "Insert" click` / `click "text=Insert"` both fail-not-found on this app's button markup. The script uses the mark-then-click pattern (tag the matched element with `data-ab-pick` in `eval`, then `click "[data-ab-pick]"`).
- **A blank-looking screenshot taken immediately after the modal opens is not proof of failure.** The iframe can be fully mounted (title, tabs, code editor, live diagram all present in `eval "document.body.innerText"`) while a screenshot taken mid-paint still reads as blank white. If a screenshot looks broken, re-check with `eval` before concluding the app is broken — see `reference_slash_macro_insert_agent_browser` in project memory for the exact false-alarm this caused.

## When NOT to use this

- Pure rendering checks with known content (a specific DrawIO XML, a long Mermaid input) → **create-test-page** (REST API, no editor, no slash menu — much cheaper).
- A full multi-macro regression sweep across ZenUML/Mermaid/PlantUML/Graph/OpenAPI with page-title conventions and Publish → **smoke-test** (this script only covers up through macro insertion, not publishing).
- Ad hoc verification of one specific behavior end-to-end (may call this script as one step) → **spot-check**.
