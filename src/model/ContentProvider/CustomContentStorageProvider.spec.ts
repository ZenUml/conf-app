import { vi } from 'vitest';
import {CustomContentStorageProvider} from "@/model/ContentProvider/CustomContentStorageProvider";
import {NULL_DIAGRAM} from "@/model/Diagram/Diagram";
import ApWrapper2 from "@/model/ApWrapper2";

global.fetch = () => Promise.resolve(new Response("mock fetch success"));

vi.mock('@/utils/requestUtil', () => ({
  forgeRequest: vi.fn(),
  loadAllPaginatedData: vi.fn(),
}));

describe('CustomContentStorageProvider', () => {
  test('cannot find custom content', async () => {
    const storageProvider = new CustomContentStorageProvider(new ApWrapper2());
    const diagram = await storageProvider.getDiagram(undefined)
    expect(diagram).toStrictEqual(NULL_DIAGRAM);
  })

  test('custom content', async () => {
    const { forgeRequest } = await import('@/utils/requestUtil');
    const customContentData = {
      source: 'custom-content',
      code: 'A.method',
      styles: { '#A': { backgroundColor: '#57d9a3' } }
    };

    // page status check (pageId is undefined in test env, so skipped)
    // getCustomContentByIdV2 call
    vi.mocked(forgeRequest).mockResolvedValueOnce({
      body: { raw: { value: JSON.stringify(customContentData) } }
    });

    const storageProvider = new CustomContentStorageProvider(new ApWrapper2());
    const diagram = await storageProvider.getDiagram('123')
    // isCopy is false because pageId is undefined (no forge context) and count=0
    expect(diagram).toStrictEqual({
      "id": "123",
      "isCopy": false,
      "copyReason": undefined,
      "code": "A.method",
      "source": "custom-content",
      "styles": {
        "#A": {
          "backgroundColor": "#57d9a3"
        }
      }
    });
  })

})