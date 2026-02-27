import { DiagramType } from './Diagram';

export interface DiagramTypeConfig {
  dataField: string;
  storeUpdateAction: string;
  wide: boolean;
  viewerUrl: string;
  templateUrl: string;
  label: string;
  metricField: string;
  rendersInDiagramPortal: boolean;
}

const CONFIGS: Partial<Record<DiagramType, DiagramTypeConfig>> = {
  [DiagramType.Sequence]: {
    dataField: 'code',
    storeUpdateAction: 'updateCode2',
    wide: false,
    viewerUrl: '/sequence-viewer.html',
    templateUrl: 'https://zenuml.com/docs/category/examples/',
    label: 'Sequence',
    metricField: 'sequence',
    rendersInDiagramPortal: true,
  },
  [DiagramType.Mermaid]: {
    dataField: 'mermaidCode',
    storeUpdateAction: 'updateMermaidCode',
    wide: true,
    viewerUrl: '/sequence-viewer.html',
    templateUrl: 'https://mermaid.js.org/ecosystem/tutorials.html',
    label: 'Mermaid',
    metricField: 'mermaid',
    rendersInDiagramPortal: true,
  },
  [DiagramType.Graph]: {
    dataField: 'graphXml',
    storeUpdateAction: '', // Graph uses DrawIO editor, not the code editor dispatch path
    wide: true,
    viewerUrl: '/drawio/viewer.html',
    templateUrl: '',
    label: 'Graph',
    metricField: 'graph',
    rendersInDiagramPortal: false,
  },
  [DiagramType.OpenApi]: {
    dataField: 'code',
    storeUpdateAction: 'updateCode2',
    wide: true,
    viewerUrl: '/swagger-ui.html',
    templateUrl: '',
    label: 'OpenAPI',
    metricField: 'openapi',
    rendersInDiagramPortal: false,
  },
};

export function getDiagramConfig(type: DiagramType): DiagramTypeConfig | undefined {
  return CONFIGS[type];
}

export function getViewerUrl(type: DiagramType): string {
  const config = CONFIGS[type];
  if (config) return config.viewerUrl;
  console.warn(`Unknown diagramType: ${type}`);
  return '/sequence-viewer.html';
}

export function getCodeFromDiagram(diagram: any, type: DiagramType): string {
  const config = CONFIGS[type];
  if (config) return diagram[config.dataField] || '';
  return '';
}

export function getStoreUpdateAction(type: DiagramType): string {
  const config = CONFIGS[type];
  if (config) return config.storeUpdateAction;
  return 'updateCode2';
}

export function getEditorDiagramOptions(): Array<{ value: DiagramType; label: string }> {
  return [DiagramType.Sequence, DiagramType.Mermaid]
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
      const { default: ForgeGraphViewerEmbed } = await import('@/components/Viewer/ForgeGraphViewerEmbed.vue');
      return ForgeGraphViewerEmbed;
    }

    if (type === DiagramType.OpenApi) {
      const { default: ForgeOpenApiViewer } = await import('@/components/Viewer/ForgeOpenApiViewer.vue');
      return ForgeOpenApiViewer;
    }

    return null;
  } catch (e) {
    console.error('Failed to load viewer component for type:', type, e);
    return null;
  }
}
