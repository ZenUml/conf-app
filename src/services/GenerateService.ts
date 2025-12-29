import store from '@/model/store2';
import globals from '@/model/globals';
import {DiagramType} from "@/model/Diagram/Diagram";
import { getBaseUrl } from "@/utils/ContextParameters/ContextParameters";
import {addonKey} from '@/utils/window';
import { callRemote } from '@/utils/requestUtil';

export async function generateDiagramFromPage(diagramType: DiagramType, userPrompt: string) {
  store.dispatch('updateDiagramType', diagramType);
  store.dispatch('updateGenerating', true);

  try {
    const page = await globals.apWrapper.getCurrentPage();

    if (page?.body?.export_view?.value || page?.title) {
      console.log('generating from page content');

      const response = await callRemote(`/diagramly?xdm_e=${getBaseUrl()}&addonKey=${addonKey()}`, 'POST', {
          accountId: (await globals.apWrapper._getCurrentUser()).atlassianAccountId,
          title: page.title,
          content: page.body.export_view.value,
          userPrompt,
          diagramType
        });

      const result: { dsl: string, diagramId: string, diagramTitle: string } = await response;
      console.log('Generation response', result);

      store.dispatch('updateGenerating', false);

      if(diagramType === DiagramType.Sequence) {
        store.dispatch('updateCode2', result.dsl);
      } else {
        store.dispatch('updateMermaidCode', result.dsl);
      }

      store.dispatch('updateTitle', result.diagramTitle);
      store.dispatch('updateMetadata', { diagramId: result.diagramId });

    }
  } finally {
    store.dispatch('updateGenerating', false);
  }
}

