import MockAp from '@/model/MockAp'
import {ContentPropertyStorageProvider} from "@/model/ContentProvider/ContentPropertyStorageProvider";
import MockApConfluence from "@/model/MockApConfluence";
import ApWrapper2 from "@/model/ApWrapper2";
import {vi} from "vitest";

global.fetch = () => Promise.resolve(new Response("mock fetch success"));


let mockAp: MockAp, mockApConfluence: MockApConfluence;

// generate response for AP.request. The parameter is the `value` at {body:"body: raw: { value }"}
describe('ContentPropertyStorageProvider', () => {
  let gtag: any;
  const contentId = 'abcd'

  beforeEach(() => {
    mockAp = new MockAp(contentId);
    mockApConfluence = mockAp.confluence as MockApConfluence;

    gtag = vi.fn();
    // @ts-ignore
    window.gtag = gtag;
  });

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
