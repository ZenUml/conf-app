import type {
  AnalyticsEventName,
  FeedbackCaptureMethod,
  FeedbackDismissReason,
  MacroTypeValue,
  Surface,
} from '@/utils/analytics/catalog'
import type { AnalyticsProperties } from '@/utils/analytics/types'

export type FeedbackSurface = Extract<Surface, 'viewer' | 'editor' | 'fullscreen' | 'png_export' | 'get_started' | 'dashboard'>

export interface FeedbackContext {
  surface: FeedbackSurface
  hostModule: string
  diagramType: MacroTypeValue | 'not_applicable' | 'unavailable'
  diagramTitle: string
  userAccountId: string
  clientDomain: string
  spaceName: string
  macroUuid: string
  contentId: string
  customContentId: string
}

export interface FeedbackScreenshot {
  dataUrl: string
  name: string
  method: FeedbackCaptureMethod
}

export interface FeedbackReportPayload {
  description: string
  context: FeedbackContext
  screenshot?: FeedbackScreenshot
}

type Track = (name: AnalyticsEventName, properties: AnalyticsProperties) => void
type Submit = (payload: FeedbackReportPayload & { submissionId: string }) => Promise<{ reportReference: string }>
type Handoff = (reportReference: string) => Promise<{ opened: boolean, manualUrl?: string }>

export type FeedbackSubmissionState = 'idle' | 'submitting' | 'succeeded' | 'failed'

export function createFeedbackSession({ context, submit, handoff, track }: {
  context: FeedbackContext
  submit: Submit
  handoff?: Handoff
  track: Track
}) {
  const submissionId = crypto.randomUUID()
  let description = ''
  let screenshot: FeedbackScreenshot | undefined
  let submissionState: FeedbackSubmissionState = 'idle'
  let errorMessage = ''
  let reportReference = ''
  let manualSupportUrl = ''

  const analyticsProps = (): AnalyticsProperties => ({
    feature_area: 'feedback',
    surface: context.surface,
    host_module: context.hostModule,
    macro_type: context.diagramType === 'not_applicable' || context.diagramType === 'unavailable'
      ? 'none'
      : context.diagramType,
  })

  return {
    get description() { return description },
    get screenshot() { return screenshot },
    get submissionState() { return submissionState },
    get errorMessage() { return errorMessage },
    get reportReference() { return reportReference },
    get manualSupportUrl() { return manualSupportUrl },
    open() {
      track('feedback_report_opened', analyticsProps())
    },
    setDescription(value: string) { description = value },
    async capture(method: FeedbackCaptureMethod, work: () => Promise<FeedbackScreenshot>) {
      track('feedback_report_capture_requested', {
        ...analyticsProps(),
        feedback_capture_method: method,
      })
      try {
        screenshot = await work()
        track('feedback_report_capture_succeeded', {
          ...analyticsProps(),
          feedback_capture_method: method,
        })
        return true
      } catch (error) {
        track('feedback_report_capture_failed', {
          ...analyticsProps(),
          feedback_capture_method: method,
          failure_reason: error instanceof Error ? error.name : 'unknown_error',
        })
        return false
      }
    },
    setScreenshot(value: FeedbackScreenshot) { screenshot = value },
    removeScreenshot() {
      const method = screenshot?.method
      screenshot = undefined
      track('feedback_report_capture_removed', {
        ...analyticsProps(),
        ...(method ? { feedback_capture_method: method } : {}),
      })
    },
    dismiss(reason: FeedbackDismissReason) {
      track('feedback_report_dismissed', {
        ...analyticsProps(),
        feedback_dismiss_reason: reason,
        feedback_has_screenshot: !!screenshot,
      })
    },
    async submit() {
      const trimmed = description.trim()
      if (!trimmed) {
        errorMessage = 'Describe what happened before sending.'
        return false
      }
      submissionState = 'submitting'
      errorMessage = ''
      const payload: FeedbackReportPayload = {
        submissionId,
        description,
        context,
        ...(screenshot ? { screenshot } : {}),
      }
      const props = {
        ...analyticsProps(),
        feedback_has_screenshot: !!screenshot,
      }
      track('feedback_report_submit_requested', props)
      try {
        const saved = await submit(payload)
        reportReference = saved.reportReference
        submissionState = 'succeeded'
        track('feedback_report_submit_succeeded', props)
        if (handoff) {
          track('feedback_report_handoff_requested', props)
          try {
            const transition = await handoff(reportReference)
            manualSupportUrl = transition.manualUrl ?? ''
            track(transition.opened ? 'feedback_report_handoff_opened' : 'feedback_report_handoff_blocked', {
              ...props,
              feedback_handoff_outcome: transition.opened ? 'opened' : 'blocked',
            })
          } catch {
            track('feedback_report_handoff_blocked', {
              ...props,
              feedback_handoff_outcome: 'failed',
            })
          }
        }
        return true
      } catch (error) {
        submissionState = 'failed'
        errorMessage = 'Feedback could not be sent. Please try again.'
        track('feedback_report_submit_failed', {
          ...props,
          failure_reason: error instanceof Error ? error.name : 'unknown_error',
        })
        return false
      }
    },
  }
}
