import type { Store } from 'vuex';
import type { DiagramPasteReport } from './diagramPaste';

export function createDiagramPasteHandler(_store: Store<any>): (report: DiagramPasteReport) => void {
  return () => {};
}
