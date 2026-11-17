import type { Store } from 'vuex';
import { DiagramType } from '@/model/Diagram/Diagram';
import { detectForeignDialect, extractMermaidSource } from '@/model/Diagram/detectForeignDialect';
import { classifyContentState } from '@/utils/analytics/contentState';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { toast } from '@/utils/toast';
import type { DiagramPasteReport } from './diagramPaste';

const MOVE_MESSAGE = 'This looks like Mermaid, so it is now in the Mermaid tab.';

// One handler per mounted editor. `moveDeclined` is that editor session's
// memory of an Undo click: after it, Mermaid pasted into the Sequence tab
// stays there.
export function createDiagramPasteHandler(store: Store<any>): (report: DiagramPasteReport) => void {
  let moveDeclined = false;

  const safely = (what: string, fn: () => void) => {
    try {
      fn();
    } catch (e) {
      console.warn(`[diagram paste] ${what} failed`, e);
    }
  };

  return (report) => {
    const mermaidSource = extractMermaidSource(report.pastedText);
    const dialect = detectForeignDialect(report.pastedText);
    const foreign = dialect !== null && dialect !== report.editorType;
    if (!report.fenceRemoved && !foreign) return;

    const contentStateBefore =
      report.editorType === 'sequence'
        ? classifyContentState({ code: report.docBefore }, DiagramType.Sequence)
        : classifyContentState({ mermaidCode: report.docBefore }, DiagramType.Mermaid);

    const moving =
      report.editorType === 'sequence' &&
      dialect === 'mermaid' &&
      mermaidSource !== null &&
      !moveDeclined &&
      contentStateBefore !== 'authored' &&
      classifyContentState(store.state.diagram, DiagramType.Mermaid) !== 'authored';

    if (moving) {
      const previousMermaidCode = store.state.diagram.mermaidCode;
      store.dispatch('updateMermaidCode', mermaidSource);
      store.commit('updateDiagramType', DiagramType.Mermaid);
      store.dispatch('updateCode2', report.docBefore);
      store.commit('updateError', null);
      safely('toast', () =>
        toast({
          message: MOVE_MESSAGE,
          duration: 8000,
          action: {
            label: 'Undo',
            onClick: () => {
              moveDeclined = true;
              store.dispatch('updateMermaidCode', previousMermaidCode);
              store.commit('updateDiagramType', DiagramType.Sequence);
              store.dispatch('updateCode2', report.docAfter);
              store.commit('updateError', null);
              safely('tracking', () =>
                trackAnalyticsEvent('diagram_paste_move_undone', {
                  feature_area: 'macro',
                  surface: 'editor',
                  macro_type: 'sequence',
                  detected_dialect: 'mermaid',
                }),
              );
            },
          },
        }),
      );
    }

    const pasteAction = moving ? 'moved_to_mermaid' : report.fenceRemoved ? 'fence_removed' : 'inserted_unchanged';
    safely('tracking', () =>
      trackAnalyticsEvent('diagram_paste_handled', {
        feature_area: 'macro',
        surface: 'editor',
        macro_type: report.editorType,
        has_markdown_fence: report.fenceRemoved,
        fence_language: report.fenceLanguage,
        ...(dialect !== null ? { detected_dialect: dialect } : {}),
        paste_action: pasteAction,
        content_state: contentStateBefore,
        paste_chars: report.pastedText.length,
      }),
    );
  };
}
