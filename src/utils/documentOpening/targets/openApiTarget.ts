import { NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { trackEvent } from '@/utils/window';
import globals from '@/model/globals';
import type { LegacyFallback, ResolvedTarget, TargetSpec } from '@/utils/documentOpening/types';

function resolveOpenApiId(context: any): ResolvedTarget | undefined {
  const configId = context.extension?.config?.customContentId;
  const modalId = context.extension?.modal?.customContentId;
  const contentId = configId || modalId;
  if (!contentId) return undefined;
  return { contentId, source: configId ? 'config' : 'modal' };
}

/**
 * ZEN-1170 Defect 1 sibling: cross-page-paste recovery via uuid -> CC title
 * (findLegacyCustomContentByUuid). OpenAPI macros never used content
 * properties, so this is the family's only legacy fallback.
 */
function makeUuidTitleFallback(surface: 'viewer' | 'editor'): LegacyFallback {
  return async ({ context, pageId }) => {
    const storageUuid = context.extension?.config?.uuid;
    if (!storageUuid) return undefined;
    const recovered = await globals.apWrapper.findLegacyCustomContentByUuid(storageUuid);
    if (!recovered?.value) return undefined;
    const doc = recovered.value;
    doc.recoveredFromOrphan = true;
    trackEvent(storageUuid, 'legacy_custom_content_by_uuid_restored', 'info', {
      surface,
      macro_type: 'openapi',
      recovered_id: String(recovered.id ?? ''),
      is_copy: doc.isCopy ? 'true' : 'false',
      ...(pageId && { page_id: pageId }),
    });
    return doc;
  };
}

export function buildOpenApiViewerTarget(): TargetSpec {
  return {
    resolveId: resolveOpenApiId,
    legacyFallbacks: [makeUuidTitleFallback('viewer')],
    onMiss: 'fail',
    macroType: 'openapi',
  };
}

export function buildOpenApiEditorTarget(): TargetSpec {
  return {
    resolveId: resolveOpenApiId,
    legacyFallbacks: [makeUuidTitleFallback('editor')],
    onMiss: 'default-doc',
    defaultDoc: () => NULL_DIAGRAM,
    macroType: 'openapi',
  };
}
