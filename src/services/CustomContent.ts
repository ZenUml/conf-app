import globals from '@/model/globals';
import { DiagramType } from "@/model/Diagram/Diagram";
import { trackEvent, addonKey } from '@/utils/window';
import {
  getClientDomain,
} from "@/utils/ContextParameters/ContextParameters";
import { makeExternalRequest2 } from '@/utils/requestUtil';

export async function syncCustomContent(customContent: any, diagramType: DiagramType, macroUuid: string) {
  try {
    const data = {
      clientDomain: getClientDomain(),
      addonKey: addonKey(),
      contentId: customContent.id,
      customContentId: customContent.id,
      diagramType: diagramType,
      macroUuid: macroUuid,
    };

    await makeExternalRequest2('/forge-custom-content', '/custom-content', 'POST', data);
    trackEvent('', 'sync_custom_content', 'success');
    
  } catch (e) {
    console.error('Error when syncing custom content', e);
    trackEvent(JSON.stringify(e), 'sync_custom_content', 'error');
  }
}
