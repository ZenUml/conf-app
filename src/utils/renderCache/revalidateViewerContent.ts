import type { DiagramAttribution } from '@/model/DiagramAttribution';
import type { Diagram } from '@/model/Diagram/Diagram';
import { hashContent, putCachedContent } from '@/utils/renderCache/contentCacheStore';

interface RevalidateViewerContentOptions {
  customContentId: string;
  cachedHash: string;
  loadFresh: () => Promise<Diagram | undefined>;
  onChanged: (fresh: Diagram) => void | Promise<void>;
  cacheAttribution?: () => DiagramAttribution | null | undefined;
  afterFresh?: (fresh: Diagram) => void | Promise<void>;
}

export async function revalidateViewerContent(
  options: RevalidateViewerContentOptions,
): Promise<void> {
  try {
    const fresh = await options.loadFresh();
    if (!fresh) return;

    const serialized = JSON.stringify(fresh);
    if (options.cacheAttribution) {
      putCachedContent(options.customContentId, serialized, options.cacheAttribution());
    } else {
      putCachedContent(options.customContentId, serialized);
    }
    if (hashContent(serialized) !== options.cachedHash) {
      await options.onChanged(fresh);
    }
    await options.afterFresh?.(fresh);
  } catch (error) {
    console.warn('[content-swr] background revalidate failed; cached render stands', error);
  }
}
