---
name: confluence-diagrams
description: Find, read, create and update diagrams on Confluence Cloud pages with the ZenUML connector. Use when the user asks to draw, diagram, document or change a sequence diagram, flowchart, architecture or API diagram that lives (or should live) in Confluence.
---

# Diagrams in Confluence with ZenUML

The `zenuml` connector reads and writes ZenUML macros on the user's Confluence
Cloud sites as the user, through the Atlassian authorization they granted. It
can only reach sites and pages that user can reach, and it needs the ZenUML app
installed on the site.

## Workflow

1. **Pick the site.** Call `list_sites` and use the `cloudId` of the site the
   user means. If there is more than one and the user has not said which, ask.
2. **Find the diagram or page.**
   - An existing diagram: `list_diagrams { cloudId }` (optionally with `pageId`),
     newest first. Match by title or page.
   - A page by link: the page id is the number after `/pages/` in a Confluence
     URL. `read_page` returns its title, version and body.
3. **Read before you write.** `read_diagram { cloudId, contentId }` returns the
   current source and its `diagramType`. Keep that type when you update.
4. **Write.**
   - Change a diagram: `update_diagram` with the **complete** new source, not a
     patch. The server refuses a change that does not parse or that looks like
     accidental truncation. It saves a diagram version, not a page version; to
     undo, write back the source you read in step 3.
   - Add a diagram to a page: `create_diagram { cloudId, pageId, type, dsl, title }`.
     It appends the macro to the end of the page and publishes one page
     version. `already_present` means it is there already; `conflict` means
     someone edited the page first — read it again and retry rather than
     overwrite.
   - New page: `create_page` under a parent page, with `draft: true` when the
     user should review it before it is published.
5. **Tell the user what changed** and where: the page title, and that a page
   version (or a diagram version) was published.

Every write is visible to the user's colleagues once published. Confirm with
the user before writing when the request is ambiguous about which page or
diagram to change.

## Choosing a diagram type

| `type` | Use for | Source language |
|---|---|---|
| `sequence` | Request/response flows between services or actors | ZenUML DSL (below) |
| `mermaid` | Flowcharts, state, class, ER, Gantt, and other Mermaid diagrams | Mermaid |
| `plantuml` | Teams that already write PlantUML | PlantUML, with `@startuml`/`@enduml` |
| `graph` | Freeform diagrams.net (draw.io) drawings | draw.io XML |
| `openapi` | REST API documentation | OpenAPI 3 YAML or JSON |

Prefer `sequence` for interactions between components, and `mermaid` for most
other structured diagrams.

## ZenUML sequence DSL in brief

ZenUML is not Mermaid or PlantUML. It has no header line and no
`@startuml` wrapper.

```
@Actor User
@Database DB
Gateway as GW

User->GW.login(credentials) {
  token = Auth.verify(credentials) {
    DB.findUser(id)
    return token
  }
  if (token == null) {
    return error
  }
}
GW->Audit: loginRecorded
```

- `A.method(args)` or `A->B.method(args)` is a synchronous call; only this form
  may carry a `{ … }` body of nested calls.
- `A->B: text` is an asynchronous message and never takes a `{ … }` body.
- `x = A.method()` captures a return value; `return value` replies from inside
  a body.
- Control flow is `if (cond) { } else if (cond) { } else { }`,
  `while (cond) { }` (`for`, `forEach` and `loop` are synonyms, none takes an
  `else`), `opt (cond) { }`, `par { }`, `critical { }`, `section(label) { }`
  and `try { } catch (e) { } finally { }`. There is no `alt` keyword.
- Participants are inferred from messages. Declare annotated ones such as
  `@Actor User` or `@Database DB`, and aliases such as `Long Name as Short`, at
  the top, before the first message.
- Comments are `// text` on the line before a message.

The full language reference is at https://zenuml.com/docs.
