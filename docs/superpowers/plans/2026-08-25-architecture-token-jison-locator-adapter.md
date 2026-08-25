# Version-pinned Jison Flowchart parser-evidence adapter — first slice

Status: local draft. The first production-path integration is deliberately
narrow: Jison supplies parser-derived structure/position evidence; it does not
replace the domain Locator.

## Goal and boundary

Architecture Tokens needs syntax-derived evidence for its raw-source UTF-8
Locators. The boundary is:

```
public Mermaid syntax validation → version-pinned Jison parser-evidence adapter
                                      ↓ (verified evidence only)
                               owned domain Locator / canonical model
                                      ↓ (Jison rejects or disagrees)
                         unchanged owned Locator + rejection provenance
```

The adapter owns only static, single-revision node occurrence extraction. The
Locator owns product spans, syntax roles, statement context, occurrence
identity, and all future locator value beyond a raw span. The adapter does not
bind tokens, reconcile revisions, persist data, invoke UI/backend code, or
confirm identity. `validateMermaidFlowchart` invokes it after public validation
and records either verified parser evidence or its explicit rejection.

## Adapter boundary

The core adapter is pure TypeScript. It accepts the raw source and an injected
`VersionPinnedJisonParserFactory`; it neither imports Mermaid nor reads a
source map. The factory returns an isolated compatible generated parser. The
adapter enables Jison ranges and captures `this._$` during `vertex` and
`vertexStatement` semantic reductions. Occurrences therefore originate in a
grammar reduction, not FlowDB or a token-text search.

The Node-only extraction script and contract test load Mermaid's generated
parser from the installed source map and must validate all of these before
writing the browser-safe checked-in artifact. Production code imports that
artifact directly and has no Node, filesystem, VM, or runtime source-map
dependency:

| Contract | First-slice pinned value | On mismatch |
| --- | --- | --- |
| Mermaid package version | `11.12.2` | adapter unavailable |
| source-map source path | `../src/diagrams/flowchart/parser/flow.jison` | adapter unavailable |
| generated parser SHA-256 | `39e8a84d459c0f4c1d436892079d58baf4514bd222e0107dd9475571777087d9` | adapter unavailable |
| Jison location capability | ranges plus `vertex` / `vertexStatement` reductions | adapter unavailable |

An upgrade must deliberately update the pin only after the full contract
fixture matrix and a source-map review pass. The fallback remains active while
the adapter is unavailable.

## Raw-source mapping: first supported transform only

The first slice supports **CRLF → LF**. It constructs parser text and a
per-UTF-16-unit provenance map. The generated LF has no one-to-one raw unit,
so a Jison span that crosses it is rejected. A mapped Jison UTF-16 range must
be a contiguous raw range, then is converted through the existing
`utf8ByteSpanFor` boundary checker. The final byte span is round-tripped from
the raw source before it can be offered as parser evidence.

No other Mermaid preprocessing is modelled. The adapter rejects, before Jison
parse, sources containing any currently known transform outside that one:

| Category | Adapter result | Why |
| --- | --- | --- |
| frontmatter | `unsupported_preprocessing: frontmatter` | Mermaid removes metadata before parse |
| comments/directives | `directive_or_comment` | Mermaid removes or interprets them |
| HTML attribute normalization | `html_attribute_normalization` | Mermaid rewrites quoted attributes |
| entity encoding | `entity_encoding` | Mermaid rewrites `#name;` forms |
| `}\s*\n → }\n` Flowchart rewrite | `flowparser_close_brace_whitespace` | changes parser coordinates after an element |
| lone CR | `lone_carriage_return` | not the supported CRLF transform |

This is deliberately an allow-list. “Public Mermaid parses” is not equivalent
to “adapter has position evidence.” Any unsupported preprocessing category
fails closed: the domain Locator remains unchanged and receives a rejection
reason, never a guessed Jison span.

## Occurrence model and fallback migration

For this slice, every accepted `vertex` reduction produces parser evidence for
a node occurrence
with native ID, syntax role (`node_declaration` or `edge_endpoint`), parser
UTF-16 range (audit only), raw UTF-16 range (audit only), raw UTF-8 byte span,
and raw fragment. Repeated native IDs remain separate occurrences. A
`vertexStatement` enclosing an edge makes its vertices endpoints; a standalone
statement makes a declaration. Edge/subgraph objects remain outside v1 binding
targets.

The current domain Locator remains unchanged. The adapter may be recorded as
verified evidence only after these gates are met:

1. the version/source/hash/Jison-shape contract passes;
2. public Mermaid validation passes independently;
3. the complete fixture matrix passes with exact byte round trips or explicit
   refusal;
4. the complete Jison evidence set agrees with every domain Locator occurrence
   without modifying any Locator value; and
5. a controlled corpus comparison shows no accepted evidence violating the
   static locator audit; and
6. product telemetry/audit fields can name adapter version and rejection reason.

The adapter is now called in the validation path but is not a product Locator
replacement. Any future Locator implementation may consume the same evidence
through this boundary; removing the handwritten implementation requires a
separate Locator-equivalence and upgrade protocol review.

## First-slice fixture contract

Fixtures assert public `mermaid.parse` separately from adapter outcome:

- valid CRLF source with repeated IDs, chained edges, subgraph, Unicode/emoji:
  parser evidence is accepted, all byte spans round-trip exactly, and domain
  Locator values remain unchanged;
- frontmatter, comment, directive, HTML attribute, entity encoding, and
  Flowchart close-brace whitespace: public validity is recorded where
  applicable, adapter refuses with its specific reason;
- malformed Flowchart: public parser rejects and adapter must not report an
  accepted locator.

The tests do not claim that the adapter implements full Mermaid preprocessing,
semantic identity, or a Locator replacement. They establish only the
version-pinned CRLF evidence slice and the refusal contract.
