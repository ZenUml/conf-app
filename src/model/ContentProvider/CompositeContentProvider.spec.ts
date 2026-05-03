import { vi } from 'vitest';
import defaultContentProvider from "@/model/ContentProvider/CompositeContentProvider";
import ApWrapper2 from "@/model/ApWrapper2";
import TestHelper from '../../../tests/unit/TestHelper';
import globals from '@/model/globals';

global.fetch = () => Promise.resolve(new Response("mock fetch success"));

vi.mock('@/utils/requestUtil', () => ({
  forgeRequest: vi.fn().mockRejectedValue(new Error('not found')),
  loadAllPaginatedData: vi.fn(),
}));

describe('CompositeContentProvider', () => {
  test('should return NULL_DIAGRAM when no custom content id is provided (Forge-only: no Connect fallback)', async () => {
    // In Forge-only mode: getMacroData returns no customContentId,
    // getContentProperty and getMacroBody both return undefined.
    // The composite chain returns NULL_DIAGRAM.
    const contentProvider = defaultContentProvider(new ApWrapper2());
    const {doc} = (await contentProvider.load());
    expect(doc.code).toBe('');
  })

  test('should return NULL_DIAGRAM when all providers fail (Forge-only: no Connect fallback)', async () => {
    // In Forge-only mode, all fallback providers return NULL_DIAGRAM.
    const contentProvider = defaultContentProvider(new ApWrapper2());
    const {doc} = (await contentProvider.load());
    expect(doc.code).toBe('');
  })

  // This is used in embedding documents
  describe('embeded', () => {
    beforeEach(() => {
      globals.isEmbedded = true;
    });

    test('should use url based content id if rendered.for==custom-content-native', async () => {
      const { forgeRequest } = await import('@/utils/requestUtil');
      TestHelper.setUpUrlParam('rendered.for=custom-content-native&content.id=123');

      // pageId is undefined in test env so the page status call is skipped;
      // first forgeRequest call is getCustomContentByIdV2
      vi.mocked(forgeRequest).mockResolvedValueOnce({
        body: {
          raw: {
            value: JSON.stringify({
              source: 'custom-content',
              code: 'A.method',
              styles: { '#A': { backgroundColor: '#57d9a3' } }
            })
          }
        }
      });

      const contentProvider = defaultContentProvider(new ApWrapper2());
      const {doc} = (await contentProvider.load());
      expect(doc.code).toBe('A.method');
    })

    afterEach(() => {
      globals.isEmbedded = false;
    });
  });

})