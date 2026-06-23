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
  diagramType: DiagramType = DiagramType.Unknown;
  code?: string = '';
  title?: string = '';
  styles?: object = {};
  mermaidCode?: string = '';
  /**
   * Lever D render cache: the Mermaid SVG produced at save, injected at view to
   * skip loadMermaid()+mermaid.render(). Co-stored in the same CC body version as
   * mermaidCode (atomic — refreshed/cleared on every save so a stale SVG can't
   * outlive its code). Best-effort: absent on render failure or over the size cap
   * ⇒ viewer live-renders. Sanitized on READ before injection (stored-XSS guard).
   * See utils/mermaid/renderMermaidToSvg.ts + Persistence.maybeAttachMermaidSvg.
   */
  mermaidSvg?: string = undefined;
  plantUmlCode?: string = '';
  graphXml?: string = '';
  /**
   * Lever D render cache for Graph (DrawIO): a standalone SVG produced at save,
   * injected at view to skip ensureDrawioViewerLoaded() + new GraphViewer() (the
   * ~6s DrawIO load). Co-stored atomically in the same CC body version as graphXml,
   * sanitized on read. Best-effort: absent on render failure, over the size cap, or
   * when graphXml references external images (getSvg doesn't inline those) ⇒ viewer
   * live-renders. See utils/drawio/renderGraphToSvg.ts + Persistence.maybeAttachGraphSvg.
   */
  graphSvg?: string = undefined;
  /**
   * Lever D render cache for Sequence (ZenUML): the synchronous renderToSvg() output
   * produced at save, injected at view to skip loadZenUml() — the ~2.1s @zenuml/core
   * bundle — AND the React mount. This is the part the at-view sync_svg path could NOT
   * win: sync_svg still loads the bundle to call renderToSvg in the browser; Lever D
   * moves that render to save (where @zenuml/core is already warm in the editor) so the
   * read-only viewer needs no bundle at all. renderToSvg ignores theme (v3.47.5), so the
   * cached SVG is always the default-theme render — the viewer uses it only when
   * canUseSyncSvg() holds (display mode, default theme); themed/editor views live-render.
   * Co-stored atomically with code, sanitized on read. See
   * utils/sequence/renderSequenceToSvg.ts + Persistence.maybeAttachSequenceSvg.
   */
  sequenceSvg?: string = undefined;
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
