import { describe, expect, it } from 'vitest';
import { graphViewerAdapter } from '@/utils/viewerAdapters/graphViewerAdapter';

describe('graphViewerAdapter target resolution', () => {
  it('uses config.customContentId and config.uuid without consulting localId', async () => {
    const result = await graphViewerAdapter.resolve({
      cloudId: 'cloud-a',
      localId: 'must-not-be-used',
      extension: {
        config: { customContentId: 'cc-graph', uuid: 'storage-uuid' },
        content: { id: 'page-1' },
      },
    });

    expect(result).toEqual({
      status: 'loadable',
      target: {
        customContentId: 'cc-graph',
        storageUuid: 'storage-uuid',
        pageId: 'page-1',
      },
      cacheIdentity: {
        cloudId: 'cloud-a',
        customContentId: 'cc-graph',
        macroKind: 'graph',
      },
    });
  });

  it('keeps config.uuid legacy recovery loadable without a cache identity', async () => {
    await expect(graphViewerAdapter.resolve({
      cloudId: 'cloud-a',
      localId: 'not-storage',
      extension: { config: { uuid: 'storage-uuid' } },
    })).resolves.toEqual({
      status: 'loadable',
      target: {
        customContentId: undefined,
        storageUuid: 'storage-uuid',
        pageId: undefined,
      },
      cacheIdentity: undefined,
    });
  });

  it('returns an explicit empty target when neither config id exists', async () => {
    await expect(graphViewerAdapter.resolve({
      localId: 'not-storage',
      extension: { config: {} },
    })).resolves.toEqual({ status: 'empty', reason: 'missing_target' });
  });
});
