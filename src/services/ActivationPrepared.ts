import { callRemote } from '@/utils/requestUtil';
import { Diagram, DiagramType, DataSource } from '@/model/Diagram/Diagram';

// Client for the byline activation "prepared diagram" backend cache
// (functions/activation-prepared.ts). cloudId is derived server-side from the
// Forge invocation token — never sent from here — so the GET only needs the
// pageId.

export interface PreparedDiagramPayload {
  diagramType: string;
  diagramSource: string;
  title?: string;
  curatedAt?: string;
}

// callRemote throws on non-2xx; a 404 (cache miss) surfaces as a thrown
// "HTTP 404: ..." Error, which we translate to `undefined` so the caller can
// fire activation_cache_miss rather than crash.
export async function fetchPreparedDiagram(
  pageId: string,
): Promise<PreparedDiagramPayload | undefined> {
  try {
    const raw = await callRemote(
      `/activation-prepared?pageId=${encodeURIComponent(pageId)}`,
      'GET',
    );
    const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!body || !body.diagramType || !body.diagramSource) return undefined;
    return body as PreparedDiagramPayload;
  } catch (e) {
    if (e instanceof Error && /HTTP 404/.test(e.message)) return undefined;
    throw e;
  }
}

const SOURCE_FIELD: Record<string, keyof Diagram> = {
  [DiagramType.Sequence]: 'code',
  [DiagramType.Mermaid]: 'mermaidCode',
  [DiagramType.PlantUml]: 'plantUmlCode',
  [DiagramType.Graph]: 'graphXml',
};

// Build a fresh, unsaved Diagram from a cache payload. NO `id` is set: an id
// pushes createCustomContentV2 down the update branch against a non-existent
// record (Diagram.id doc + saveCustomContentV2 branch). The source string is
// routed into the single field the diagramType actually renders from
// (schema-traps: the other fields must stay empty or a later per-type query
// mis-reads them).
export function preparedToDiagram(payload: PreparedDiagramPayload): Diagram {
  const d = new Diagram();
  d.diagramType = payload.diagramType as DiagramType;
  d.title = payload.title || '';
  d.source = DataSource.Unknown;
  d.isNew = true;
  const field = SOURCE_FIELD[payload.diagramType];
  if (field) {
    (d as any)[field] = payload.diagramSource;
  }
  return d;
}

// Days since curation, for the prepared_age_days analytics prop. Undefined when
// the payload carries no timestamp.
export function preparedAgeDays(payload: PreparedDiagramPayload): number | undefined {
  if (!payload.curatedAt) return undefined;
  const t = Date.parse(payload.curatedAt);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
}
