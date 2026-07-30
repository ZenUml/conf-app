import { describe, expect, it } from 'vitest';
import { openApiViewerAdapter } from '@/utils/viewerAdapters/openApiViewerAdapter';

describe('openApiViewerAdapter target resolution', () => {
  it('uses the page-macro config id for both target and cache identity', async () => {
    const result = await openApiViewerAdapter.resolve({
      cloudId: 'cloud-a',
      extension: {
        config: { customContentId: 'config-id', uuid: 'legacy-uuid' },
        modal: { customContentId: 'modal-id' },
        content: { id: 'page-1' },
      },
    });

    expect(result).toEqual({
      status: 'loadable',
      target: {
        customContentId: 'config-id',
        storageUuid: 'legacy-uuid',
        pageId: 'page-1',
      },
      cacheIdentity: {
        cloudId: 'cloud-a',
        customContentId: 'config-id',
        macroKind: 'openapi',
      },
    });
  });

  it('uses the dashboard modal id when page config is absent', async () => {
    const result = await openApiViewerAdapter.resolve({
      cloudId: 'cloud-a',
      extension: { modal: { customContentId: 'modal-id' } },
    });

    expect(result).toMatchObject({
      status: 'loadable',
      target: { customContentId: 'modal-id' },
      cacheIdentity: { customContentId: 'modal-id', macroKind: 'openapi' },
    });
  });

  it('keeps legacy uuid recovery loadable without inventing a cache key', async () => {
    const result = await openApiViewerAdapter.resolve({
      cloudId: 'cloud-a',
      extension: { config: { uuid: 'legacy-uuid' }, content: { id: 'page-1' } },
    });

    expect(result).toEqual({
      status: 'loadable',
      target: { customContentId: undefined, storageUuid: 'legacy-uuid', pageId: 'page-1' },
      cacheIdentity: undefined,
    });
  });

  it('returns an explicit empty target when neither saved nor legacy identity exists', async () => {
    await expect(openApiViewerAdapter.resolve({ extension: {} })).resolves.toEqual({
      status: 'empty',
      reason: 'missing_target',
    });
  });
});
