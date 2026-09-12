import { forgeRequest } from '@/utils/requestUtil'
import type { AdfDoc } from './macroTemplateAdf'

export type TemplateCreateReason = 'forbidden' | 'bad_request' | 'network' | 'unexpected'

export class TemplateCreateError extends Error {
  constructor(public readonly reason: TemplateCreateReason, message: string) {
    super(message)
    this.name = 'TemplateCreateError'
  }
}

/** Creates a space template through the current user's Confluence session. */
export async function createSpaceTemplate({ spaceKey, adf }: { spaceKey: string; adf: AdfDoc }): Promise<void> {
  let response: any
  try {
    response = await forgeRequest('/wiki/rest/api/template', 'POST', {
      name: 'Diagram page',
      templateType: 'page',
      description: 'Start a page with a ZenUML diagram. Created by ZenUML Lite.',
      space: { key: spaceKey },
      body: { atlas_doc_format: { value: JSON.stringify(adf), representation: 'atlas_doc_format' } },
    })
  } catch (error) {
    throw new TemplateCreateError('network', error instanceof Error ? error.message : 'request failed')
  }

  if (typeof response?.statusCode === 'number') {
    const reason = response.statusCode === 403 ? 'forbidden' : response.statusCode === 400 ? 'bad_request' : 'unexpected'
    throw new TemplateCreateError(reason, String(response.message || response.statusCode))
  }
  if (response?.templateId === undefined || response?.templateId === null || String(response.templateId).trim() === '') {
    throw new TemplateCreateError('unexpected', 'template response did not include a templateId')
  }
}
