import { DiagramType } from "@/model/Diagram/Diagram";
import md5 from 'md5';
import { trackEvent, addonKey, serializeError } from '@/utils/window';
import {
  getClientDomain,
} from "@/utils/ContextParameters/ContextParameters";
import { callRemote } from '@/utils/requestUtil';

const MICRO_SYNC_BLOCKED_DOMAIN_HASHES = new Set([
  'f1a5aefbdad6aca8afe6cf3ebdf5c93d',
  '9ff49cb7e15b4b19d166d0bd472175c7', // md5('blocked-domain-example') — test fixture
]);

export async function syncCustomContent(customContent: any, diagramType: DiagramType, macroUuid: string) {
  try {
    const clientDomain = getClientDomain();

    if (clientDomain && MICRO_SYNC_BLOCKED_DOMAIN_HASHES.has(md5(clientDomain))) {
      console.info('Skipping custom content sync for blocked client domain hash');
      return;
    }

    const data = {
      clientDomain,
      addonKey: addonKey(),
      contentId: customContent.id,
      customContentId: customContent.id,
      diagramType: diagramType,
      macroUuid: macroUuid,
    };

    await callRemote('/forge-custom-content', 'POST', data);
    trackEvent('', 'sync_custom_content', 'success');

  } catch (e) {
    console.error('Error when syncing custom content', { contentId: customContent?.id, diagramType, macroUuid }, e);
    trackEvent(serializeError(e), 'sync_custom_content', 'error');
  }
}
