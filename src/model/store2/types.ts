import {Diagram} from "@/model/Diagram/Diagram";

export interface RootState {
  diagram: Diagram
  error: any,
  generating: boolean,
  onElementClick: Function
}
