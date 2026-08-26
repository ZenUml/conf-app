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

export class Diagram {
  // id is used only for debugging and for display only. It is NOT saved in custom content or content property.
  id?: string; // custom content id or content property id or uuid
  isCopy?: boolean;
  copyReason?: 'cross-page' | 'same-page-duplicate';
  // ZEN-1170 Defect 2b: set when this diagram was loaded via the orphan-
  // sibling recovery path (the macro's stored customContentId 404s but a
  // page-child CC with matching body.id was used instead). The in-viewer
  // Edit button is gated off because view.submit({config}) in the modal
  // flow doesn't persist back to the macro XML; saves from that flow would
  // silently create an orphan. The user must edit via Confluence's page
  // editor (gear icon / macro toolbar) where isConfiguring=true and repair
  // can persist.
  recoveredFromOrphan?: boolean;
  // ZEN-1170 Defect 2b: the original (dead) customContentId the macro XML
  // references. Threaded through save so saveCustomContentV2 can update
  // the recovered sibling in-place (bypass the count===1 guard that
  // assumes a referring macro exists) AND preserve body.id = this value
  // so future probe-based recovery still finds the CC even if the
  // macro-config repair via view.submit doesn't land.
  recoveredFromOrphanId?: string;
  // Transient, never persisted (stripped by sanitizeCustomContentBody alongside
  // the recovery flags above). Set when something EXPLICITLY asked for this
  // diagram's type — the byline's type picker, or a pasted /new/<type> link —
  // as opposed to the type merely being a default. Header.vue reads it to know
  // that the remembered `zenuml-preferred-diagram-type` must not overrule the
  // user's choice.
  typeRequested?: boolean;
  diagramType: DiagramType = DiagramType.Unknown;
  code?: string = '';
  title?: string = '';
  styles?: object = {};
  mermaidCode?: string = '';
  plantUmlCode?: string = '';
  graphXml?: string = '';
  /**
   * Optional independent DrawIO Board document. Legacy records only have
   * graphXml, which remains the Diagram-mode document for compatibility.
   */
  boardGraphXml?: string = '';
  /**
   * Which of the two documents above this macro publishes. The macro config
   * carries the same value and is the authority wherever a Forge context is
   * reachable; this copy exists for the surfaces that never see one — the
   * embed host, the export snapshot, and getDiagramData().
   */
  graphEditorMode?: 'diagram' | 'board';
  /**
   * No diagrams need to be compressed anymore. This is kept for backward compatibility.
   * @deprecated This will be removed soon.
   */
  compressed?: boolean = undefined;
  source?: DataSource = DataSource.Unknown;
  isNew?: boolean = undefined; // whether it is a new diagram
  metadata?: object = undefined; // additional metadata
  // ZEN-1170 Defect 1: set when a legacy content-property read failed in a
  // non-404 way (403/HTTP error/parse error) OR returned an unexpected value
  // shape (e.g. a string body on a graph macro). The persistence layer
  // refuses to save such diagrams so a failed legacy load can never be
  // silently replaced with an empty/example diagram.
  legacyLoadBlocked?: boolean = undefined;
  // Source-snapshot fallback (docs/superpowers/plans/2026-07-18-diagram-
  // source-snapshot-attachments.md): true when the diagram was restored from
  // a host-page zenuml-<ccId>.json attachment because the live custom content
  // was unreachable. GenericViewer surfaces a "cached copy" notice.
  snapshotFallback?: boolean = undefined;
  // ISO timestamp of the snapshot attachment used for snapshotFallback.
  snapshotAt?: string = undefined;
  // Slice 1 of the content-opening unification: set when openDocument's
  // resolution totally failed (an id existed but every direct fetch, orphan
  // recovery, and legacy fallback missed). OpenApiViewer.vue (and later
  // families as they migrate) render a terminal message instead of silently
  // falling back to an example/blank document.
  //
  // Shape MUST stay in sync with `DiagramLoadError` in
  // src/model/store2/types.ts — the single store-level error vocabulary.
  // The openDocument pipeline's own `OpenError` (documentOpening/types.ts)
  // is converted into this shape at the loader boundary
  // (mapOpenErrorToLoadError in utils/viewerLoadOutcome.ts) before anything
  // is published. Not imported directly — this is a low-level model file and
  // store2/types.ts imports Diagram from it, so a direct import would be a
  // cycle — the literal is duplicated here instead.
  loadError?: {
    directFetchStatus?: 'ok' | 'not_found' | 'other_error';
    httpStatus?: number;
    errorCode?: string;
    errorClass?: 'thrown' | 'structured' | 'malformed';
  } = undefined;

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
