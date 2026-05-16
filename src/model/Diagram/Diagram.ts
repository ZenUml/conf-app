export enum DataSource {
  MacroBody = 'macro-body',
  ContentProperty = 'content-property',
  ContentPropertyOld = 'content-property-old',
  CustomContent = 'custom-content',
  Example = 'example',
  Unknown = 'unknown',
}

export enum DiagramType {
  Sequence = 'sequence',
  Mermaid = 'mermaid',
  PlantUml = 'plantuml',
  Graph = 'graph',
  OpenApi = 'OpenAPI',
  AsyncApi = 'AsyncAPI',
  Embed = 'embed',
  Unknown = 'unknown'
}

export function getDiagramData(o: any): string{
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
      body = o.graphXml || '';
      break;
  }
  return body || '';
}

export class Diagram {
  // id is used only for debugging and for display only. It is NOT saved in custom content or content property.
  id?: string; // custom content id or content property id or uuid
  isCopy?: boolean;
  copyReason?: 'cross-page' | 'same-page-duplicate';
  diagramType: DiagramType = DiagramType.Unknown;
  code?: string = '';
  title?: string = '';
  styles?: object = {};
  mermaidCode?: string = '';
  plantUmlCode?: string = '';
  graphXml?: string = '';
  /**
   * No diagrams need to be compressed anymore. This is kept for backward compatibility.
   * @deprecated This will be removed soon.
   */
  compressed?: boolean = undefined;
  source?: DataSource = DataSource.Unknown;
  isNew?: boolean = undefined; // whether it is a new diagram
  metadata?: object = undefined; // additional metadata

  public getCoreData?(): string {
    return getDiagramData(this);
  }
}

const NULL_DIAGRAM = {
  id: '',
  diagramType: DiagramType.Unknown,
  code: '',
  title: '',
  styles: {},
  mermaidCode: '',
  plantUmlCode: '',
  graphXml: '',
  source: DataSource.Unknown,
  payload: undefined,
} as Diagram;

export {NULL_DIAGRAM};
