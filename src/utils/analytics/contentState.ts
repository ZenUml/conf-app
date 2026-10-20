// #113: classify a macro body as default / authored / empty for `macro_viewed`.
//
// Payoff: a custom_content_id that was once `authored` and is now `empty` is a
// high-confidence wipe. Pure string compare on the already-loaded body — no new
// event, no network.
//
//   empty    — the type-specific body field is null / undefined / whitespace-only
//   default  — the body equals the bundled starter content for that type
//   authored — anything else, including types that have no known body field
import { DiagramType, type Diagram } from '@/model/Diagram/Diagram';
import Example from '@/utils/sequence/Example';
import OpenApiExample from '@/model/OpenApi/OpenApiExample';
import { EMPTY_GRAPH } from '@/utils/graph/emptyGraph';
import { decompress } from '@/utils/compress';
import type { ContentState } from './catalog';

type BodyFields = Pick<
  Diagram,
  'code' | 'mermaidCode' | 'plantUmlCode' | 'graphXml' | 'markdownCode'
>;

// DiagramType -> the Diagram field that holds that type's body.
// OpenAPI and AsyncAPI keep their spec in `code`; Embed has no body of its own
// (the viewer mounts the referenced document's real type, so that type's own
// body is what gets classified).
const BODY_FIELD: Partial<Record<DiagramType, keyof BodyFields>> = {
  [DiagramType.Sequence]: 'code',
  [DiagramType.Mermaid]: 'mermaidCode',
  [DiagramType.PlantUml]: 'plantUmlCode',
  [DiagramType.Graph]: 'graphXml',
  [DiagramType.OpenApi]: 'code',
  [DiagramType.AsyncApi]: 'code',
  [DiagramType.Markdown]: 'markdownCode',
};

// The sample a new macro of this type is seeded with. Types without a seed
// (AsyncAPI, Markdown) can only be `empty` or `authored`.
const DEFAULT_BODY: Partial<Record<DiagramType, string>> = {
  [DiagramType.Sequence]: Example.Sequence,
  [DiagramType.Mermaid]: Example.Mermaid,
  [DiagramType.PlantUml]: Example.PlantUml,
  [DiagramType.Graph]: EMPTY_GRAPH,
  [DiagramType.OpenApi]: OpenApiExample,
};

// Confluence storage can change line endings and trailing whitespace on a
// round trip; the sample is still the sample.
const normalise = (s: string): string => s.replace(/\r\n/g, '\n').trimEnd();

// Legacy graph bodies are lzutf8-compressed (see forge-graph-editor.ts); the
// seed is plain XML. Best-effort: a body that fails to decompress is compared
// as-is, so it lands in `authored`.
function plainGraphXml(body: string): string {
  if (body.startsWith('<mxGraphModel') || body.startsWith('<mxfile')) return body;
  try {
    return decompress(body) ?? body;
  } catch {
    return body;
  }
}

export function classifyContentState(
  diagram: Partial<BodyFields> | null | undefined,
  diagramType: DiagramType,
): ContentState {
  const field = BODY_FIELD[diagramType];
  if (!field) return 'authored';
  const raw = diagram?.[field];
  if (raw == null || typeof raw !== 'string' || raw.trim() === '') return 'empty';
  const seed = DEFAULT_BODY[diagramType];
  if (seed === undefined) return 'authored';
  const body = diagramType === DiagramType.Graph ? plainGraphXml(raw) : raw;
  return normalise(body) === normalise(seed) ? 'default' : 'authored';
}

// What call sites pass to trackRenderTime. A diagram that never loaded has an
// empty body because nothing was read, not because anyone wiped it, so it
// carries no verdict at all: reporting `empty` there would plant false wipe
// signals in exactly the data #113 reads. "Never loaded" is: loadError /
// legacyLoadBlocked set, or still the NULL_DIAGRAM shell (diagramType Unknown —
// a document that was really fetched always has a type; see
// isDisplayableDiagram in viewerLoadOutcome.ts).
export function viewContentState(
  diagram:
    | (Partial<BodyFields> & Partial<Pick<Diagram, 'diagramType' | 'loadError' | 'legacyLoadBlocked'>>)
    | null
    | undefined,
  diagramType: DiagramType,
): ContentState | undefined {
  if (!diagram || diagram.loadError || diagram.legacyLoadBlocked) return undefined;
  if (!diagram.diagramType || diagram.diagramType === DiagramType.Unknown) return undefined;
  return classifyContentState(diagram, diagramType);
}
