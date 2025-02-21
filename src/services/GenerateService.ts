import store from '@/model/store2';
import globals from '@/model/globals';
import {DiagramType} from "@/model/Diagram/Diagram";

export async function generateDiagramFromPage(diagramType: DiagramType, userPrompt: string) {
  store.dispatch('updateGenerating', true);
  try {
    const page = await globals.apWrapper.getCurrentPage();
    if (page?.body?.view?.value) {
      console.log('generating from page content');

      const response = await fetch('/diagramly', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await globals.apWrapper.getToken()}`
        },
        body: JSON.stringify({
          accountId: (await globals.apWrapper._getCurrentUser()).atlassianAccountId,
          title: page.title,
          content: page.body.view.value,
          userPrompt,
          diagramType
        })
      });

      const result: { dsl: string, diagramId: string } = await response.json();
      console.log('Generation response', result);
      
      store.dispatch('updateGenerating', false);
      store.dispatch('updateDiagramType', diagramType);

      const data = parseDsl(result.dsl);

      if(diagramType === 'sequence') {
        store.dispatch('updateCode2', `title ${data.title}\n\n${data.content}`);
      } else {
        store.dispatch('updateMermaidCode', data.content);
        store.dispatch('updateTitle', data.title);
      }
      
    }
  } finally {
    store.dispatch('updateGenerating', false);
  }
}

function parseDsl(dsl: string): {title: string, content: string} {
  const titleKey = 'diagram_title';
  const contentKey = 'diagram_content';

  // Remove newlines and extra spaces for easier processing
  const cleanString = dsl.trim();

  const titlePattern = new RegExp(`"${titleKey}":\\s*"([^"]+)"`);
  const contentPattern = new RegExp(`"${contentKey}":\\s*\`([^\`]+)\``);

  const titleMatch = cleanString.match(titlePattern);
  const contentMatch = cleanString.match(contentPattern);

  const title = titleMatch ? titleMatch[1].trim() : '';
  const content = contentMatch ? contentMatch[1].trim() : '';

  if (!title || !content) {
    console.error('Invalid Diagram DSL', dsl);
    return `Sorry, failed to generate diagram. Please try again.`;
  }
  
  return {title, content};
}