import {Diagram} from "@/model/Diagram/Diagram";

export interface RootState {
  diagram: Diagram
  // Flipped true once the viewer's async loadDiagram() has resolved (success
  // OR failure); only ForgeEmbedViewer reads it. Optional because most store
  // consumers never touch it.
  diagramLoadComplete?: boolean
  error: any,
  onElementClick: Function
}
