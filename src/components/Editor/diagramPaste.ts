import { Annotation } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import type { PasteFenceLanguage } from '@/utils/analytics/catalog';

export type PasteEditorType = 'sequence' | 'mermaid';
export interface DiagramPasteReport {
  editorType: PasteEditorType;
  pastedText: string;
  fenceRemoved: boolean;
  fenceLanguage: PasteFenceLanguage;
  docBefore: string;
  docAfter: string;
}
export const pasteFence = Annotation.define<{ language: PasteFenceLanguage }>();

export function diagramPasteExtension(
  _editorType: PasteEditorType,
  _onPaste: (report: DiagramPasteReport) => void,
): Extension {
  return [];
}
