import { DiagramType } from './Diagram';

export interface DiagramTypeConfig {
  dataField: string;
  storeUpdateAction: string;
  templateUrl: string;
  label: string;
  metricField: string;
  rendersInDiagramPortal: boolean;
}

const CONFIGS: Partial<Record<DiagramType, DiagramTypeConfig>> = {
  [DiagramType.Sequence]: {
    dataField: 'code',
    storeUpdateAction: 'updateCode2',
    templateUrl: 'https://zenuml.com/docs/category/examples/',
    label: 'Sequence',
    metricField: 'sequence',
    rendersInDiagramPortal: true,
  },
  [DiagramType.Mermaid]: {
    dataField: 'mermaidCode',
    storeUpdateAction: 'updateMermaidCode',
    templateUrl: 'https://mermaid.js.org/ecosystem/tutorials.html',
    label: 'Mermaid',
    metricField: 'mermaid',
    rendersInDiagramPortal: true,
  },
  [DiagramType.PlantUml]: {
    dataField: 'plantUmlCode',
    storeUpdateAction: 'updatePlantUmlCode',
    templateUrl: 'https://plantuml.com/guide',
    label: 'PlantUML',
    metricField: 'plantuml',
    rendersInDiagramPortal: true,
  },
  [DiagramType.Graph]: {
    dataField: 'graphXml',
    storeUpdateAction: '', // Graph uses DrawIO editor, not the code editor dispatch path
    templateUrl: '',
    label: 'Graph',
    metricField: 'graph',
    rendersInDiagramPortal: false,
  },
  [DiagramType.OpenApi]: {
    dataField: 'code',
    storeUpdateAction: 'updateCode2',
    templateUrl: '',
    label: 'OpenAPI',
    metricField: 'openapi',
    rendersInDiagramPortal: false,
  },
};

export function getDiagramConfig(type: DiagramType): DiagramTypeConfig | undefined {
  return CONFIGS[type];
}

export function getCodeFromDiagram(diagram: any, type: DiagramType): string {
  const config = CONFIGS[type];
  if (config) return diagram[config.dataField] || '';
  return '';
}

// Infers the type from the diagram itself, unlike getCodeFromDiagram (which
// takes an explicit type). Not registry-driven end to end: OpenApi/AsyncApi
// both read `code` (AsyncApi deliberately has no CONFIGS entry — see
// MacroMetrics.ts), and Graph resolves to boardGraphXml vs graphXml based on
// the diagram INSTANCE's graphEditorMode, which the per-type registry can't
// express.
export function getDiagramData(o: any): string {
  let body;
  switch (o.diagramType) {
    case DiagramType.Sequence:
    case DiagramType.OpenApi:
    case DiagramType.AsyncApi:
      body = o.code || '';
      break;
    case DiagramType.Mermaid:
      body = o.mermaidCode || '';
      break;
    case DiagramType.PlantUml:
      body = o.plantUmlCode || '';
      break;
    case DiagramType.Graph:
      // A Board macro's body is boardGraphXml. Reading graphXml here made
      // Board-only edits invisible to every drift/staleness comparison built
      // on getDiagramData. Legacy Board records (no boardGraphXml field at
      // all) still resolve to graphXml.
      body = (o.graphEditorMode === 'board' && o.boardGraphXml !== undefined
        ? o.boardGraphXml
        : o.graphXml) || '';
      break;
  }
  return body || '';
}

export function getStoreUpdateAction(type: DiagramType): string {
  const config = CONFIGS[type];
  if (config) return config.storeUpdateAction;
  return 'updateCode2';
}

export function getEditorDiagramOptions(): Array<{ value: DiagramType; label: string }> {
  return [DiagramType.Sequence, DiagramType.Mermaid, DiagramType.PlantUml]
    .filter(type => CONFIGS[type])
    .map(type => ({ value: type, label: CONFIGS[type]!.label }));
}

export async function loadForgeViewerComponent(type: DiagramType): Promise<any | null> {
  try {
    const config = CONFIGS[type];
    if (!config) return null;

    if (config.rendersInDiagramPortal) {
      const { default: DiagramPortal } = await import('@/components/DiagramPortal.vue');
      return DiagramPortal;
    }

    if (type === DiagramType.Graph) {
      const { ensureDrawioViewerLoaded } = await import('@/utils/drawio/loadDrawioViewer');
      await ensureDrawioViewerLoaded();
      const { default: ForgeGraphViewerEmbed } = await import('@/components/Viewer/ForgeGraphViewerEmbed.vue');
      return ForgeGraphViewerEmbed;
    }

    if (type === DiagramType.OpenApi) {
      const { default: OpenApiViewer } = await import('@/components/Viewer/OpenApiViewer.vue');
      return OpenApiViewer;
    }

    return null;
  } catch (e) {
    console.error('Failed to load viewer component for type:', type, e);
    return null;
  }
}
