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
