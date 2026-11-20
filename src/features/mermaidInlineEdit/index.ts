/**
 * The one wiring file: the only place that imports sourcemap/ and edit/ and
 * hands them, with the store and the toast, to the interaction layer. Mermaid.vue
 * loads this module with a dynamic import, and only on the editor preview, so
 * the page viewer never downloads it.
 */
import type { Store } from 'vuex';
import { renameParticipant, editMessageText, sourceTextOf } from './edit';
import type { GetSourceMap } from './types';
import { attachInlineEdit, type InlineEditController } from './ui/controller';
import { DiagramType } from '@/model/Diagram/Diagram';
import { getStoreUpdateAction } from '@/model/Diagram/DiagramTypeConfig';
import { isMermaidInlineEditEnabled } from '@/apis/aiTitleFeatureFlag';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { toast } from '@/utils/toast';

// The parser is loaded on first use, after the flag said yes. getSourceMap
// runs its own Mermaid work through enqueueMermaid if it needs any; do not
// wrap it here as well: the queue is serial, so a nested enqueue deadlocks.
const getSourceMap: GetSourceMap = async (code) => (await import('./sourcemap')).getSourceMap(code);

export function mountMermaidInlineEdit(container: HTMLElement, store: Store<any>): InlineEditController {
  return attachInlineEdit(container, {
    getSourceMap,
    renameParticipant,
    editMessageText,
    sourceTextOf,
    getCode: () => store.state.diagram.mermaidCode ?? '',
    writeCode: (code) => {
      // Same write as Workspace.applyAIChatCode: CodeMirror, re-render, draft
      // and dirty state follow, and CodeMirror undo covers it.
      store.dispatch('updateError', null);
      store.dispatch(getStoreUpdateAction(DiagramType.Mermaid), code);
    },
    isEnabled: isMermaidInlineEditEnabled,
    track: (name, properties) => trackAnalyticsEvent(name, properties),
    toast: (message) => toast({ message, duration: 4000, top: '64px' }),
  });
}

export type { InlineEditController };
