import {Diagram} from "@/model/Diagram/Diagram";

export interface DiagramLoadError {
  httpStatus?: number;
  errorClass?: 'thrown' | 'structured' | 'malformed';
}

export interface RootState {
  diagram: Diagram
  loadError: DiagramLoadError | null
  error: any,
  generating: boolean,
  onElementClick: Function
}
