import globals from '@/model/globals';
import { trackEvent } from '@/utils/window';
import {
  getClientDomain,
  getSpaceKey,
} from "@/utils/ContextParameters/ContextParameters";
import { callRemote } from '@/utils/requestUtil';

export async function toggleDiagramLike(diagramId: string) {
  const data = {
    userAccountId: (await globals.apWrapper._getCurrentUser()).atlassianAccountId,
    diagramCustomContentId: diagramId,
    clientDomain: getClientDomain(),
    confluenceSpace: getSpaceKey(),
    confluencePageId: (await globals.apWrapper._getCurrentPageId()),
    macroUuid: (await globals.apWrapper.getMacroData())?.uuid,
  };

  const result = await callRemote('/diagram-likes/toggle', 'POST', data);
  console.debug('Diagram-likes response', result);
  return result;
}

export async function getDiagramLikes(diagramId: string) {
  try {
    // Check if we have a macroUuid (new diagrams won't have one)
    const macroData = await globals.apWrapper.getMacroData();
    if (!macroData?.uuid) {
      console.log('New diagram detected (no macroUuid). Returning empty likes array.');
      return [];
    }

    const data = {
      diagramCustomContentId: diagramId,
      clientDomain: getClientDomain(),
      confluenceSpace: getSpaceKey(),
      confluencePageId: (await globals.apWrapper._getCurrentPageId()),
      macroUuid: macroData?.uuid,
    };

    const result = await callRemote('/diagram-likes/query', 'POST', data);
    console.debug('Diagram-likes response', result);
    return result;
  } catch (e) {
    console.error('Error when getting diagram likes', e);
    const errorMessage = e instanceof Error ? e.message : String(e);
    trackEvent(errorMessage, 'like_diagram', 'error');
    return []; // Return empty array as fallback to prevent undefined.length errors
  }
}