import {Diagram, DiagramType} from "@/model/Diagram/Diagram";
import {CustomContentStorageProvider} from "@/model/ContentProvider/CustomContentStorageProvider";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import type { MacroTypeValue } from "@/utils/analytics/catalog";
import ApWrapper2 from "@/model/ApWrapper2";
import uuidv4 from "@/utils/uuid";
import { syncCustomContent } from "@/services/CustomContent";
import globals from '@/model/globals';
import forgeGlobal from '@/model/globals/forgeGlobal';
import macroMetrics from '@/services/MacroMetrics';

export async function saveToPlatform(diagram: Diagram, apWrapper: ApWrapper2 = globals.apWrapper): Promise<string> {
  console.log('Saving diagram to platform content provider', diagram);
  const customContentStorageProvider = new CustomContentStorageProvider(apWrapper);
  const customContent = await customContentStorageProvider.save(diagram);
  const macroData = await apWrapper.getMacroData();
  let uuid = macroData?.uuid;
  
  // Get body for tracking
  const body = diagram.getCoreData ? diagram.getCoreData() : '';

  if(await apWrapper.isInContentEditOrContentCreate()) {
    uuid = uuid || uuidv4();
    const params = { uuid, customContentId: customContent.id, updatedAt: new Date() };
    apWrapper.saveMacro(params, body);
    console.debug('Saved macro params and body', params);
  } else {
    console.log('not content edit, skip save macro.');
  }
  
  let isNew;
  isNew = !diagram.id;
  
  const DIAGRAM_TYPE_TO_MACRO_TYPE: Record<string, MacroTypeValue> = {
    [DiagramType.Sequence]: 'sequence',
    [DiagramType.Mermaid]:  'mermaid',
    [DiagramType.PlantUml]: 'plantuml',
    [DiagramType.Graph]:    'graph',
    [DiagramType.OpenApi]:  'openapi',
    [DiagramType.Embed]:    'embed',
  };
  const macroType: MacroTypeValue = DIAGRAM_TYPE_TO_MACRO_TYPE[diagram.diagramType] ?? 'none';

  if (isNew) {
    trackAnalyticsEvent("macro_create_succeeded", {
      feature_area: "macro",
      surface: "editor",
      macro_type: macroType,
      operation_mode: "create",
    });
  } else {
    trackAnalyticsEvent("macro_save_succeeded", {
      feature_area: "macro",
      surface: "editor",
      macro_type: macroType,
      operation_mode: "edit",
    });
  }

  // Report metrics on save (updates KV cache for all users)
  macroMetrics.reportMacroMetrics().catch(e => console.debug('Metrics reporting failed (non-critical)', e));

  await syncCustomContent(customContent, diagram.diagramType, uuid || '');

  return String(customContent.id);
}
