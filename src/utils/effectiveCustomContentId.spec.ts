import { describe, it, expect } from 'vitest'
import { resolveEffectiveCustomContentId } from './effectiveCustomContentId'

const CLOUD = 'bc8bb5b3-09d2-4932-b68c-9b56fab8e34a'
const typed = (type: string, id: string, cloud = CLOUD) =>
  `https://confluence.zenuml.com/d/${type}/${cloud}/${id}`

describe('resolveEffectiveCustomContentId', () => {
  it('prefers the saved macro config', () => {
    expect(
      resolveEffectiveCustomContentId({
        cloudId: CLOUD,
        extension: {
          config: { customContentId: 'config-id' },
          modal: { customContentId: 'modal-id' },
          parameters: { autoConvertLink: typed('graph', 'link-id') },
        },
      }),
    ).toBe('config-id')
  })

  it('falls back to a modal id for a non-macro surface', () => {
    expect(
      resolveEffectiveCustomContentId({
        extension: { modal: { customContentId: 'modal-id' } },
      }),
    ).toBe('modal-id')
  })

  it('resolves a pasted graph link — the case that rendered an empty canvas', () => {
    // A graph macro created by autoConvert has no config at all. Reading only
    // config left the editor treating it as a brand-new diagram, so it opened
    // empty and stayed empty after editing.
    expect(
      resolveEffectiveCustomContentId({
        cloudId: CLOUD,
        extension: { parameters: { autoConvertLink: typed('graph', '425987') } },
      }),
    ).toBe('425987')
  })

  it('resolves a pasted link from any of the context shapes autoConvert uses', () => {
    for (const extension of [
      { config: { autoConvertLink: typed('openapi', '1') } },
      { autoConvertLink: typed('openapi', '1') },
      { parameters: { autoConvertLink: typed('openapi', '1') } },
    ]) {
      expect(resolveEffectiveCustomContentId({ cloudId: CLOUD, extension })).toBe('1')
    }
  })

  it('refuses a link from another site', () => {
    expect(
      resolveEffectiveCustomContentId({
        cloudId: CLOUD,
        extension: { parameters: { autoConvertLink: typed('graph', '9', 'other-cloud') } },
      }),
    ).toBeUndefined()
  })

  it('ignores the legacy 3-segment embed form — only the embed macro handles it', () => {
    expect(
      resolveEffectiveCustomContentId({
        cloudId: CLOUD,
        extension: { parameters: { autoConvertLink: `https://confluence.zenuml.com/d/${CLOUD}/9` } },
      }),
    ).toBeUndefined()
  })

  it('is undefined for a brand-new macro with nothing to load', () => {
    expect(resolveEffectiveCustomContentId({ extension: {} })).toBeUndefined()
    expect(resolveEffectiveCustomContentId({})).toBeUndefined()
    expect(resolveEffectiveCustomContentId(undefined)).toBeUndefined()
  })
})

// The attachment path (src/model/Attachment.ts) resolves the backup PNG's name
// AND its own run/skip guard through this function. Before it did, both read
// `extension.config.customContentId` raw, so a macro placed by pasting a typed
// deeplink — which has no config — produced `undefined`, the guard bailed, and
// the view-time backfill never wrote `zenuml-<id>.png` on the page the macro
// actually sits on. Downstream that surfaces as PDF/Word export failing with
// attachment_not_found, long after the paste.
describe('resolveEffectiveCustomContentId — attachment naming', () => {
  const CLOUD_ID = 'bc8bb5b3-09d2-4932-b68c-9b56fab8e34a'
  const name = (ctx: any) => {
    const id = resolveEffectiveCustomContentId(ctx)
    return id ? `zenuml-${id}.png` : undefined
  }

  it('names the backup after the pasted link when there is no config', () => {
    expect(
      name({
        cloudId: CLOUD_ID,
        extension: {
          parameters: {
            autoConvertLink: `https://confluence.zenuml.com/d/sequence/${CLOUD_ID}/703430669`,
          },
        },
      }),
    ).toBe('zenuml-703430669.png')
  })

  it('never yields zenuml-undefined.png for a pasted macro', () => {
    const n = name({
      cloudId: CLOUD_ID,
      extension: {
        parameters: { autoConvertLink: `https://confluence.zenuml.com/d/graph/${CLOUD_ID}/42` },
      },
    })
    expect(n).not.toContain('undefined')
  })

  it('a foreign-site link still yields no name — better none than a colliding one', () => {
    expect(
      name({
        cloudId: CLOUD_ID,
        extension: {
          parameters: {
            autoConvertLink: 'https://confluence.zenuml.com/d/sequence/other-cloud-id/42',
          },
        },
      }),
    ).toBeUndefined()
  })
})
