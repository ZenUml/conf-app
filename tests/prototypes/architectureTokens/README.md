# Mermaid Flowchart Jison parser-evidence contract harness

This Node-only harness is intentionally outside `src/`; no product code imports
it. It verifies the checked-in browser-safe artifact against the exact
Flowchart parser that Mermaid **11.12.2** embeds in `dist/mermaid.js.map`. The
package does not ship the editable `flow.jison` grammar or Jison generator; the
source-map entry is nevertheless the exact Jison 0.4.18-generated parser
bundled by this installed version.

## What was proved

The adapter enables Jison `ranges`, then captures `this._$` from the parser's
own `vertex` and `vertexStatement` semantic reductions. This is deliberately
not a FlowDB or post-token heuristic. On one public-parser-valid Flowchart it
captured ten distinct node occurrences, including repeated `A` and `D`, chained
edges, a subgraph, and standalone `X[Standalone]`. Every accepted occurrence
round-tripped from its raw UTF-16 span to the exact original fragment and then
to a UTF-8 byte span. `Start 😀` demonstrates that its byte span is not a
JavaScript string-index span.

The only raw-source preprocessing modelled is CRLF to LF. Its map marks the
normalized newline as unmappable, so an occurrence crossing it cannot receive a
raw locator. The fixture's node occurrences do not cross a line ending and map
successfully.

## Deliberate refusals

The prototype rejects before parsing any source with frontmatter, Mermaid
comments/directives, HTML attribute normalization, Mermaid entity encoding, a
lone carriage return, or Mermaid Flowchart's `}\s*\n → }\n` rewrite. The last
case has a dedicated test: `B{Check}    \r\n` is rejected, not shifted or
guessed. This is required because the installed `flowParser` applies that
rewrite after general Mermaid preprocessing.

## Trade-off evidenced so far

Jison semantic reductions can preserve repeated occurrence positions that
FlowDB merges away, and may eventually avoid extending a handwritten grammar
for every supported Flowchart construct. It is still a private implementation
surface: production would couple to Mermaid's bundled source-map availability,
generated production numbering and semantic values, Jison UTF-16 ranges, and
Mermaid's preprocessing order. A raw-source mapping layer remains mandatory.

The product path treats these results as parser-derived position evidence only.
The domain Locator remains the distinct product layer and keeps its own spans,
roles, occurrence context, and future value beyond a raw span. The integration
verifies Jison evidence against every Locator occurrence; a mismatch, failed
contract, or unsupported preprocessing leaves the full Locator unchanged and
records a rejection reason. This harness remains the upgrade contract for the
version-pinned artifact.
