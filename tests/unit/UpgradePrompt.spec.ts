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
    EXTENSION_FORM_VIEWED: 'extension_form_viewed',
    EXTENSION_FORM_SUBMITTED: 'extension_form_submitted',
    EXTENSION_FORM_FAILED: 'extension_form_failed',
  },
  UIComponent: {
    MODAL: 'modal',
  },
}))

vi.mock('@/utils/requestUtil', () => ({
  callRemote: vi.fn(),
}))

vi.mock('@/composables/useCustomerSuccessService', () => ({
  useCustomerSuccessService: () => ({
    spaceKey: ref('engineering-architecture'),
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

  describe('in-app extension request form', () => {
    function expandForm() {
      const button = document.querySelector('[data-testid="request-extension-btn"]') as HTMLButtonElement
      button.click()
    }

    async function fillAndSubmit(email: string) {
      const input = document.querySelector('[data-testid="extension-email-input"]') as HTMLInputElement
      input.value = email
      input.dispatchEvent(new Event('input'))
      await new Promise((r) => setTimeout(r, 0))
      const form = document.querySelector('[data-testid="extension-request-form"]') as HTMLFormElement
      form.dispatchEvent(new Event('submit'))
      await new Promise((r) => setTimeout(r, 0))
    }

    beforeEach(() => {
      localStorage.removeItem('extensionRequestEmail')
    })

    it('expands the form and tracks extension_form_viewed', async () => {
      const wrapper = mount(UpgradePrompt, {
        props: { ...baseProps, actionType: 'page_editor' },
        attachTo: document.body,
      })

      expandForm()
      await new Promise((r) => setTimeout(r, 0))

      expect(document.querySelector('[data-testid="extension-request-form"]')).toBeTruthy()
      expect(trackUpgradeEvent).toHaveBeenCalledWith(
        'extension_form_viewed',
        expect.objectContaining({
          action_type: 'page_editor',
          ui_component: 'modal',
          space_key: 'engineering-architecture',
        })
      )

      wrapper.unmount()
    })

    it('submits the request to the backend, shows success, and caches the email', async () => {
      vi.mocked(callRemote).mockResolvedValue({ issueKey: 'ZEN-123' })

      const wrapper = mount(UpgradePrompt, {
        props: baseProps,
        attachTo: document.body,
      })

      expandForm()
      await new Promise((r) => setTimeout(r, 0))
      await fillAndSubmit('user@example.com')

      expect(callRemote).toHaveBeenCalledWith(
        '/api/extension-request',
        'POST',
        expect.objectContaining({
          email: 'user@example.com',
          spaceKey: 'engineering-architecture',
          macroCount: 105,
          macrosLimit: 100,
          accountId: 'account-123',
          pageId: 'page-456',
        })
      )
      expect(document.querySelector('[data-testid="extension-form-success"]')).toBeTruthy()
      expect(trackUpgradeEvent).toHaveBeenCalledWith(
        'extension_form_submitted',
        expect.objectContaining({ issue_key: 'ZEN-123' })
      )
      expect(localStorage.getItem('extensionRequestEmail')).toBe('user@example.com')

      wrapper.unmount()
    })

    it('shows an error with portal fallback when the backend fails, and the fallback opens the legacy deep-link', async () => {
      vi.mocked(callRemote).mockRejectedValue(new Error('HTTP 502: boom'))

      const wrapper = mount(UpgradePrompt, {
        props: baseProps,
        attachTo: document.body,
      })

      expandForm()
      await new Promise((r) => setTimeout(r, 0))
      await fillAndSubmit('user@example.com')

      expect(trackUpgradeEvent).toHaveBeenCalledWith(
        'extension_form_failed',
        expect.objectContaining({ error: 'request_failed' })
      )
      expect(document.querySelector('[data-testid="extension-form-success"]')).toBeNull()
      const fallback = document.querySelector('[data-testid="extension-form-fallback-link"]') as HTMLAnchorElement
      expect(fallback).toBeTruthy()

      fallback.click()
      await new Promise((r) => setTimeout(r, 0))

      expect(trackUpgradeEvent).toHaveBeenCalledWith(
        'extension_request_clicked',
        expect.objectContaining({ fallback_from_form: true })
      )
      const openedUrl = new URL(vi.mocked(openUrl).mock.calls[0][0] as string)
      expect(`${openedUrl.origin}${openedUrl.pathname}`).toBe(
        'https://zenuml.atlassian.net/servicedesk/customer/portal/1/group/1/create/9'
      )
      expect(openedUrl.searchParams.get('customfield_10070')).toBe('10037')

      wrapper.unmount()
    })

    it('shows a rate-limit message without portal fallback on 429', async () => {
      vi.mocked(callRemote).mockRejectedValue(new Error('HTTP 429: rate_limited'))

      const wrapper = mount(UpgradePrompt, {
        props: baseProps,
        attachTo: document.body,
      })

      expandForm()
      await new Promise((r) => setTimeout(r, 0))
      await fillAndSubmit('user@example.com')

      expect(trackUpgradeEvent).toHaveBeenCalledWith(
        'extension_form_failed',
        expect.objectContaining({ error: 'rate_limited' })
      )
      expect(document.querySelector('[data-testid="extension-form-fallback-link"]')).toBeNull()
      const error = document.querySelector('[data-testid="extension-form-error"]') as HTMLElement
      expect(error.textContent).toContain('already have a request')

      wrapper.unmount()
    })

    it('prefills the email from localStorage on a repeat visit', async () => {
      localStorage.setItem('extensionRequestEmail', 'repeat@example.com')

      const wrapper = mount(UpgradePrompt, {
        props: baseProps,
        attachTo: document.body,
      })

      expandForm()
      await new Promise((r) => setTimeout(r, 0))

      const input = document.querySelector('[data-testid="extension-email-input"]') as HTMLInputElement
      expect(input.value).toBe('repeat@example.com')

      wrapper.unmount()
    })
  })
})
