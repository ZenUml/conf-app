import {setUpWindowLocation} from "../../../tests/SetUpWindowLocation";
import {getClientDomain, getSpaceKey, getSubdomain, isForgeSpaceContextStale, resolveForgeSpace} from "@/utils/ContextParameters/ContextParameters";
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

  describe('page banner iframe after a Confluence SPA navigation', () => {
    const SITE = 'https://example-tenant.atlassian.net';
    const setContext = (type: string, spaceKey: string, path: string | undefined, contentId = '200') => {
      vi.mocked(forgeGlobal).forgeContext = {
        extension: {
          type,
          space: { key: spaceKey, id: '65802' },
          content: { id: contentId },
          location: path === undefined ? undefined : `${SITE}${path}`,
        },
      } as any;
    };

    beforeEach(() => {
      setUpWindowLocation('');
      (window as any).initialContext = undefined;
    });

    it.each([
      ['arrived from an over-limit space', 'SD', '/wiki/spaces/~abc/pages/200/Title', '~abc', true],
      ['arrived from a clean space', '~abc', '/wiki/spaces/SD/pages/200/Title', 'SD', true],
      ['percent-encoded personal key', 'SD', '/wiki/spaces/%7Eabc/pages/200/Title', '~abc', true],
      ['blog post URL', 'SD', '/wiki/spaces/~abc/blog/2026/11/08/200/Title', '~abc', true],
      ['space overview URL', 'SD', '/wiki/spaces/~abc/overview', '~abc', true],
      ['query string on the URL', 'SD', '/wiki/spaces/~abc/pages/200/Title?xpis=abc', '~abc', true],
      ['context already agrees', 'SD', '/wiki/spaces/SD/pages/200/Title', 'SD', false],
      ['case differs only: context spelling is canonical', 'SD', '/wiki/spaces/sd/pages/200/Title', 'SD', false],
      ['URL names another page: it does not describe this content', 'SD', '/wiki/spaces/~abc/pages/999/Title', 'SD', false],
      ['tiny link has no space', 'SD', '/wiki/x/AbCd', 'SD', false],
      ['edit URL is not a trusted shape', 'SD', '/wiki/spaces/~abc/pages/edit-v2/200', 'SD', false],
      ['malformed percent escape', 'SD', '/wiki/spaces/%E0%A4%A/pages/200/Title', 'SD', false],
      ['no location at all', 'SD', undefined, 'SD', false],
    ])('%s', (_name, contextKey, path, expectedKey, expectedStale) => {
      setContext('confluence:pageBanner', contextKey as string, path as string | undefined);
      expect(getSpaceKey()).toBe(expectedKey);
      expect(isForgeSpaceContextStale()).toBe(expectedStale);
    });

    it('drops the context id with a stale key, because that id is the previous space', () => {
      setContext('confluence:pageBanner', 'SD', '/wiki/spaces/~abc/pages/200/Title');
      expect(resolveForgeSpace()).toEqual({ key: '~abc' });
    });

    it('keeps the context space, id included, when the context is right', () => {
      setContext('confluence:pageBanner', 'SD', '/wiki/spaces/SD/pages/200/Title');
      expect(resolveForgeSpace()).toEqual({ key: 'SD', id: '65802' });
    });

    it('leaves macro iframes on their own context, which was measured correct', () => {
      setContext('xhtml', 'SD', '/wiki/spaces/~abc/pages/200/Title');
      expect(getSpaceKey()).toBe('SD');
      expect(isForgeSpaceContextStale()).toBe(false);
      expect(resolveForgeSpace()).toEqual({ key: 'SD', id: '65802' });
    });
  });

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
