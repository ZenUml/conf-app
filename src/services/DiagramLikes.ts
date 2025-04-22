import globals from '@/model/globals';
import { DiagramType } from "@/model/Diagram/Diagram";
import { getBaseUrl } from "@/utils/ContextParameters/ContextParameters";
import { addonKey, trackEvent } from '@/utils/window';
import {
  getClientDomain,
  getSpaceKey,
} from "@/utils/ContextParameters/ContextParameters";

export async function toggleDiagramLike(diagramId: string, diagramType: DiagramType) {
  try {
    const response = await fetch(`/diagram-likes/toggle?xdm_e=${getBaseUrl()}&addonKey=${addonKey()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await globals.apWrapper.getToken()}`
      },
      body: JSON.stringify({
        userAccountId: (await globals.apWrapper._getCurrentUser()).atlassianAccountId,
        diagramCustomContentId: diagramId,
        clientDomain: getClientDomain(),
        confluenceSpace: getSpaceKey(),
        confluencePageId: (await globals.apWrapper._getCurrentPageId()),
        macroUuid: (await globals.apWrapper.getMacroData())?.uuid,
        diagramType: diagramType
      })
    });

    const result = await response.json();
    console.log('Diagram-likes response', result);
    return result;
  } catch (e) {
    console.error('Error when liking diagram', e);
    trackEvent(JSON.stringify(e), 'like_diagram', 'error');
  }
}

export async function getDiagramLikes(diagramId: string) {
  try {
    // Check if we have a macroUuid (new diagrams won't have one)
    const macroData = await globals.apWrapper.getMacroData();
    if (!macroData?.uuid) {
      console.log('New diagram detected (no macroUuid). Returning empty likes array.');
      return [];
    }

    const response = await fetch(`/diagram-likes/query?xdm_e=${getBaseUrl()}&addonKey=${addonKey()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await globals.apWrapper.getToken()}`
      },
      body: JSON.stringify({
        diagramCustomContentId: diagramId,
        clientDomain: getClientDomain(),
        confluenceSpace: getSpaceKey(),
        confluencePageId: (await globals.apWrapper._getCurrentPageId()),
        macroUuid: macroData?.uuid,
      })
    });

    if (!response.ok) {
      console.error('Diagram-likes query failed with status:', response.status);
      const errorText = await response.text();
      console.error('Error response:', errorText);
      const errorMessage = `Status ${response.status}: ${errorText}`;
      trackEvent(errorMessage, 'like_diagram', 'error');
      return [];
    }

    const result = await response.json();
    console.log('Diagram-likes response', result);
    return result;
  } catch (e) {
    console.error('Error when getting diagram likes', e);
    const errorMessage = e instanceof Error ? e.message : String(e);
    trackEvent(errorMessage, 'like_diagram', 'error');
    return []; // Return empty array as fallback to prevent undefined.length errors
  }
}