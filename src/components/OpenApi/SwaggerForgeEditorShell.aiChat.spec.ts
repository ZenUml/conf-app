import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/OpenApi/OpenApiHeader.vue', () => ({
  default: {
    name: 'OpenApiHeaderStub',
    props: ['saveAndExit', 'exit', 'aiChatOpen', 'onToggleAiChat'],
    template:
      '<button type="button" data-testid="header-ai-chat-toggle" @click="onToggleAiChat && onToggleAiChat()">{{ aiChatOpen ? "Close AI Chat" : "Open AI Chat" }}</button>',
  },
}))

vi.mock('@/components/SyntaxErrorBox.vue', () => ({
  default: {
    name: 'SyntaxErrorBoxStub',
    emits: ['request-ai-chat-repair'],
    template:
      '<button type="button" data-testid="syntax-error-repair-trigger" @click="$emit(\'request-ai-chat-repair\')">AI Repair</button>',
  },
}))

vi.mock('@/components/react/AIChatPanel', async () => {
  const ReactModule = await import('react')
  return {
    default: (props: any) =>
      ReactModule.createElement('aside', { 'data-testid': 'react-ai-chat-panel-stub' }, [
        ReactModule.createElement('span', { key: 'code', 'data-testid': 'chat-code' }, props.currentCode),
        ReactModule.createElement('span', { key: 'id', 'data-testid': 'chat-diagram-id' }, props.diagramlyDiagramId),
        ReactModule.createElement('span', { key: 'repair', 'data-testid': 'chat-repair-request-id' }, props.syntaxRepairRequestId),
        ReactModule.createElement('span', { key: 'error', 'data-testid': 'chat-syntax-error' }, props.syntaxError),
        ReactModule.createElement('button', {
          key: 'apply',
          type: 'button',
          'data-testid': 'chat-apply',
          onClick: () => props.onApplyCode('openapi: 3.0.0\ninfo:\n  title: AI updated'),
        }),
        ReactModule.createElement('button', {
          key: 'bind',
          type: 'button',
          'data-testid': 'chat-bind',
          onClick: () => void props.onDiagramlyDiagramBound('diagramly-1'),
        }),
        ReactModule.createElement('button', {
          key: 'toggle',
          type: 'button',
          'data-testid': 'chat-toggle-code',
          onClick: props.onToggleCode,
        }),
        ReactModule.createElement('button', {
          key: 'close',
          type: 'button',
          'data-testid': 'chat-close',
          onClick: props.onClose,
        }),
      ]),
  }
})

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}))

import SwaggerForgeEditorShell from './SwaggerForgeEditorShell.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

describe('SwaggerForgeEditorShell AI Chat + SyntaxErrorBox integration', () => {
  let wrapper: ReturnType<typeof mount>

  beforeEach(async () => {
    vi.mocked(trackAnalyticsEvent).mockClear()
    store.state.diagram = {
      id: 'macro-1',
      diagramType: DiagramType.OpenApi,
      code: 'openapi: 3.0.0\ninfo:\n  title: Original',
      title: 'Original',
      metadata: {
        keep: 'existing',
        aiChat: { keepNested: 'existing' },
      },
    } as any
    store.state.error = null
    wrapper = mount(SwaggerForgeEditorShell, {
      attachTo: document.body,
      global: { plugins: [store] },
      props: {
        saveAndExit: vi.fn(),
        exit: vi.fn(),
      },
    })
    await flushPromises()
  })

  afterEach(() => {
    wrapper.unmount()
  })

  async function openChat() {
    await wrapper.find('[data-testid="header-ai-chat-toggle"]').trigger('click')
    await flushPromises()
  }

  it('mounts Chat while retaining Swagger state and supports code visibility', async () => {
    await openChat()

    const container = wrapper.element
    expect(container.querySelector('[data-testid="react-ai-chat-panel-stub"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="chat-code"]')?.textContent).toContain('Original')
    expect(container.querySelector('.swagger-editor-workspace')?.className).toContain('code-editor-hidden')
    expect((container.querySelector('#syntax-error-box') as HTMLElement).style.display).toBe('none')

    ;(container.querySelector('[data-testid="chat-toggle-code"]') as HTMLButtonElement).click()
    await flushPromises()

    expect(container.querySelector('.swagger-editor-workspace')?.className).not.toContain('code-editor-hidden')
    expect(container.querySelector('#swagger-editor')).not.toBeNull()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_opened',
      expect.objectContaining({ entry_point: 'ai_prompt', macro_type: 'openapi' }),
    )
  })

  it('captures document hydration that happens before the first store mutation', async () => {
    store.state.diagram = {
      ...store.state.diagram,
      code: 'openapi: 3.0.0\ninfo:\n  title: Hydrated',
      metadata: { aiChat: { diagramlyDiagramId: 'hydrated-diagram' } },
    } as any
    store.commit('updateError', null)
    await flushPromises()
    await openChat()

    const container = wrapper.element
    expect(container.querySelector('[data-testid="chat-code"]')?.textContent).toContain('Hydrated')
    expect(container.querySelector('[data-testid="chat-diagram-id"]')?.textContent).toBe('hydrated-diagram')
  })

  it('applies AI code through the store and merges Diagramly metadata', async () => {
    await openChat()
    const container = wrapper.element
    ;(container.querySelector('[data-testid="chat-apply"]') as HTMLButtonElement).click()
    await flushPromises()
    ;(container.querySelector('[data-testid="chat-bind"]') as HTMLButtonElement).click()
    await flushPromises()

    expect(store.state.diagram.code).toContain('AI updated')
    expect(container.querySelector('[data-testid="chat-code"]')?.textContent).toContain('AI updated')
    expect(store.state.diagram.metadata).toEqual({
      keep: 'existing',
      aiChat: {
        keepNested: 'existing',
        diagramlyDiagramId: 'diagramly-1',
      },
    })
    expect(container.querySelector('[data-testid="chat-diagram-id"]')?.textContent).toBe('diagramly-1')
  })

  it('restores the Swagger workspace when Chat closes', async () => {
    await openChat()
    const container = wrapper.element
    ;(container.querySelector('[data-testid="chat-close"]') as HTMLButtonElement).click()
    await flushPromises()

    expect(container.querySelector('[data-testid="react-ai-chat-panel-stub"]')).toBeNull()
    expect(container.querySelector('.swagger-editor-workspace')?.className).not.toContain('code-editor-hidden')
    expect((container.querySelector('#syntax-error-box') as HTMLElement).style.display).toBe('block')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_closed',
      expect.objectContaining({
        macro_type: 'openapi',
        close_reason: 'user_closed',
        session_duration_ms: expect.any(Number),
      }),
    )
  })

  it('closes the overlay from the responsive workspace backdrop', async () => {
    await openChat()
    await wrapper.find('[data-testid="react-ai-chat-backdrop"]').trigger('click')
    await flushPromises()

    const container = wrapper.element
    expect(container.querySelector('[data-testid="react-ai-chat-panel-stub"]')).toBeNull()
    expect(container.querySelector('.swagger-editor-workspace')?.className).not.toContain('code-editor-hidden')
  })

  it('opens AI Chat and starts syntax repair from the child SyntaxErrorBox event', async () => {
    store.commit('updateError', 'OpenAPI syntax error at line 3')
    await flushPromises()
    await wrapper.find('[data-testid="syntax-error-repair-trigger"]').trigger('click')
    await flushPromises()

    const container = wrapper.element
    expect(container.querySelector('[data-testid="react-ai-chat-panel-stub"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="chat-repair-request-id"]')?.textContent).toBe('1')
    expect(container.querySelector('[data-testid="chat-syntax-error"]')?.textContent).toBe(
      'OpenAPI syntax error at line 3',
    )
    expect(container.querySelector('.swagger-editor-workspace')?.className).toContain('code-editor-hidden')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_opened',
      expect.objectContaining({ entry_point: 'ai_repair', macro_type: 'openapi' }),
    )
  })
})
