# Spike: local `create_diagram` body vs `ApWrapper2.createCustomContentV2`

**Branch:** `spike/local-agent-diagram`
**Date:** 2026-06-25
**Run:** `node spike/build-body.mjs` (exits 0; evidence at
`~/.overnight-runs/conf-app/2026-06-25-0802/evidence/spike-body-diff.txt`)

## The assumption under test (riskiest, from ARCHITECTURE.md)

> "A local `create_diagram` tool can emit a Confluence v2 custom-content
> `body.value` JSON **byte-identical** to what conf-app's
> `ApWrapper2.createCustomContentV2` produces, so the existing macro renders it
> unchanged."

## Method

Headless, sandbox-only. No `@forge/bridge`, no network, no Confluence write.

1. Read the real source to extract the exact body shape conf-app builds:
   - `src/model/ApWrapper2.ts`
     - `getCustomContentTypePrefix` / `getContentKey` / `getCustomContentType` (L182-201)
     - `createCustomContentV2` (L237-278)
     - `sanitizeCustomContentBody` (L320-338)
   - `src/model/Diagram/Diagram.ts` — `Diagram` fields + `NULL_DIAGRAM`
   - `src/forgeIndex.ts` — fresh-Sequence `doc` literal (L402-408),
     `saveToPlatform(store.state.diagram)` (L753)
   - `src/model/store2/ExtendedStore.ts` — store starts at `NULL_DIAGRAM`,
     mutated by `updateCode2` / `updateTitle` / …
   - `src/model/ContentProvider/Persistence.ts` + `CustomContentStorageProvider.ts`
     — the call chain `saveToPlatform → save → createCustomContentV2`
   - `src/utils/sequence/Example.ts` — the Sequence DSL
2. `spike/build-body.mjs` replicates the **pure serialization** verbatim and
   builds the body for one known Sequence fixture, three ways:
   - **conf-app reference** — the realistic save-time diagram object
     (`{diagramType, code, mermaidCode, plantUmlCode, isNew, title}`),
     serialized exactly as `createCustomContentV2` does.
   - **naive local tool** — what a standalone tool that only knows DSL + title
     would emit (`{diagramType, code, title}`).
   - **aligned local tool** — the same tool *after* reading conf-app source,
     emitting the identical key set and insertion order.
3. Byte-compare `body.value`; then field-by-field, key-order, and envelope.

### What is LIVE-EXECUTED vs SHAPE-MATCHED-BY-CODE-READING

| Part | Status | Why |
|---|---|---|
| `body.value = JSON.stringify(sanitize(diagram))` | **LIVE-EXECUTED** | Pure JS. `JSON.stringify` is deterministic on key insertion order; identical bytes here and in the Forge iframe. `sanitizeCustomContentBody` is replicated line-for-line and exercised. |
| `body.representation: "raw"` | LIVE (constant) | Hard-coded literal in source. |
| `type` (`ac:…:zenuml-content-sequence`) | **SHAPE-MATCHED** | Value depends on `forgeGlobal.isLite/isDiagramly/isAsyncApi`. Construction logic replicated verbatim; fed fixture variant (Full). |
| `title` fallback (`Untitled ${ISO}`) | SHAPE-MATCHED | Depends on `new Date()` at runtime; only the fallback branch is time-dependent, not the supplied-title branch. |
| `pageId` / `spaceId` (exactly one) | **SHAPE-MATCHED** | Value comes from `forgeContext.extension.content.id` / current space at runtime. The "exactly one parent" rule (ApWrapper2 L264-274) is replicated. |

## Result: **PARTIALLY-PROVED**

Byte-identity of `body.value` is **achievable but NOT free**. The naive local
tool is **not** byte-identical; an *aligned* tool that replicates conf-app's
exact key set and insertion order **is** byte-identical (proven in-run).

```
naive  local body.value : 164 bytes — byte-identical to conf-app? false
aligned local body.value: ——       — byte-identical to conf-app? TRUE
conf-app body.value     : 212 bytes
```

### Field-by-field summary

| field | conf-app | naive local | aligned local | byte-identical (naive) |
|---|---|---|---|---|
| `diagramType` | `"sequence"` | `"sequence"` | `"sequence"` | YES |
| `code` | DSL | DSL | DSL | YES |
| `title` | `"Order Service"` | `"Order Service"` | `"Order Service"` | YES (value) |
| `mermaidCode` | `""` | **absent** | `""` | **NO** |
| `plantUmlCode` | `""` | **absent** | `""` | **NO** |
| `isNew` | `true` | **absent** | `true` | **NO** |
| **key order** | `[diagramType,code,mermaidCode,plantUmlCode,isNew,title]` | `[diagramType,code,title]` | identical | **NO** |

Envelope fields (`type`, `title`, `pageId`, `body.representation`) all match
between the naive tool and conf-app — the divergence is **entirely inside
`body.value`**: (a) three optional fields conf-app emits but the naive tool
omits, and (b) key insertion order, which `JSON.stringify` honors and which
therefore changes the byte stream.

## The assumption conflates two different bars

"Byte-identical" and "renders unchanged" are **not the same requirement**, and
the gap matters:

- **Byte-identity** requires reproducing conf-app's incidental serialization
  artifacts (`isNew:true`, empty `mermaidCode`/`plantUmlCode`, key order). These
  are an accident of the editor's `doc` literal + Vuex mutation order, not a
  contract. A standalone tool will not reproduce them unless told to.
- **"Renders unchanged"** is a *weaker* bar. The viewer/loader parse path
  (`ApWrapper2.parseCustomContentDiagram` L1051-1065;
  `getCustomContentByIdV2` L478; `searchCustomContentForge` L863) does
  `JSON.parse(body.raw.value)`, requires only `diagram.diagramType` to be
  present, and the Sequence renderer reads `code` via
  `getDiagramData` (`Diagram.ts:21-40`). It is **order-insensitive** and
  **ignores missing optional fields**. So the *naive* tool's body — though not
  byte-identical — would **still render unchanged**.

In other words: the assumption as written (byte-identity) is **stronger than
the product actually needs**, and is only met by an aligned tool; but the
*intent* behind it ("the existing macro renders it unchanged") is met even by
the naive tool, for a fresh Sequence create.

## Residual risk for a real build

1. **Edit/round-trip, not just create.** Byte-identity only matters on *update*
   if the architecture wants the local tool to avoid spurious diffs / version
   bumps. `updateCustomContentV2` (L340-384) requires a correct `version.number`
   and `id`/`pageId`/`status` pulled from the *existing* CC — a local tool
   cannot fabricate those without first reading the live CC. Create is the easy
   case; edit needs live read-modify-write. **Not covered by this spike.**
2. **Variant + parent context is runtime-only.** `type` (`-lite` suffix,
   `gptdock-confluence`, `my-api`) and the `pageId`/`spaceId` parent are resolved
   from `forgeGlobal` / `forgeContext` inside the iframe. A local tool must be
   handed the correct variant and a valid page/space id, or the POST 400s or
   writes under the wrong custom-content type (invisible to the macro). This is
   shape-matched here, not live-validated against a real install.
3. **Other diagram types.** Only Sequence was tested. Graph triggers the
   `compressed`-strip branch in `sanitizeCustomContentBody`; Mermaid/PlantUml use
   different code fields (`mermaidCode`/`plantUmlCode`). Each type has its own
   field set and its own byte-shape — extend the fixture per type before relying
   on byte-identity across types.
4. **Schema drift.** Byte-identity is brittle: any future change to the editor's
   `doc` literal or Vuex mutation order silently breaks an aligned local tool's
   byte-match without breaking rendering. If the architecture genuinely needs
   byte-identity (rather than render-equivalence), it should pin a canonical
   serializer shared by both producers, not have the local tool shadow conf-app's
   incidental shape.

## Recommendation

Drop the "byte-identical" wording from the architecture and target
**render-equivalent** instead (valid `diagramType` + correct `code` field +
correct `type`/parent envelope). If byte-identity is truly required, factor the
diagram-serialization into a shared module both conf-app and the local tool
import, rather than asking the local tool to replicate conf-app's editor-state
key order.
