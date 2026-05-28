import {Diagram} from "@/model/Diagram/Diagram";

export interface DiagramLoadError {
  directFetchStatus?: 'ok' | 'not_found' | 'other_error';
  httpStatus?: number;
  errorCode?: string;
  errorClass?: 'thrown' | 'structured' | 'malformed';
}

export interface RootState {
  diagram: Diagram
  loadError: DiagramLoadError | null
  error: any,
  generating: boolean,
  lastDiagramWasAI: boolean,
  onElementClick: Function
}
