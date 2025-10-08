import globals from '@/model/globals';
import { DiagramType } from "@/model/Diagram/Diagram";
import { getBaseUrl } from "@/utils/ContextParameters/ContextParameters";
import { addonKey, trackEvent } from '@/utils/window';
import {
  getClientDomain,
} from "@/utils/ContextParameters/ContextParameters";
import forgeGlobal from '@/model/globals/forgeGlobal';
import { forgeCallRemote } from '@/utils/requestUtil';

export async function syncCustomContent(customContent: any, diagramType: DiagramType, macroUuid: string) {
  try {
    const url = forgeGlobal.isForge 
      ? `${forgeGlobal.zenumlRemoteBaseUrl}/forge-custom-content?xdm_e=https://api.atlassian.com/ex/confluence/${forgeGlobal.forgeContext.cloudId}&forgeCloudId=${forgeGlobal.forgeContext.cloudId}` 
      : `/custom-content?xdm_e=${getBaseUrl()}&addonKey=${addonKey()}`;
    
    const data = {
      clientDomain: getClientDomain(),
      addonKey: addonKey(),
      contentId: customContent.id,
      customContentId: customContent.id,
      diagramType: diagramType,
      macroUuid: macroUuid,
      forgeCloudId: forgeGlobal.forgeContext.cloudId
    };

    const response = forgeGlobal.isForge ? await forgeCallRemote(url, 'POST', data) 
      : await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await globals.apWrapper.getToken()}`
        },
        body: JSON.stringify(data)
      });

    const result = await response.json();
    trackEvent('', 'sync_custom_content', 'success');

    return result;
  } catch (e) {
    console.error('Error when syncing custom content', e);
    trackEvent(JSON.stringify(e), 'sync_custom_content', 'error');
  }
}
