import type { FeedbackContext, FeedbackSurface } from './feedbackSession'

export function storyFeedbackContext(surface: FeedbackSurface): FeedbackContext {
  const global = surface === 'dashboard' || surface === 'get_started'
  return {
    surface,
    hostModule: global ? `zenuml-${surface}` : 'zenuml-mermaid-macro-lite',
    diagramType: global ? 'not_applicable' : 'mermaid',
    diagramTitle: global ? 'not_applicable' : 'Architecture overview',
    userAccountId: 'account-example',
    clientDomain: 'example-tenant',
    spaceName: global ? 'not_applicable' : 'Example space',
    macroUuid: global ? 'not_applicable' : 'macro-example',
    contentId: global ? 'not_applicable' : 'content-example',
    customContentId: global ? 'not_applicable' : 'custom-content-example',
  }
}

export const storySubmit = async () => ({ reportReference: 'FBR-EXAMPLE1234' })
export const storyBlockedHandoff = async () => ({
  opened: false,
  manualUrl: 'https://zenuml.atlassian.net/servicedesk/customer/portal/1/group/1/create/1?summary=FBR-EXAMPLE1234',
})
