import store from '@/model/store2';
import globals from '@/model/globals';

export async function generateDiagramFromPage() {
  store.dispatch('updateGenerating', true);
  try {
    const page = await globals.apWrapper.getCurrentPage();
    if (page?.body?.view?.value) {
      console.log('generating from page content');

      const response = await fetch('/diagramly', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          accountId: (await globals.apWrapper._getCurrentUser()).atlassianAccountId,
          title: page.title,
          content: page.body.view.value
        })
      });

      const result: { dsl: string, diagramId: string } = await response.json();
      console.log('Generation response', result);
      
      store.dispatch('updateGenerating', false);
      store.dispatch('updateCode2', result.dsl);
    }
  } finally {
    store.dispatch('updateGenerating', false);
  }
}