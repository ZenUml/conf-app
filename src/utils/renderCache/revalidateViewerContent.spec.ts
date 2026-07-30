import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import {
  _resetForTesting,
  getCachedContent,
  hashContent,
} from '@/utils/renderCache/contentCacheStore';
import { revalidateViewerContent } from '@/utils/renderCache/revalidateViewerContent';

describe('revalidateViewerContent', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('stores changed fresh content before changed and after-fresh callbacks', async () => {
    const customContentId = 'cc-revalidate';
    const cached = { ...NULL_DIAGRAM, diagramType: DiagramType.OpenApi, code: 'cached' };
    const fresh = { ...cached, code: 'fresh' };
    const events: string[] = [];

    await revalidateViewerContent({
      customContentId,
      cachedHash: hashContent(JSON.stringify(cached)),
      loadFresh: async () => {
        events.push('load');
        return fresh;
      },
      onChanged: (document) => {
        expect(document).toBe(fresh);
        expect(getCachedContent(customContentId)?.doc).toBe(JSON.stringify(fresh));
        events.push('changed');
      },
      afterFresh: (document) => {
        expect(document).toBe(fresh);
        events.push('afterFresh');
      },
    });

    expect(events).toEqual(['load', 'changed', 'afterFresh']);
  });

  it('stores unchanged fresh content without invoking the changed callback', async () => {
    const customContentId = 'cc-unchanged';
    const cached = { ...NULL_DIAGRAM, diagramType: DiagramType.OpenApi, code: 'same' };
    const fresh = { ...cached };
    const events: string[] = [];

    await revalidateViewerContent({
      customContentId,
      cachedHash: hashContent(JSON.stringify(cached)),
      loadFresh: async () => fresh,
      onChanged: () => {
        events.push('changed');
      },
      afterFresh: () => {
        events.push('afterFresh');
      },
    });

    expect(getCachedContent(customContentId)?.doc).toBe(JSON.stringify(fresh));
    expect(events).toEqual(['afterFresh']);
  });

  it('leaves the cache and callbacks untouched when fresh content is missing', async () => {
    const customContentId = 'cc-missing';
    const onChanged = vi.fn();
    const afterFresh = vi.fn();

    await revalidateViewerContent({
      customContentId,
      cachedHash: 'cached-hash',
      loadFresh: async () => undefined,
      onChanged,
      afterFresh,
    });

    expect(getCachedContent(customContentId)).toBeUndefined();
    expect(onChanged).not.toHaveBeenCalled();
    expect(afterFresh).not.toHaveBeenCalled();
  });

  it('warns and resolves when background revalidation rejects', async () => {
    const error = new Error('custom content 500');
    const onChanged = vi.fn();
    const afterFresh = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(revalidateViewerContent({
        customContentId: 'cc-rejected',
        cachedHash: 'cached-hash',
        loadFresh: async () => {
          throw error;
        },
        onChanged,
        afterFresh,
      })).resolves.toBeUndefined();

      expect(onChanged).not.toHaveBeenCalled();
      expect(afterFresh).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[content-swr] background revalidate failed; cached render stands',
        error,
      );
    } finally {
      warn.mockRestore();
    }
  });
});
