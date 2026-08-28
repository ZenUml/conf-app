import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AIChatPanel from './AIChatPanel.vue'
import { runAIChatSession } from '@/services/AIChatSessionService'

vi.mock('@/services/AIChatSessionService', () => ({
  runAIChatSession: vi.fn(),
}))

describe('AIChatPanel core flow', () => {
  beforeEach(() => {
    vi.mocked(runAIChatSession).mockReset()
  })

  it('only renders while open', async () => {
    const wrapper = mount(AIChatPanel, { props: { open: false } })

    expect(wrapper.find('[data-testid="ai-chat-panel"]').exists()).toBe(false)
    await wrapper.setProps({ open: true })
    expect(wrapper.find('[data-testid="ai-chat-panel"]').exists()).toBe(true)
  })

  it('fills and focuses the composer from a quick suggestion', async () => {
    const wrapper = mount(AIChatPanel, {
      attachTo: document.body,
      props: { open: true },
    })

    await wrapper.get('[data-testid="ai-chat-suggestion-add-error-path"]').trigger('click')

    const input = wrapper.get('[data-testid="ai-chat-input"]')
    expect((input.element as HTMLTextAreaElement).value).toBe('Add an error handling path')
    expect(document.activeElement).toBe(input.element)
    wrapper.unmount()
  })

  it('runs the versioned session, binds the diagram, applies code, and exposes line diff', async () => {
    vi.mocked(runAIChatSession).mockImplementationOnce(async (options) => {
      options.onStage?.('processing', {
        id: 'job-1',
        status: 'PROCESSING',
        progress: 50,
        message: 'Updating',
      })
      await options.onDiagramBound?.('diagram-1')
      options.onStage?.('syncing')
      return {
        diagramId: 'diagram-1',
        diagramCreated: true,
        updatedCode: 'A->B: updated',
        versionId: 'version-2',
        versionNumber: 2,
        jobId: 'job-1',
      }
    })
    const wrapper = mount(AIChatPanel, {
      props: {
        open: true,
        diagramType: 'sequence',
        currentCode: 'A->B: original',
      },
    })

    await wrapper.get('[data-testid="ai-chat-input"]').setValue('Update the message')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(runAIChatSession).toHaveBeenCalledWith(expect.objectContaining({
      diagramId: '',
      diagramCode: 'A->B: original',
      diagramType: 'sequence',
      prompt: 'Update the message',
      signal: expect.any(AbortSignal),
    }))
    expect(wrapper.emitted('send')).toEqual([['Update the message']])
    expect(wrapper.emitted('diagramly-diagram-bound')).toEqual([['diagram-1']])
    expect(wrapper.emitted('apply-code')).toEqual([['A->B: updated']])
    expect(wrapper.emitted('apply')).toHaveLength(1)
    expect(wrapper.get('[data-testid="ai-change-preview"]').text()).toContain('Changes applied')

    await wrapper.get('.ai-chat-diff-toggle').trigger('click')
    const diff = wrapper.get('[data-testid="ai-chat-diff"]')
    expect(diff.text()).toContain('A->B: original')
    expect(diff.text()).toContain('A->B: updated')
  })

  it('keeps the composer editable but prevents a second send while work is active', async () => {
    let finish!: () => void
    vi.mocked(runAIChatSession).mockImplementationOnce(
      () => new Promise((resolve) => {
        finish = () => resolve({
          diagramId: 'diagram-1',
          diagramCreated: false,
          updatedCode: 'updated',
          versionId: 'version-2',
          jobId: 'job-1',
        })
      }),
    )
    const wrapper = mount(AIChatPanel, {
      props: { open: true, diagramlyDiagramId: 'diagram-1', currentCode: 'original' },
    })

    await wrapper.get('[data-testid="ai-chat-input"]').setValue('First request')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('[data-testid="ai-chat-input"]').setValue('Queue this next')

    expect(wrapper.get('[data-testid="ai-chat-thinking"]').text()).toContain('Understanding request')
    expect((wrapper.get('[data-testid="ai-chat-input"]').element as HTMLTextAreaElement).disabled).toBe(false)
    expect((wrapper.get('[data-testid="ai-chat-send"]').element as HTMLButtonElement).disabled).toBe(true)

    finish()
    await flushPromises()
  })

  it('uses the same session with syntax context for parent and in-panel repair requests', async () => {
    vi.mocked(runAIChatSession).mockResolvedValue({
      diagramId: 'diagram-1',
      diagramCreated: false,
      updatedCode: 'A->B: fixed',
      versionId: 'version-2',
      jobId: 'job-1',
    })
    const syntaxError = "Sequence syntax error at line 2\nUnexpected ')'"
    const wrapper = mount(AIChatPanel, {
      props: {
        open: true,
        diagramlyDiagramId: 'diagram-1',
        currentCode: 'A->B)',
        syntaxError,
      },
    })

    await wrapper.setProps({ syntaxRepairRequestId: 1 })
    await flushPromises()

    expect(runAIChatSession).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Fix the current syntax issue without changing the rest of the diagram.',
      errorMessage: syntaxError,
    }))
    expect(wrapper.text()).toContain('Syntax fixed')
    expect(wrapper.find('[data-testid="ai-chat-syntax-issue"]').exists()).toBe(false)
    expect(wrapper.emitted('apply-code')).toEqual([['A->B: fixed']])
  })

  it('aborts active work when closing or unmounting', async () => {
    const signals: AbortSignal[] = []
    vi.mocked(runAIChatSession).mockImplementation((options) => {
      signals.push(options.signal!)
      return new Promise(() => {})
    })
    const wrapper = mount(AIChatPanel, {
      props: { open: true, currentCode: 'original' },
    })

    await wrapper.get('[data-testid="ai-chat-input"]').setValue('Update once')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('[data-testid="ai-chat-close"]').trigger('click')

    expect(signals[0].aborted).toBe(true)
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper.get('[data-testid="ai-chat-input"]').setValue('Update twice')
    await wrapper.get('form').trigger('submit')
    wrapper.unmount()
    expect(signals[1].aborted).toBe(true)
  })

  it('renders a recoverable assistant error and unlocks the composer', async () => {
    vi.mocked(runAIChatSession).mockRejectedValueOnce(new Error('Diagramly unavailable'))
    const wrapper = mount(AIChatPanel, {
      props: { open: true, currentCode: 'original' },
    })

    await wrapper.get('[data-testid="ai-chat-input"]').setValue('Update')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('AI Chat could not apply the change: Diagramly unavailable')
    expect((wrapper.get('[data-testid="ai-chat-send"]').element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.get('[data-testid="ai-chat-input"]').setValue('Retry')
    expect((wrapper.get('[data-testid="ai-chat-send"]').element as HTMLButtonElement).disabled).toBe(false)
    expect(wrapper.emitted('apply-code')).toBeUndefined()
  })
})
