import store from '@/model/store2';
import globals from '@/model/globals';
import {DiagramType} from "@/model/Diagram/Diagram";
import { getBaseUrl } from "@/utils/ContextParameters/ContextParameters";
import {addonKey, trackEvent} from '@/utils/window';

export async function createDiagramLike(diagramId: string, diagramType: DiagramType) {
  try {
      const response = await fetch(`/diagram-likes?xdm_e=${getBaseUrl()}&addonKey=${addonKey()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await globals.apWrapper.getToken()}`
        },
        body: JSON.stringify({
          userAccountId: (await globals.apWrapper._getCurrentUser()).atlassianAccountId,
          diagramCustomContentId: diagramId,
        })
      });

      const result = await response.json();
      console.log('Diagram-likes response', result);

  } catch (e) {
      console.error('Error when liking diagram', e);
      trackEvent(JSON.stringify(e), 'like_diagram', 'error');
  }
}