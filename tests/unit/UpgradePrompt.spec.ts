import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('@/utils/upgradeTracking', () => ({
  trackUpgradeEvent: vi.fn(),
  UpgradeEventName: {
    MODAL_SHOWN: 'upgrade_modal_shown',
    MODAL_DISMISSED: 'upgrade_modal_dismissed',
    PAYWALL_CONTINUED_EDITING: 'paywall_continued_editing',
    PAYWALL_CONTINUE_USED: 'paywall_continue_used',
    PAYWALL_ATTEMPTS_EXHAUSTED: 'paywall_attempts_exhausted',
    ADVOCACY_MESSAGE_COPIED: 'advocacy_message_copied',
    ADVOCACY_DRAFT_PREVIEW_CLICKED: 'advocacy_draft_preview_clicked',
    EXTENSION_REQUEST_CLICKED: 'extension_request_clicked',
    PAYWALL_SURVEY_SHOWN: 'paywall_survey_shown',
    PAYWALL_SURVEY_ANSWERED: 'paywall_survey_answered',
    PAYWALL_SURVEY_SUBMITTED: 'paywall_survey_submitted',
    PAYWALL_SURVEY_SKIPPED: 'paywall_survey_skipped',
  },
  UIComponent: {
    MODAL: 'modal',
  },
}))

const { markSpacePaid } = vi.hoisted(() => ({ markSpacePaid: vi.fn() }))

vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }))

vi.mock('@/composables/useCustomerSuccessService', () => ({
  useCustomerSuccessService: () => ({
    spaceKey: ref('engineering-architecture'),
    markSpacePaid,
  }),
  getUpgradeContext: () => ({
    macro_count: 100,
    macro_limit: 100,
    macro_usage_pct: 100,
    space_key: 'engineering-architecture',
  }),
}))

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: {
    isForge: false,
    forgeContext: {
      accountId: 'account-123',
      extension: {
        content: { id: 'page-456' },
      },
    },
  },
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

import UpgradePrompt from '@/components/UpgradePrompt/UpgradePrompt.vue'
import { trackUpgradeEvent } from '@/utils/upgradeTracking'
import { openUrl } from '@/model/globals/forgeGlobal'
import { callRemote } from '@/utils/requestUtil'

/** Fill the pricing survey to the point where Submit is enabled. */
async function completeSurvey() {
  const set = (testId: string, value?: string) => {
    const el = document.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement
    if (value !== undefined) el.value = value
    else el.checked = true
    el.dispatchEvent(new Event(value !== undefined ? 'input' : 'change'))
  }
  set('survey-role-editor')
  set('survey-price-too-cheap', '50')
  set('survey-price-bargain', '200')
  set('survey-price-expensive', '600')
  set('survey-price-too-expensive', '1500')
  set('survey-unit-most-per_space_year')
  set('survey-unit-least-per_diagram')
  set('survey-blocker-budget')
  await new Promise((r) => setTimeout(r, 0))
}

const baseProps = {
  visible: true,
  macrosCreated: 105,
  macrosLimit: 100,
  upgradeUrl: 'https://marketplace.example/upgrade',
  enterpriseBundleUrl: 'https://stripe.example/bundle',
}

describe('UpgradePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('tracks upgrade_modal_shown when mounted already visible', () => {
    const wrapper = mount(UpgradePrompt, {
      props: baseProps,
      attachTo: document.body,
    })

    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'upgrade_modal_shown',
      expect.objectContaining({
        trigger_source: 'header_badge',
        macro_count: 100,
      })
    )

    wrapper.unmount()
  })

  it('draft card is collapsed by default and shows the toggle button', () => {
    const wrapper = mount(UpgradePrompt, {
      props: baseProps,
      attachTo: document.body,
    })

    expect(document.querySelector('[data-testid="advocacy-draft-body"]')).toBeNull()
    const toggle = document.querySelector('[data-testid="draft-toggle-btn"]') as HTMLButtonElement
    expect(toggle).toBeTruthy()
    expect(toggle.textContent).toContain('Preview the draft before you copy')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    wrapper.unmount()
  })

  it('renders the draft card with interpolated values after expanding the toggle', async () => {
    const wrapper = mount(UpgradePrompt, {
      props: baseProps,
      attachTo: document.body,
    })

    const toggle = document.querySelector('[data-testid="draft-toggle-btn"]') as HTMLButtonElement
    toggle.click()
    await Promise.resolve()

    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'advocacy_draft_preview_clicked',
      expect.objectContaining({
        ui_component: 'modal',
        expanded: true,
        macro_count: 100,
      })
    )

    const draftBody = document.querySelector('[data-testid="advocacy-draft-body"]') as HTMLElement
    expect(draftBody).toBeTruthy()
    expect(draftBody.textContent).toContain('engineering-architecture')
    expect(draftBody.textContent).toContain('105')
    expect(draftBody.textContent).toContain('100 macros')
    expect(draftBody.textContent).toContain('https://marketplace.example/upgrade')
    expect(draftBody.textContent).toContain('https://stripe.example/bundle')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    wrapper.unmount()
  })

  it('tracks advocacy_draft_preview_clicked with expanded false when collapsing the draft', async () => {
    const wrapper = mount(UpgradePrompt, {
      props: baseProps,
      attachTo: document.body,
    })

    const toggle = document.querySelector('[data-testid="draft-toggle-btn"]') as HTMLButtonElement
    toggle.click()
    await Promise.resolve()
    vi.mocked(trackUpgradeEvent).mockClear()

    toggle.click()
    await Promise.resolve()

    expect(trackUpgradeEvent).toHaveBeenCalledTimes(1)
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'advocacy_draft_preview_clicked',
      expect.objectContaining({
        ui_component: 'modal',
        expanded: false,
        macro_count: 100,
      })
    )

    wrapper.unmount()
  })

  it('copies the templated message to the clipboard on advocacy button click and fires advocacy_message_copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })

    const wrapper = mount(UpgradePrompt, {
      props: baseProps,
      attachTo: document.body,
    })

    const button = document.querySelector('[data-testid="advocacy-copy-btn"]') as HTMLButtonElement
    expect(button).toBeTruthy()
    expect(button.textContent).toContain('Copy upgrade request')

    button.click()
    await new Promise((r) => setTimeout(r, 0))

    expect(writeText).toHaveBeenCalledTimes(1)
    const copiedMessage = writeText.mock.calls[0][0]
    expect(copiedMessage).toContain('engineering-architecture')
    expect(copiedMessage).toContain('105 of 100 macros')
    expect(copiedMessage).toContain('https://marketplace.example/upgrade')
    expect(copiedMessage).toContain('https://stripe.example/bundle')
    expect(copiedMessage).toContain('$299/yr/space')
    expect(copiedMessage).toContain('ZenUML for Confluence Lite')

    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'advocacy_message_copied',
      expect.objectContaining({
        ui_component: 'modal',
        macro_count: 100,
        space_key: 'engineering-architecture',
      })
    )

    wrapper.unmount()
  })

  it('shows copied state for 2 seconds then reverts to default', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })

    const wrapper = mount(UpgradePrompt, {
      props: baseProps,
      attachTo: document.body,
    })

    const button = () =>
      document.querySelector('[data-testid="advocacy-copy-btn"]') as HTMLButtonElement
    button().click()
    // Allow the async clipboard promise to resolve.
    await vi.advanceTimersByTimeAsync(0)

    expect(button().textContent).toContain('Copied')

    await vi.advanceTimersByTimeAsync(2000)
    expect(button().textContent).toContain('Copy upgrade request')

    wrapper.unmount()
  })

  it('falls back to the manual textarea when clipboard write fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    // Simulate execCommand also failing.
    document.execCommand = vi.fn().mockReturnValue(false)

    const wrapper = mount(UpgradePrompt, {
      props: baseProps,
      attachTo: document.body,
    })

    const button = document.querySelector('[data-testid="advocacy-copy-btn"]') as HTMLButtonElement
    button.click()
    await new Promise((r) => setTimeout(r, 0))

    const fallback = document.querySelector(
      '[data-testid="advocacy-fallback-textarea"]'
    ) as HTMLTextAreaElement
    expect(fallback).toBeTruthy()
    expect(fallback.value).toContain('engineering-architecture')

    // Tracking event should NOT fire on failure.
    const advocacyCalls = (trackUpgradeEvent as any).mock.calls.filter(
      (c: unknown[]) => c[0] === 'advocacy_message_copied'
    )
    expect(advocacyCalls.length).toBe(0)

    wrapper.unmount()
  })

  it('emits continueEditing and tracks paywall_continued_editing on footer button click', async () => {
    const wrapper = mount(UpgradePrompt, {
      props: baseProps,
      attachTo: document.body,
    })

    const continueButton = document.querySelector(
      '[data-testid="continue-editing-btn"]'
    ) as HTMLButtonElement
    continueButton.click()
    await Promise.resolve()

    expect(trackUpgradeEvent).toHaveBeenCalledWith('paywall_continued_editing')
    expect(wrapper.emitted('continueEditing')).toBeTruthy()

    wrapper.unmount()
  })

  it('shows the remaining continue attempts when attempts are enforced', () => {
    const wrapper = mount(UpgradePrompt, {
      props: {
        ...baseProps,
        remainingContinueAttempts: 15,
      },
      attachTo: document.body,
    })

    const continueButton = document.querySelector(
      '[data-testid="continue-editing-btn"]'
    ) as HTMLButtonElement
    expect(continueButton).toBeTruthy()
    expect(continueButton.textContent).toContain('Continue editing without upgrading (15)')
    expect(continueButton.getAttribute('title')).toContain(
      'You have 15 temporary continue attempts left before editing is blocked for you in this space.'
    )

    wrapper.unmount()
  })

  it('removes continue editing when continue attempts are exhausted', () => {
    const wrapper = mount(UpgradePrompt, {
      props: {
        ...baseProps,
        remainingContinueAttempts: 0,
      },
      attachTo: document.body,
    })

    const exhaustedCopy = document.querySelector(
      '[data-testid="continue-attempts-exhausted"]'
    ) as HTMLElement
    expect(exhaustedCopy.textContent).toContain('Request extension to continue editing')
    expect(exhaustedCopy.textContent).not.toContain('(0)')
    expect(exhaustedCopy.getAttribute('title')).toContain(
      'No continue attempts remain. Request an extension or upgrade to keep editing.'
    )
    expect(document.querySelector('[data-testid="continue-editing-btn"]')).toBeNull()
    expect(document.querySelector('[data-testid="request-extension-btn"]')).toBeTruthy()
    expect(document.querySelector('[data-testid="advocacy-copy-btn"]')).toBeTruthy()

    wrapper.unmount()
  })

  it('tracks continue attempt usage and exhaustion when the last attempt is used', async () => {
    const wrapper = mount(UpgradePrompt, {
      props: {
        ...baseProps,
        remainingContinueAttempts: 1,
        actionType: 'page_editor',
      },
      attachTo: document.body,
    })

    const continueButton = document.querySelector(
      '[data-testid="continue-editing-btn"]'
    ) as HTMLButtonElement
    continueButton.click()
    await Promise.resolve()

    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_continue_used',
      expect.objectContaining({
        action_type: 'page_editor',
        remaining_attempts_before: 1,
        remaining_attempts_after: 0,
        storage_source: 'local_storage',
      })
    )
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_attempts_exhausted',
      expect.objectContaining({
        action_type: 'page_editor',
        remaining_attempts_before: 1,
        remaining_attempts_after: 0,
        storage_source: 'local_storage',
      })
    )
    expect(wrapper.emitted('continueEditing')).toBeTruthy()

    wrapper.unmount()
  })

  it('shows the pricing survey instead of opening support, and asks before handing off', async () => {
    const wrapper = mount(UpgradePrompt, {
      props: baseProps,
      attachTo: document.body,
    })

    const button = document.querySelector('[data-testid="request-extension-btn"]') as HTMLButtonElement
    button.click()
    await new Promise((r) => setTimeout(r, 0))

    expect(document.querySelector('[data-testid="paywall-survey"]')).toBeTruthy()
    // The survey is the price of the extension, so it must be asked BEFORE
    // the hand-off: a user already on the service desk never comes back for it.
    expect(openUrl).not.toHaveBeenCalled()
    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_survey_shown',
      expect.objectContaining({ ui_component: 'modal', survey_reward_days: 15 })
    )
    // The modal body is replaced, not stacked on top of the purchase rails.
    expect(document.querySelector('[data-testid="unlock-space-btn"]')).toBeNull()

    wrapper.unmount()
  })

  it('returns to the main body from the survey Back link', async () => {
    const wrapper = mount(UpgradePrompt, {
      props: baseProps,
      attachTo: document.body,
    })

    ;(document.querySelector('[data-testid="request-extension-btn"]') as HTMLButtonElement).click()
    await new Promise((r) => setTimeout(r, 0))
    ;(document.querySelector('[data-testid="survey-back-btn"]') as HTMLButtonElement).click()
    await new Promise((r) => setTimeout(r, 0))

    expect(document.querySelector('[data-testid="paywall-survey"]')).toBeNull()
    expect(document.querySelector('[data-testid="unlock-space-btn"]')).toBeTruthy()

    wrapper.unmount()
  })

  it('skipping the survey runs the old support flow, carrying the survey id', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const wrapper = mount(UpgradePrompt, {
      props: baseProps,
      attachTo: document.body,
    })

    ;(document.querySelector('[data-testid="request-extension-btn"]') as HTMLButtonElement).click()
    await new Promise((r) => setTimeout(r, 0))
    ;(document.querySelector('[data-testid="survey-skip-btn"]') as HTMLButtonElement).click()
    await new Promise((r) => setTimeout(r, 0))

    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'paywall_survey_skipped',
      expect.objectContaining({ ui_component: 'modal' })
    )

    expect(writeText).toHaveBeenCalledTimes(1)
    const copiedMessage = writeText.mock.calls[0][0]
    expect(copiedMessage).toContain('Request: Temporary Lite editing extension')
    expect(copiedMessage).toContain('Space key: engineering-architecture')
    expect(copiedMessage).toContain('Macro count: 105')
    expect(copiedMessage).toContain('Limit: 100')
    expect(copiedMessage).toContain('User account ID: account-123')
    expect(copiedMessage).toContain('Page ID: page-456')
    expect(copiedMessage).toContain('Survey ID: ')

    expect(trackUpgradeEvent).toHaveBeenCalledWith(
      'extension_request_clicked',
      expect.objectContaining({
        ui_component: 'modal',
        copied_request_details: true,
        request_url: expect.stringContaining(
          'https://zenuml.atlassian.net/servicedesk/customer/portal/1/group/1/create/9?'
        ),
        macro_count: 100,
        space_key: 'engineering-architecture',
      })
    )
    const openedUrl = new URL(vi.mocked(openUrl).mock.calls[0][0] as string)
    expect(`${openedUrl.origin}${openedUrl.pathname}`).toBe(
      'https://zenuml.atlassian.net/servicedesk/customer/portal/1/group/1/create/9'
    )
    expect(openedUrl.searchParams.get('description')).toBe(copiedMessage)
    expect(openedUrl.searchParams.get('description')).toContain('Survey ID: ')
    expect(openedUrl.searchParams.get('customfield_10070')).toBe('10037')

    // Back on the main body, with the same status line as before the survey.
    expect(document.querySelector('[data-testid="paywall-survey"]')).toBeNull()
    const status = document.querySelector('[data-testid="request-extension-status"]') as HTMLElement
    expect(status.textContent).toContain('pre-filled')

    wrapper.unmount()
  })

  it('a granted survey marks the space paid and unlocks without spending an attempt', async () => {
    vi.mocked(callRemote).mockResolvedValue({
      ok: true,
      responseId: 'r-1',
      submitted: true,
      grant: 'granted',
      expiresAt: '2026-09-18T00:00:00.000Z',
    })

    const wrapper = mount(UpgradePrompt, {
      props: { ...baseProps, remainingContinueAttempts: 3 },
      attachTo: document.body,
    })

    ;(document.querySelector('[data-testid="request-extension-btn"]') as HTMLButtonElement).click()
    await new Promise((r) => setTimeout(r, 0))
    await completeSurvey()
    ;(document.querySelector('[data-testid="survey-submit-btn"]') as HTMLButtonElement).click()
    await new Promise((r) => setTimeout(r, 0))

    expect(markSpacePaid).toHaveBeenCalledWith('user_license')
    const unlocked = document.querySelector('[data-testid="survey-unlocked"]') as HTMLElement
    expect(unlocked).toBeTruthy()
    expect(unlocked.textContent).toContain('engineering-architecture')
    expect(unlocked.textContent).toContain('refresh the page')
    expect(unlocked.textContent).toContain(new Date('2026-09-18T00:00:00.000Z').toLocaleDateString())
    // The footer's attempt-spending control is gone on this step.
    expect(document.querySelector('[data-testid="continue-editing-btn"]')).toBeNull()

    ;(document.querySelector('[data-testid="survey-continue-btn"]') as HTMLButtonElement).click()
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.emitted('unlocked')).toHaveLength(1)
    expect(wrapper.emitted('continueEditing')).toBeFalsy()

    wrapper.unmount()
  })

  it('a repeat survey submit says the extension was already used and points at support', async () => {
    vi.mocked(callRemote).mockResolvedValue({
      ok: true,
      responseId: 'r-2',
      submitted: true,
      grant: 'already_granted',
    })

    const wrapper = mount(UpgradePrompt, {
      props: baseProps,
      attachTo: document.body,
    })

    ;(document.querySelector('[data-testid="request-extension-btn"]') as HTMLButtonElement).click()
    await new Promise((r) => setTimeout(r, 0))
    await completeSurvey()
    ;(document.querySelector('[data-testid="survey-submit-btn"]') as HTMLButtonElement).click()
    await new Promise((r) => setTimeout(r, 0))

    expect(markSpacePaid).not.toHaveBeenCalled()
    const panel = document.querySelector('[data-testid="survey-already-granted"]') as HTMLElement
    expect(panel.textContent).toContain('already used the survey extension for this space')

    ;(panel.querySelector('[data-testid="survey-support-btn"]') as HTMLButtonElement).click()
    await new Promise((r) => setTimeout(r, 0))

    const openedUrl = new URL(vi.mocked(openUrl).mock.calls[0][0] as string)
    expect(openedUrl.searchParams.get('description')).toContain('Survey ID: ')

    wrapper.unmount()
  })
})
