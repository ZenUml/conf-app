import { DiagramType } from './Diagram'

/**
 * Text-DSL bodies older than the `diagramType` field.
 *
 * Custom content written before the field existed stores only the DSL fields
 * (`{title, code, styles, mermaidCode}` on whimet4's Full-era content). Handed
 * to a renderer as-is, such a body picks no renderer and the macro shows an
 * empty card; the byline cannot place it either. The rule is the editor's
 * restore precedence (forgeIndex.ts, ZEN-1170): `code` first — Sequence is the
 * dominant legacy shape, and old sequence bodies also carry a placeholder
 * `mermaidCode` — then `mermaidCode`, then `plantUmlCode`.
 *
 * Returns undefined when no DSL field is populated, so callers keep whatever
 * they did for an empty body.
 */
export function inferLegacyDiagramType(body: unknown): DiagramType | undefined {
  if (!body || typeof body !== 'object') return undefined
  const b = body as Record<string, unknown>
  const filled = (v: unknown) => typeof v === 'string' && v.length > 0
  if (filled(b.code)) return DiagramType.Sequence
  if (filled(b.mermaidCode)) return DiagramType.Mermaid
  if (filled(b.plantUmlCode)) return DiagramType.PlantUml
  return undefined
}

/**
 * The same body with a `diagramType` when it lacks one (or says Unknown) and
 * its fields make the type plain. A body that already states a type — any
 * type, OpenAPI included — is returned untouched, as is one with nothing to
 * infer from.
 */
export function withLegacyDiagramType<T>(body: T): T {
  if (!body || typeof body !== 'object') return body
  const stated = (body as { diagramType?: unknown }).diagramType
  if (typeof stated === 'string' && stated && stated !== DiagramType.Unknown) return body
  const inferred = inferLegacyDiagramType(body)
  return inferred ? { ...body, diagramType: inferred } : body
}

/**
 * An API spec stored without a type, recognised by its own text.
 *
 * Only the document's first statement counts: leading blank lines, `#`
 * comments and a YAML `---` marker are skipped, and `\s*` lets a JSON object
 * open on its own line. Matching `openapi:` on any later line (a `/m` regex)
 * would call a DSL body with such a line a spec.
 *
 * Kept apart from inferLegacyDiagramType on purpose. The byline uses both,
 * and places a spec under the OpenAPI macro, which renders it. The sequence
 * viewer uses only the DSL rule: DiagramPortal has no OpenAPI renderer, so a
 * spec typed there would mount nothing.
 */
export function inferLegacySpecType(body: unknown): DiagramType | undefined {
  const code = (body as { code?: unknown } | null)?.code
  if (typeof code !== 'string') return undefined
  const lines = code.slice(0, 400).split('\n')
  let i = 0
  while (i < lines.length && /^\s*(#.*|---\s*)?$/.test(lines[i])) i++
  const head = lines.slice(i).join('\n')
  // YAML (`asyncapi: 3.0.0`) or JSON (`{"asyncapi": "3.0.0"`).
  if (/^\{?\s*["']?asyncapi["']?\s*:/.test(head)) return DiagramType.AsyncApi
  if (/^\{?\s*["']?(openapi|swagger)["']?\s*:/.test(head)) return DiagramType.OpenApi
  return undefined
}
