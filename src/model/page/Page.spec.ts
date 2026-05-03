import {AtlasPage} from "@/model/page/AtlasPage";
import {vi} from "vitest";
import forgeGlobal from '@/model/globals/forgeGlobal';

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: {
    isForge: true,
    forgeContext: {
      extension: {
        content: { id: 'page-001', type: 'page' },
        space: { key: 'space-001' },
        location: 'https://foo.atlassian.net/wiki/spaces/space-001/pages/1234/test1',
        isEditing: false,
      }
    }
  }
}));

vi.mock('@/utils/requestUtil', () => ({
  forgeRequest: vi.fn()
}));

describe('Page', () => {
  it('should know its page id', async () => {
    const page = new AtlasPage();
    expect(await page.getPageId()).toBe("page-001");
    expect(await page.getSpaceKey()).toBe("space-001");
    expect(await page.getContentType()).toBe("page");
    expect(await page.getHref()).toBe('https://foo.atlassian.net/wiki/spaces/space-001/pages/1234/test1');
  });

  it('should count macros that match the matcher', async () => {
    const { forgeRequest } = await import('@/utils/requestUtil');

    const doc = {
      type: "doc",
      content: [
        {
          type: "extension",
          attrs: {
            extensionType: "com.atlassian.confluence.macro.core",
            extensionKey: "zenuml-sequence-macro",
            parameters: {
              macroParams: {
                macroId: "macro-001",
                macroName: "Macro 1",
                customContentId: {
                  value: "custom-content-001"
                },
                macroParams: {
                  macroParam1: "Macro Param 1",
                  macroParam2: "Macro Param 2"
                }
              }
            }
          }
        }
      ]
    };

    vi.mocked(forgeRequest).mockResolvedValue({
      body: {
        atlas_doc_format: {
          value: JSON.stringify(doc)
        }
      }
    });

    const page = new AtlasPage();
    expect(await page.countMacros(() => true)).toEqual(1);
    expect(await page.countMacros((macroParams) => {
      return macroParams.customContentId?.value === "custom-content-001"
    })).toEqual(1);
    expect(await page.countMacros(() => false)).toEqual(0);
    expect(await page.countMacros((macroParams) => {
      return macroParams.customContentId?.value === "custom-content-002"
    })).toEqual(0);
  })
})
