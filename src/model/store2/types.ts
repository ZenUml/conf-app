import { Diagram } from '@/model/Diagram/Diagram';
import { PublishBlockReason } from '@/model/editDupGate';
import type { DiagramAttribution } from '@/model/DiagramAttribution';

export interface DiagramLoadError {
  directFetchStatus?: 'ok' | 'not_found' | 'other_error';
  httpStatus?: number;
  errorCode?: string;
  errorClass?: 'thrown' | 'structured' | 'malformed';
  /**
   * The load produced a document that LOOKS renderable but is not the one the
   * macro asked for (a Board macro holding only a legacy Diagram body).
   * classifyViewerLoadOutcome lets a terminal error beat displayability;
   * a non-terminal error never masks a document a recovery path restored.
   */
  terminal?: boolean;
}

export type ViewerLoadState =
  | null
  | 'loading'
  | 'ready'
  | 'failed_with_source'
  | 'failed_without_source';

export interface RootState {
  diagram: Diagram
  // Flipped true once the viewer's async loadDiagram() has resolved (success
  // OR failure); only ForgeEmbedViewer reads it. Optional because most store
  // consumers never touch it.
  diagramLoadComplete?: boolean
  viewerLoadState: ViewerLoadState;
  loadError: DiagramLoadError | null;
  // Ephemeral attribution from Confluence's custom-content envelope. Keep it
  // outside Diagram so it can never round-trip into stored diagram bodies.
  diagramAttribution: DiagramAttribution | null;
  // Editor-side backstop (model/editDupGate.ts): non-null when the mounted
  // doc is a copy in a surface that cannot write a forked id back into the
  // macro config — Header.vue disables Publish and the save handler refuses.
  // Deliberately OUTSIDE `diagram`: UI/control-plane flags on the diagram
  // body round-trip into storage and drafts (the ZEN-1170 trap).
  publishBlock?: PublishBlockReason | null
  error: any,
  onElementClick: Function
}
