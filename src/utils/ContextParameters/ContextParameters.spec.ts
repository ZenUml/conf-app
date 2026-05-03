import {setUpWindowLocation} from "../../../tests/SetUpWindowLocation";
import {getClientDomain, getSpaceKey, getSubdomain} from "@/utils/ContextParameters/ContextParameters";
import { vi } from 'vitest';
import forgeGlobal from '@/model/globals/forgeGlobal';

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: {
    isForge: false,
    forgeContext: null,
  }
}));

describe('ContextParameters', () => {
  it.each([
    ['https://a.atlassian.net', 'a'],
    ['https://a1.atlassian.net', 'a1'],
    ['https://a_.atlassian.net', 'a_'],
    ['https://a-b.atlassian.net', 'a-b'],
    ['https://A.atlassian.net', 'a'],
    ['https://1024.atlassian.net', '1024'],
    ['https://1024.atlassian.ne', ''],
  ])('base url [%s] => subdomain [%s]', (baseUrl: string, subdomain: string) => {
    expect(getSubdomain(baseUrl)).toBe(subdomain)
  })

  it('should return client domain', () => {
    const query = '?version=2022.07&spaceKey=ZS&pageId=121504351&pageVersion=17&macroId=c43e14c1-6db6-41b2-9f04-ad6065acf4ba&uuid=41af36e0-925f-42bc-9f07-4c73980cc39c&outputType=display&addonKey=com.zenuml.confluence-addon&contentKey=zenuml-content-graph&xdm_e=https%3A%2F%2Fzenuml-stg.atlassian.net&xdm_c=channel-com.zenuml.confluence-addon__zenuml-graph-macro8557314653811711875&cp=%2Fwiki&xdm_deprecated_addon_key_do_not_use=com.zenuml.confluence-addon&lic=none&cv=1000.0.0-19ac9bc0de8a';
    setUpWindowLocation(query);
    expect(getClientDomain()).toBe('zenuml-stg');
    expect(getSpaceKey()).toBe('ZS')
  })

  describe('getSpaceKey resolution order', () => {
    beforeEach(() => {
      // Reset window location to no spaceKey param
      setUpWindowLocation('?xdm_e=https%3A%2F%2Fzenuml-stg.atlassian.net');
      // Reset initialContext
      (window as any).initialContext = undefined;
      vi.mocked(forgeGlobal).forgeContext = null as any;
    });

    it('should resolve space key from URL param (source 1)', () => {
      setUpWindowLocation('?spaceKey=URL_SPACE&xdm_e=https%3A%2F%2Fzenuml-stg.atlassian.net');
      (window as any).initialContext = { currentSpace: { key: 'INITIAL_SPACE' } };
      vi.mocked(forgeGlobal).forgeContext = { extension: { space: { key: 'FORGE_SPACE' } } } as any;
      expect(getSpaceKey()).toBe('URL_SPACE');
    });

    it('should resolve space key from initialContext (source 2) when URL param absent', () => {
      (window as any).initialContext = { currentSpace: { key: 'INITIAL_SPACE' } };
      vi.mocked(forgeGlobal).forgeContext = { extension: { space: { key: 'FORGE_SPACE' } } } as any;
      expect(getSpaceKey()).toBe('INITIAL_SPACE');
    });

    it('should resolve space key from Forge context (source 3) when URL param and initialContext absent', () => {
      vi.mocked(forgeGlobal).forgeContext = { extension: { space: { key: 'FORGE_SPACE' } } } as any;
      expect(getSpaceKey()).toBe('FORGE_SPACE');
    });

    it('should return no_space_context when all sources are absent', () => {
      expect(getSpaceKey()).toBe('no_space_context');
    });
  });
})

