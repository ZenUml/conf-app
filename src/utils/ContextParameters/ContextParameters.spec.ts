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

  it('should return client domain from Forge context', () => {
    setUpWindowLocation('?spaceKey=ZS');
    vi.mocked(forgeGlobal).forgeContext = { extension: { location: 'https://zenuml-stg.atlassian.net/wiki/spaces/ZS/pages/1' } } as any;
    expect(getClientDomain()).toBe('zenuml-stg');
    expect(getSpaceKey()).toBe('ZS')
  })

  describe('getSpaceKey resolution order', () => {
    beforeEach(() => {
      // Reset window location to no spaceKey param
      setUpWindowLocation('');
      // Reset initialContext
      (window as any).initialContext = undefined;
      vi.mocked(forgeGlobal).forgeContext = null as any;
    });

    it('should resolve space key from URL param (source 1)', () => {
      setUpWindowLocation('?spaceKey=URL_SPACE');
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

