import { openUrl } from '@/model/globals/forgeGlobal'
import { callRemote } from '@/utils/requestUtil'
import type { FeedbackReportPayload } from './feedbackSession'

export const DEFAULT_FEEDBACK_SUPPORT_URL =
  'https://zenuml.atlassian.net/servicedesk/customer/portal/1/group/1/create/1'

export function buildFeedbackSupportUrl(reportReference: string): string {
  const summary = `Continue feedback conversation — ${reportReference}`
  const description = [
    `Internal feedback reference: ${reportReference}`,
    '',
    'Your feedback has already been saved. Submit this form only if you would like a reply from our team.',
  ].join('\n')
  const params = new URLSearchParams({ summary, description })
  const base = import.meta.env.VITE_FEEDBACK_SUPPORT_URL || DEFAULT_FEEDBACK_SUPPORT_URL
  return `${base}?${params.toString()}`
}

function parseResponse(raw: unknown): { reportReference: string } {
  const body = typeof raw === 'string' ? JSON.parse(raw) : raw
  const reportReference = (body as any)?.reportReference
  if (typeof reportReference !== 'string' || !reportReference.startsWith('FBR-')) {
    throw new Error('FeedbackSaveResponseError')
  }
  return { reportReference }
}

export function createFeedbackTransport(deps: {
  callRemote: typeof callRemote
  open: typeof openUrl
} = { callRemote, open: openUrl }) {
  return {
    async submit(payload: FeedbackReportPayload & { submissionId: string }) {
      return parseResponse(await deps.callRemote('/api/feedback-report', 'POST', payload))
    },
    async handoff(reportReference: string) {
      const manualUrl = buildFeedbackSupportUrl(reportReference)
      try {
        await deps.open(manualUrl)
        return { opened: true, manualUrl }
      } catch {
        return { opened: false, manualUrl }
      }
    },
  }
}
