import {Diagram} from "@/model/Diagram/Diagram";
import {PublishBlockReason} from "@/model/editDupGate";
import type { ViewerLoadState } from '@/utils/viewerLoadState';

export interface RootState {
  diagram: Diagram
  /** Explicit plain-viewer lifecycle state; viewerLoadLifecycle is its owner. */
  viewerLoadState: ViewerLoadState
  // Editor-side backstop (model/editDupGate.ts): non-null when the mounted
  // doc is a copy in a surface that cannot write a forked id back into the
  // macro config — Header.vue disables Publish and the save handler refuses.
  // Deliberately OUTSIDE `diagram`: UI/control-plane flags on the diagram
  // body round-trip into storage and drafts (the ZEN-1170 trap).
  publishBlock?: PublishBlockReason | null
  error: any,
  onElementClick: Function
}
