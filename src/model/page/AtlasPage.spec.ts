import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtlasPage } from '@/model/page/AtlasPage';

const CLOUD_ID = '866c3a03-ec62-4717-91c4-1ad078bfcc60';

const forgeGlobalMock = vi.hoisted(() => ({
  isForge: true,
  forgeContext: {
    cloudId: '866c3a03-ec62-4717-91c4-1ad078bfcc60',
    extension: { content: { id: 'page-1' } },
  } as any,
}));
vi.mock('@/model/globals/forgeGlobal', () => ({ default: forgeGlobalMock }));

const forgeRequest = vi.hoisted(() => vi.fn());
vi.mock('@/utils/requestUtil', () => ({ forgeRequest }));

/** One Forge macro node, with whatever parameter shape the case needs. */
const macro = (parameters: any) => ({
  type: 'extension',
  attrs: {
    extensionType: 'com.atlassian.ecosystem',
    extensionKey: 'app/env/static/zenuml-sequence-macro-lite',
    parameters,
  },
});

const page = (...macros: any[]) => ({
  body: { atlas_doc_format: { value: JSON.stringify({ type: 'doc', content: macros }) } },
});

describe('AtlasPage.referencedCustomContentIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    forgeGlobalMock.forgeContext = {
      cloudId: CLOUD_ID,
      extension: { content: { id: 'page-1' } },
    };
  });

  it('reads a saved macro through guestParams', () => {
    forgeRequest.mockResolvedValue(page(macro({ guestParams: { customContentId: '111' } })));
    return expect(new AtlasPage().referencedCustomContentIds()).resolves.toEqual(['111']);
  });

  it('follows a pasted macro through autoConvertLink', async () => {
    // Reported from whimet4 on 2026-08-14: a diagram pasted onto a page and
    // published still showed as "not on this page". A macro created by pasting
    // a deeplink carries ONLY autoConvertLink until its first save writes the
    // binding — no guestParams at all — which is exactly the macro the byline's
    // own create→paste flow produces.
    forgeRequest.mockResolvedValue(
      page(
        macro({
          layout: 'block',
          hasBeenAutoConverted: true,
          autoConvertLink: `https://confluence.zenuml.com/d/mermaid/${CLOUD_ID}/706314242`,
        }),
      ),
    );

    await expect(new AtlasPage().referencedCustomContentIds()).resolves.toEqual(['706314242']);
  });

  it('follows the untyped embed form of the link too', async () => {
    forgeRequest.mockResolvedValue(
      page(macro({ autoConvertLink: `https://conf-lite.zenuml.com/d/${CLOUD_ID}/222` })),
    );

    await expect(new AtlasPage().referencedCustomContentIds()).resolves.toEqual(['222']);
  });

  it('ignores a link pasted from another site', async () => {
    // Content ids are per-site integers, so a foreign link would otherwise mark
    // whichever local diagram shares that number as placed.
    forgeRequest.mockResolvedValue(
      page(
        macro({
          autoConvertLink: 'https://confluence.zenuml.com/d/mermaid/11111111-2222-3333-4444-555555555555/706314242',
        }),
      ),
    );

    await expect(new AtlasPage().referencedCustomContentIds()).resolves.toEqual([]);
  });

  it('keeps document order and keeps duplicates', async () => {
    forgeRequest.mockResolvedValue(
      page(
        macro({ guestParams: { customContentId: 'b' } }),
        macro({ autoConvertLink: `https://confluence.zenuml.com/d/sequence/${CLOUD_ID}/9` }),
        macro({ guestParams: { customContentId: 'b' } }),
      ),
    );

    // Order is the point — the byline lists diagrams the way the page reads —
    // and the repeat is a copied macro the caller decides what to do with.
    await expect(new AtlasPage().referencedCustomContentIds()).resolves.toEqual(['b', '9', 'b']);
  });

  it('prefers the saved binding over a stale link on the same macro', async () => {
    forgeRequest.mockResolvedValue(
      page(
        macro({
          guestParams: { customContentId: '111' },
          autoConvertLink: `https://confluence.zenuml.com/d/mermaid/${CLOUD_ID}/999`,
        }),
      ),
    );

    await expect(new AtlasPage().referencedCustomContentIds()).resolves.toEqual(['111']);
  });

  it('says "unknown" rather than "none" when the page cannot be read', async () => {
    // An empty array would tell the byline every diagram is unplaced.
    forgeRequest.mockResolvedValue(undefined);
    await expect(new AtlasPage().referencedCustomContentIds()).resolves.toBeUndefined();
  });
});
