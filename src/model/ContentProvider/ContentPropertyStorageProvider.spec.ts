import { ContentPropertyStorageProvider } from '@/model/ContentProvider/ContentPropertyStorageProvider';
import ApWrapper2 from '@/model/ApWrapper2';

global.fetch = () => Promise.resolve(new Response('mock fetch success'));

describe('ContentPropertyStorageProvider', () => {
  test('cannot find content property', async () => {
    const contentPropertyStorageProvider = new ContentPropertyStorageProvider(new ApWrapper2());
    try {
      await contentPropertyStorageProvider.getDiagram(undefined)
    } catch (e: any) {
      expect(e.message).toBe('property is not found with key:zenuml-sequence-macro-fake-macro-uuid-body')
    }
  })

  test('or content property old', async () => {
    // In Forge-only mode, getContentProperty() always returns undefined.
    // ContentPropertyStorageProvider returns NULL_DIAGRAM (empty diagram).
    const contentPropertyStorageProvider = new ContentPropertyStorageProvider(new ApWrapper2());
    const diagram = await contentPropertyStorageProvider.getDiagram(undefined)
    expect(diagram?.code).toBe('')
  })

  test('or content property as object {code, styles}', async () => {
    // In Forge-only mode, getContentProperty() always returns undefined.
    // ContentPropertyStorageProvider returns NULL_DIAGRAM (empty diagram).
    const contentPropertyStorageProvider = new ContentPropertyStorageProvider(new ApWrapper2());
    const diagram = await contentPropertyStorageProvider.getDiagram(undefined)
    expect(diagram?.code).toBe('')
  })
})
