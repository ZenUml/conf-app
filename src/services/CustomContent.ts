import globals from '@/model/globals';
import { DiagramType } from "@/model/Diagram/Diagram";
import { getBaseUrl } from "@/utils/ContextParameters/ContextParameters";
import { addonKey, trackEvent } from '@/utils/window';
import {
  getClientDomain,
} from "@/utils/ContextParameters/ContextParameters";

export async function syncCustomContent(customContent: any, diagramType: DiagramType, macroUuid: string) {
  try {
    const response = await fetch(`/custom-content?xdm_e=${getBaseUrl()}&addonKey=${addonKey()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await globals.apWrapper.getToken()}`
      },
      body: JSON.stringify({
        clientDomain: getClientDomain(),
        addonKey: addonKey(),
        contentId: customContent.id,
        diagramType: diagramType,
        macroUuid: macroUuid
      })
    });

    const result = await response.json();
    trackEvent('', 'sync_custom_content', 'success');

    return result;
  } catch (e) {
    console.error('Error when syncing custom content', e);
    trackEvent(JSON.stringify(e), 'sync_custom_content', 'error');
  }
}
