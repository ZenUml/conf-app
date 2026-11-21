import { callRemote } from '@/utils/requestUtil';
import { Diagram, DiagramType, DataSource } from '@/model/Diagram/Diagram';

export interface PreparedDiagramPayload {
  diagramType: string;
  diagramSource: string;
  title?: string;
  curatedAt?: string;
}

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

export function preparedAgeDays(payload: PreparedDiagramPayload): number | undefined {
  if (!payload.curatedAt) return undefined;
  const t = Date.parse(payload.curatedAt);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
}
