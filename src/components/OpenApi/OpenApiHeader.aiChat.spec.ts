import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OpenApiHeader from './OpenApiHeader.vue'
import { isAiChatEnabled } from '@/apis/aiTitleFeatureFlag'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

vi.mock('@/apis/aiTitleFeatureFlag', () => ({
  isAiChatEnabled: vi.fn(),
}))

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}))

vi.mock('@/components/OpenApi/OpenApiTitleInput.vue', () => ({
  default: { name: 'OpenApiTitleInputStub', template: '<div />' },
}))

vi.mock('@/components/PublishButton.vue', () => ({
  default: { name: 'PublishButtonStub', template: '<div />' },
}))

vi.mock('@/utils/closeGuard', () => ({
  setupCloseGuard: vi.fn(() => vi.fn()),
}))

vi.mock('@/utils/draftStore', () => ({
  makeDebouncedDraftSaver: vi.fn(() => ({
    save: vi.fn(),
    flush: vi.fn(),
    cancel: vi.fn(),
  })),
  loadDraft: vi.fn().mockResolvedValue(null),
  clearDraft: vi.fn().mockResolvedValue(undefined),
  primeCloudId: vi.fn().mockResolvedValue(undefined),
  getCachedCloudId: vi.fn(),
  getCachedSavedVersionUpdatedAt: vi.fn(),
  saveDraftSync: vi.fn(),
  isDraftNewerThanSaved: vi.fn(() => false),
}))

describe('OpenApiHeader AI Chat feature flag', () => {
  const wrappers: Array<ReturnType<typeof mount>> = []

  beforeEach(() => {
    window.specListeners = []
    window.diagram = undefined
  })

  afterEach(() => {
    wrappers.splice(0).forEach((w) => w.unmount())
    vi.clearAllMocks()
  })

  async function renderHeader(enabled: boolean, onToggleAiChat = vi.fn()) {
    vi.mocked(isAiChatEnabled).mockResolvedValue(enabled)
    const wrapper = mount(OpenApiHeader, {
      props: {
        saveAndExit: vi.fn(),
        exit: vi.fn(),
        aiChatOpen: true,
        onToggleAiChat,
      },
    })
    wrappers.push(wrapper)
    await flushPromises()
    return { wrapper, onToggleAiChat }
  }

  it('shows the active AI Chat action and forwards its toggle', async () => {
    const { wrapper, onToggleAiChat } = await renderHeader(true)
    const toggle = wrapper.find('[data-testid="react-ai-chat-toggle"]')

    expect(toggle.exists()).toBe(true)
    expect(toggle.classes()).toContain('bg-violet-100')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('ai_chat_button_shown', {
      feature_area: 'ai',
      surface: 'editor',
      macro_type: 'openapi',
    })
    await toggle.trigger('click')
    expect(onToggleAiChat).toHaveBeenCalledOnce()
  })

  it('hides AI Chat when its independent feature flag is disabled', async () => {
    const { wrapper } = await renderHeader(false)

    expect(wrapper.find('[data-testid="react-ai-chat-toggle"]').exists()).toBe(false)
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith(
      'ai_chat_button_shown',
      expect.anything(),
    )
  })
})
