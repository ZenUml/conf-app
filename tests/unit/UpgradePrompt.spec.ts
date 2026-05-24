import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

vi.mock('@/utils/upgradeTracking', () => ({
  trackUpgradeEvent: vi.fn(),
  UpgradeEventName: {
    MODAL_SHOWN: 'upgrade_modal_shown',
    MODAL_DISMISSED: 'upgrade_modal_dismissed',
    PAYWALL_CONTINUED_EDITING: 'paywall_continued_editing',
    ADVOCACY_MESSAGE_COPIED: 'advocacy_message_copied',
    ADVOCACY_DRAFT_PREVIEW_CLICKED: 'advocacy_draft_preview_clicked',
  },
  UIComponent: {
    MODAL: 'modal',
  },
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
  openUrl: vi.fn(),
}))

import UpgradePrompt from '@/components/UpgradePrompt/UpgradePrompt.vue'
import { trackUpgradeEvent } from '@/utils/upgradeTracking'

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
})
