import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forgeRequest } from '@/utils/requestUtil'
import { createSpaceTemplate } from './createSpaceTemplate'

vi.mock('@/utils/requestUtil', () => ({ forgeRequest: vi.fn() }))

const adf = { version: 1 as const, type: 'doc' as const, content: [] }

beforeEach(() => vi.mocked(forgeRequest).mockReset())

describe('createSpaceTemplate', () => {
  it('posts the instance-free ADF to the current user’s space-template API', async () => {
    vi.mocked(forgeRequest).mockResolvedValue({ templateId: 'tenant-specific-id' })
    await expect(createSpaceTemplate({ spaceKey: 'ENG', adf })).resolves.toBeUndefined()
    expect(forgeRequest).toHaveBeenCalledWith('/wiki/rest/api/template', 'POST', expect.objectContaining({
      space: { key: 'ENG' }, templateType: 'page', body: { atlas_doc_format: expect.objectContaining({ representation: 'atlas_doc_format' }) },
    }))
  })

  it('turns a Confluence permission denial into a typed forbidden failure', async () => {
    vi.mocked(forgeRequest).mockResolvedValue({ statusCode: 403, message: 'denied' })
    await expect(createSpaceTemplate({ spaceKey: 'ENG', adf })).rejects.toMatchObject({ reason: 'forbidden' })
  })

})
