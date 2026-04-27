import store from '@/model/store2';
import globals from '@/model/globals';
import {DiagramType} from "@/model/Diagram/Diagram";
import { getStoreUpdateAction } from "@/model/Diagram/DiagramTypeConfig";
import { callRemote } from '@/utils/requestUtil';

export async function generateDiagramFromPage(diagramType: DiagramType, userPrompt: string) {
  store.dispatch('updateDiagramType', diagramType);
  store.dispatch('updateGenerating', true);

  try {
    const page = await globals.apWrapper.getCurrentPage();

    if (page?.body?.export_view?.value || page?.title) {
      console.log('generating from page content');

      const response = await callRemote(`/diagramly/generate`, 'POST', {
          accountId: (await globals.apWrapper._getCurrentUser()).atlassianAccountId,
          title: page.title,
          content: page.body.export_view.value,
          userPrompt,
          diagramType
        });

      const result: { dsl: string, diagramId: string, diagramTitle: string } = await response;
      console.log('Generation response', result);

      store.dispatch('updateGenerating', false);

      store.dispatch(getStoreUpdateAction(diagramType), result.dsl);

      store.dispatch('updateTitle', result.diagramTitle);
      store.dispatch('updateMetadata', { diagramId: result.diagramId });

    }
  } finally {
    store.dispatch('updateGenerating', false);
  }
}

export async function diagramlyChat(messages: Array<any>) {
  return await callRemote(`/diagramly/chat`, 'POST', {
      accountId: (await globals.apWrapper._getCurrentUser()).atlassianAccountId,
      messages
    });
}

export async function fixDiagram(diagramCode: string, errorMessage: string, diagramType: DiagramType): Promise<{ updatedCode: string }> {
  try {
    const response = await callRemote(`/diagramly/fix-diagram`, 'POST', {
      accountId: (await globals.apWrapper._getCurrentUser()).atlassianAccountId,
      diagramCode,
      errorMessage,
      diagramType: diagramType
    });
    const result: { updatedCode: string } = await response;
    console.log('Fix diagram response', result);
    return result;
  } catch (error) {
    console.error('Error fixing diagram:', error);
    throw error;
  }
}
