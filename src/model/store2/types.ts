import { Diagram } from '@/model/Diagram/Diagram';

export interface DiagramLoadError {
  directFetchStatus?: 'ok' | 'not_found' | 'other_error';
  httpStatus?: number;
  errorCode?: string;
  errorClass?: 'thrown' | 'structured' | 'malformed';
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
  error: any,
  onElementClick: Function
}
