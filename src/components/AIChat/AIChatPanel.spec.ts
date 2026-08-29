import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AIChatPanel from './AIChatPanel.vue'
import { runAIChatSession } from '@/services/AIChatSessionService'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import {
  getDiagramlyVersions,
  restoreDiagramlyVersion,
} from '@/services/GenerateService'

vi.mock('@/services/AIChatSessionService', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/services/AIChatSessionService')>(),
  runAIChatSession: vi.fn(),
}))

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}))

vi.mock('@/services/GenerateService', () => ({
  getDiagramlyVersions: vi.fn(),
  restoreDiagramlyVersion: vi.fn(),
}))

const initialVersion = {
  id: 'version-1',
  diagramId: 'diagram-1',
  versionNumber: 1,
  createdAt: '2026-08-29T01:00:00.000Z',
  content: { code: 'A->B: original' },
}

describe('AIChatPanel core flow', () => {
  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockClear()
    vi.mocked(runAIChatSession).mockReset()
    vi.mocked(getDiagramlyVersions).mockReset()
    vi.mocked(restoreDiagramlyVersion).mockReset()
    vi.mocked(getDiagramlyVersions).mockResolvedValue({
      versions: [initialVersion],
      diagram: { id: 'diagram-1', currentVersionId: 'version-1' },
    })
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
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_suggestion_selected',
      expect.objectContaining({ suggestion_id: 'add-error-path', macro_type: 'sequence' }),
    )
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
        pollCount: 2,
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
    expect(wrapper.get('[data-testid="ai-chat-undo"]').exists()).toBe(true)

    await wrapper.get('.ai-chat-diff-toggle').trigger('click')
    const diff = wrapper.get('[data-testid="ai-chat-diff"]')
    expect(diff.text()).toContain('A->B: original')
    expect(diff.text()).toContain('A->B: updated')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_prompt_submitted',
      expect.objectContaining({
        change_kind: 'request',
        prompt_length: 18,
        turn_index: 1,
        input_source: 'typed',
        retry_after_failure: false,
      }),
    )
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_change_applied',
      expect.objectContaining({
        change_kind: 'request',
        version_id: 'version-2',
        poll_count: 2,
        lines_added: 1,
        lines_removed: 1,
      }),
    )
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_diff_toggled',
      expect.objectContaining({ interaction_state: 'opened' }),
    )
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
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_syntax_repair_requested',
      expect.objectContaining({ change_kind: 'syntax_repair' }),
    )
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_syntax_issue_shown',
      expect.objectContaining({ error_category: 'syntax_error' }),
    )
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_prompt_submitted',
      expect.objectContaining({ generation_source: 'syntax_repair' }),
    )
  })

  it('loads the complete saved history once and marks the current version', async () => {
    vi.mocked(getDiagramlyVersions).mockResolvedValueOnce({
      versions: [
        initialVersion,
        {
          id: 'version-2',
          diagramId: 'diagram-1',
          versionNumber: 2,
          instruction: 'Add retry path',
          createdAt: '2026-08-29T01:01:00.000Z',
          content: { code: 'A->B: retry' },
        },
      ],
      diagram: { id: 'diagram-1', currentVersionId: 'version-2' },
    })
    const wrapper = mount(AIChatPanel, {
      props: {
        open: true,
        diagramlyDiagramId: 'diagram-1',
        currentCode: 'A->B: retry',
      },
    })
    await flushPromises()

    await wrapper.get('[data-testid="ai-chat-history-trigger"]').trigger('click')
    const history = wrapper.get('[data-testid="ai-chat-history-panel"]')

    expect(history.text()).toContain('Initial version')
    expect(history.text()).toContain('Add retry path')
    expect(history.get('.is-current').text()).toContain('v2')
    expect(history.get('.is-current').text()).toContain('Current')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_history_opened',
      expect.objectContaining({ version_id: 'version-2' }),
    )
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_history_load_succeeded',
      expect.objectContaining({ version_count: 2, is_retry: false }),
    )

    await history.get('[aria-label="Close diagram versions"]').trigger('click')
    await wrapper.get('[data-testid="ai-chat-history-trigger"]').trigger('click')
    expect(getDiagramlyVersions).toHaveBeenCalledTimes(1)
  })

  it('restores a historical version as a new audited version and applies its code', async () => {
    vi.mocked(getDiagramlyVersions).mockResolvedValueOnce({
      versions: [
        initialVersion,
        {
          id: 'version-2',
          diagramId: 'diagram-1',
          versionNumber: 2,
          instruction: 'Current update',
          createdAt: '2026-08-29T01:01:00.000Z',
          content: { code: 'A->B: current' },
        },
      ],
      diagram: { id: 'diagram-1', currentVersionId: 'version-2' },
    })
    vi.mocked(restoreDiagramlyVersion).mockResolvedValueOnce({
      diagramId: 'diagram-1',
      diagramCode: 'A->B: original',
      version: {
        id: 'version-3',
        diagramId: 'diagram-1',
        versionNumber: 3,
        instruction: 'Restored from version 1',
        createdAt: '2026-08-29T01:02:00.000Z',
        content: { code: 'A->B: original' },
      },
    })
    const wrapper = mount(AIChatPanel, {
      props: {
        open: true,
        diagramlyDiagramId: 'diagram-1',
        currentCode: 'A->B: current',
      },
    })
    await flushPromises()

    await wrapper.get('[data-testid="ai-chat-history-trigger"]').trigger('click')
    const restore = wrapper.findAll('.ai-chat-rollback').find(
      (button) => button.text() === 'Restore version',
    )
    expect(restore).toBeDefined()
    await restore!.trigger('click')
    await flushPromises()

    expect(restoreDiagramlyVersion).toHaveBeenCalledWith('diagram-1', 'version-1')
    expect(wrapper.emitted('apply-code')).toEqual([['A->B: original']])
    expect(wrapper.text()).toContain('Version restored')
    expect(wrapper.text()).toContain('saved it as v3')
    expect(wrapper.find('[data-testid="ai-chat-history-panel"]').exists()).toBe(false)

    await wrapper.get('[data-testid="ai-chat-history-trigger"]').trigger('click')
    expect(wrapper.get('[data-testid="ai-chat-history-panel"]').text()).toContain('v3')
    expect(wrapper.get('[data-testid="ai-chat-history-panel"] .is-current').text()).toContain('v3')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_version_restored',
      expect.objectContaining({ change_kind: 'rollback', version_id: 'version-1' }),
    )
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_version_restore_requested',
      expect.objectContaining({ change_kind: 'rollback', version_id: 'version-1' }),
    )
  })

  it('undoes an AI change through restore-version and disables repeated undo', async () => {
    vi.mocked(getDiagramlyVersions).mockResolvedValueOnce({
      versions: [initialVersion],
      diagram: { id: 'diagram-1', currentVersionId: 'version-1' },
    })
    vi.mocked(runAIChatSession).mockResolvedValueOnce({
      diagramId: 'diagram-1',
      diagramCreated: false,
      updatedCode: 'A->B: changed',
      versionId: 'version-2',
      versionNumber: 2,
      jobId: 'job-1',
    })
    vi.mocked(restoreDiagramlyVersion).mockResolvedValueOnce({
      diagramId: 'diagram-1',
      diagramCode: 'A->B: original',
      version: {
        id: 'version-3',
        diagramId: 'diagram-1',
        versionNumber: 3,
        instruction: 'Restored from version 1',
        createdAt: '2026-08-29T01:02:00.000Z',
        content: { code: 'A->B: original' },
      },
    })
    const wrapper = mount(AIChatPanel, {
      props: {
        open: true,
        diagramlyDiagramId: 'diagram-1',
        currentCode: 'A->B: original',
      },
    })
    await flushPromises()

    await wrapper.get('[data-testid="ai-chat-input"]').setValue('Change the flow')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('[data-testid="ai-chat-undo"]').trigger('click')
    await flushPromises()

    expect(restoreDiagramlyVersion).toHaveBeenCalledWith('diagram-1', 'version-1')
    expect(wrapper.text()).toContain('Changes undone')
    expect(wrapper.emitted('apply-code')).toEqual([
      ['A->B: changed'],
      ['A->B: original'],
    ])
    expect(wrapper.find('[data-testid="ai-chat-undo"]').exists()).toBe(false)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_change_undone',
      expect.objectContaining({ change_kind: 'undo', version_id: 'version-1' }),
    )
  })

  it('opens and closes the selected line diff in a full-screen dialog', async () => {
    vi.mocked(runAIChatSession).mockResolvedValueOnce({
      diagramId: 'diagram-1',
      diagramCreated: false,
      updatedCode: 'A->B: changed',
      versionId: 'version-2',
      versionNumber: 2,
      jobId: 'job-1',
    })
    const wrapper = mount(AIChatPanel, {
      props: {
        open: true,
        diagramlyDiagramId: 'diagram-1',
        currentCode: 'A->B: original',
      },
    })
    await flushPromises()
    await wrapper.get('[data-testid="ai-chat-input"]').setValue('Change the flow')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('.ai-chat-diff-toggle').trigger('click')
    await wrapper.get('[data-testid="ai-chat-diff-expand"]').trigger('click')

    const fullscreen = wrapper.get('[data-testid="ai-chat-diff-fullscreen"]')
    expect(fullscreen.attributes('aria-modal')).toBe('true')
    expect(fullscreen.text()).toContain('A->B: original')
    expect(fullscreen.text()).toContain('A->B: changed')

    await fullscreen.get('[data-testid="ai-chat-diff-fullscreen-close"]').trigger('click')
    expect(wrapper.find('[data-testid="ai-chat-diff-fullscreen"]').exists()).toBe(false)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_diff_toggled',
      expect.objectContaining({ interaction_state: 'shown', ui_component: 'code_diff_fullscreen' }),
    )
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_diff_toggled',
      expect.objectContaining({ interaction_state: 'hidden', ui_component: 'code_diff_fullscreen' }),
    )
  })

  it('tracks code visibility changes from the panel header', async () => {
    const wrapper = mount(AIChatPanel, {
      props: { open: true, codeVisible: false },
    })

    await wrapper.get('[data-testid="ai-chat-code-toggle"]').trigger('click')

    expect(wrapper.emitted('toggle-code')).toHaveLength(1)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_code_visibility_toggled',
      expect.objectContaining({ interaction_state: 'shown' }),
    )
  })

  it('shows a retryable version-history error', async () => {
    vi.mocked(getDiagramlyVersions)
      .mockRejectedValueOnce(new Error('History unavailable'))
      .mockResolvedValueOnce({
        versions: [initialVersion],
        diagram: { id: 'diagram-1', currentVersionId: 'version-1' },
      })
    const wrapper = mount(AIChatPanel, {
      props: { open: true, diagramlyDiagramId: 'diagram-1' },
    })
    await flushPromises()

    await wrapper.get('[data-testid="ai-chat-history-trigger"]').trigger('click')
    expect(wrapper.get('[data-testid="ai-chat-history-error"]').text()).toContain(
      'Saved versions could not be loaded',
    )
    await wrapper.get('[data-testid="ai-chat-history-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="ai-chat-history-error"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="ai-chat-history-panel"]').text()).toContain('Initial version')
    expect(getDiagramlyVersions).toHaveBeenCalledTimes(2)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_history_load_failed',
      expect.objectContaining({
        failure_phase: 'history_load',
        failure_reason: 'history_request_failed',
      }),
    )
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_history_load_succeeded',
      expect.objectContaining({ version_count: 1, is_retry: true }),
    )
  })

  it('tracks a failed historical-version restore without leaking the raw error', async () => {
    vi.mocked(getDiagramlyVersions).mockResolvedValueOnce({
      versions: [
        initialVersion,
        {
          ...initialVersion,
          id: 'version-2',
          versionNumber: 2,
          content: { code: 'A->B: current' },
        },
      ],
      diagram: { id: 'diagram-1', currentVersionId: 'version-2' },
    })
    vi.mocked(restoreDiagramlyVersion).mockRejectedValueOnce(
      new Error('Sensitive backend detail'),
    )
    const wrapper = mount(AIChatPanel, {
      props: {
        open: true,
        diagramlyDiagramId: 'diagram-1',
        currentCode: 'A->B: current',
      },
    })
    await flushPromises()

    await wrapper.get('[data-testid="ai-chat-history-trigger"]').trigger('click')
    const restore = wrapper.findAll('.ai-chat-rollback').find(
      (button) => button.text() === 'Restore version',
    )
    await restore!.trigger('click')
    await flushPromises()

    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_version_restore_failed',
      expect.objectContaining({
        failure_phase: 'version_restore',
        failure_reason: 'restore_request_failed',
        change_kind: 'rollback',
        version_id: 'version-1',
      }),
    )
    const failureCall = vi.mocked(trackAnalyticsEvent).mock.calls.find(
      ([eventName]) => eventName === 'ai_chat_version_restore_failed',
    )
    expect(JSON.stringify(failureCall?.[1])).not.toContain('Sensitive backend detail')
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
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_prompt_cancelled',
      expect.objectContaining({ cancel_reason: 'panel_closed' }),
    )

    await wrapper.get('[data-testid="ai-chat-input"]').setValue('Update twice')
    await wrapper.get('form').trigger('submit')
    wrapper.unmount()
    expect(signals[1].aborted).toBe(true)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_prompt_cancelled',
      expect.objectContaining({ cancel_reason: 'component_unmounted' }),
    )
  })

  it('renders a recoverable assistant error and unlocks the composer', async () => {
    vi.mocked(runAIChatSession)
      .mockRejectedValueOnce(new Error('Diagramly unavailable'))
      .mockResolvedValueOnce({
        diagramId: 'diagram-1',
        diagramCreated: false,
        updatedCode: 'updated',
        versionId: 'version-2',
        jobId: 'job-2',
      })
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
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_prompt_failed',
      expect.objectContaining({
        failure_phase: 'sync',
        failure_reason: 'unexpected_error',
        change_kind: 'request',
      }),
    )
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_prompt_submitted',
      expect.objectContaining({ retry_after_failure: true, turn_index: 2 }),
    )
  })
})
