import { mount, flushPromises } from '@vue/test-utils'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'

vi.mock('@/services/GenerateService', () => ({
  startFixDiagram: vi.fn(),
  getFixDiagramStatus: vi.fn(),
}))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}))

import AIRepair from '@/components/AIRepair.vue'
import { startFixDiagram, getFixDiagramStatus } from '@/services/GenerateService'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

const COMPLETED_STATUS = {
  status: 'COMPLETED',
  message: 'Done',
  progress: 100,
  output: {
    diagramCode: 'A->B: fixed',
    repairAttempts: 1,
    durationMs: 12_000,
    model: 'anthropic/claude-sonnet-5',
    reasoningDisabled: true,
  },
}

const FAILED_STATUS = {
  status: 'FAILED',
  message: 'Failed',
  progress: 0,
  output: { durationMs: 8_000, repairAttempts: 2, timedOut: false },
  error: 'Unknown error',
}

const ORIGINAL_CODE = 'A->B: hello'

const mountRepair = (props: Record<string, unknown> = {}) =>
  mount(AIRepair, {
    props: {
      showDialog: false,
      originalCode: ORIGINAL_CODE,
      diagramType: 'Sequence',
      error: 'syntax error on line 1',
      ...props,
    },
    attachTo: document.body,
  })

// Trigger repair by flipping showDialog false → true and flushing all async work
const triggerRepair = async (wrapper: ReturnType<typeof mountRepair>) => {
  await wrapper.setProps({ showDialog: true })
  await flushPromises()
  await nextTick()
  await nextTick()
}

describe('AIRepair analytics', () => {
  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockClear()
    vi.mocked(startFixDiagram as any).mockClear()
    vi.mocked(getFixDiagramStatus as any).mockClear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires ai_repair_requested with macro_type and prompt_length when repair starts', async () => {
    vi.mocked(startFixDiagram as any).mockResolvedValue({ jobId: 'j1' })
    vi.mocked(getFixDiagramStatus as any).mockResolvedValue({ status: 'PROCESSING', message: '...', progress: 30, output: null })

    const wrapper = mountRepair()
    await triggerRepair(wrapper)

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('ai_repair_requested', expect.objectContaining({
      feature_area: 'ai',
      surface: 'modal',
      macro_type: 'sequence',
      prompt_length: ORIGINAL_CODE.length,
      poll_interval_ms: 1000,
      timeout_budget_ms: 60_000,
    }))
    wrapper.unmount()
  })

  it('uses openai/gpt-5.6-luna as the default repair model', async () => {
    vi.mocked(startFixDiagram as any).mockResolvedValue({ jobId: 'j-default-model' })
    vi.mocked(getFixDiagramStatus as any).mockResolvedValue({ status: 'PROCESSING', message: '...', progress: 30, output: null })

    const wrapper = mountRepair()
    await triggerRepair(wrapper)

    expect(startFixDiagram).toHaveBeenCalledWith(
      ORIGINAL_CODE,
      'syntax error on line 1',
      'Sequence',
      { model: 'openai/gpt-5.6-luna' },
    )
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('ai_repair_requested', expect.objectContaining({
      ai_model: 'openai/gpt-5.6-luna',
    }))
    wrapper.unmount()
  })

  it('forwards and tracks explicit model and disableReasoning configuration', async () => {
    vi.mocked(startFixDiagram as any).mockResolvedValue({ jobId: 'j-configured' })
    vi.mocked(getFixDiagramStatus as any).mockResolvedValue({ status: 'PROCESSING', message: '...', progress: 30, output: null })

    const wrapper = mountRepair({
      model: 'anthropic/claude-sonnet-5',
      disableReasoning: false,
    })
    await triggerRepair(wrapper)

    expect(startFixDiagram).toHaveBeenCalledWith(
      ORIGINAL_CODE,
      'syntax error on line 1',
      'Sequence',
      {
        model: 'anthropic/claude-sonnet-5',
        disableReasoning: false,
      },
    )
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('ai_repair_requested', expect.objectContaining({
      ai_model: 'anthropic/claude-sonnet-5',
      reasoning_disabled: false,
    }))
    wrapper.unmount()
  })

  it('fires ai_repair_succeeded when job completes', async () => {
    vi.mocked(startFixDiagram as any).mockResolvedValue({ jobId: 'j1' })
    vi.mocked(getFixDiagramStatus as any).mockResolvedValue(COMPLETED_STATUS)

    const wrapper = mountRepair()
    await triggerRepair(wrapper)

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('ai_repair_succeeded', expect.objectContaining({
      feature_area: 'ai',
      surface: 'modal',
      macro_type: 'sequence',
      poll_count: 1,
      backend_duration_ms: 12_000,
      repair_attempts: 1,
      ai_model: 'anthropic/claude-sonnet-5',
      reasoning_disabled: true,
    }))
    wrapper.unmount()
  })

  it('fires ai_repair_failed when job fails', async () => {
    vi.mocked(startFixDiagram as any).mockResolvedValue({ jobId: 'j1' })
    vi.mocked(getFixDiagramStatus as any).mockResolvedValue(FAILED_STATUS)

    const wrapper = mountRepair()
    await triggerRepair(wrapper)

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('ai_repair_failed', expect.objectContaining({
      feature_area: 'ai',
      surface: 'modal',
      macro_type: 'sequence',
      failure_reason: 'server_failed',
      failure_phase: 'server',
      backend_duration_ms: 8_000,
      repair_attempts: 2,
    }))
    wrapper.unmount()
  })

  it('fires ai_repair_failed when startFixDiagram throws', async () => {
    vi.mocked(startFixDiagram as any).mockRejectedValue(new Error('network error'))

    const wrapper = mountRepair()
    await triggerRepair(wrapper)

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('ai_repair_failed', expect.objectContaining({
      feature_area: 'ai',
      surface: 'modal',
      failure_reason: 'start_failed',
      failure_phase: 'start',
    }))
    wrapper.unmount()
  })

  it('fires ai_repair_applied when user clicks Apply Code', async () => {
    vi.mocked(startFixDiagram as any).mockResolvedValue({ jobId: 'j1' })
    vi.mocked(getFixDiagramStatus as any).mockResolvedValue(COMPLETED_STATUS)

    const wrapper = mountRepair()
    await triggerRepair(wrapper)

    const applyBtn = wrapper.findAll('button').find(b => b.text().includes('Apply Code'))
    expect(applyBtn).toBeDefined()
    await applyBtn!.trigger('click')

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('ai_repair_applied', expect.objectContaining({
      feature_area: 'ai',
      surface: 'modal',
      macro_type: 'sequence',
    }))
    wrapper.unmount()
  })

  it('fires ai_repair_dismissed when dialog is closed after a successful repair without applying', async () => {
    vi.mocked(startFixDiagram as any).mockResolvedValue({ jobId: 'j1' })
    vi.mocked(getFixDiagramStatus as any).mockResolvedValue(COMPLETED_STATUS)

    const wrapper = mountRepair()
    await triggerRepair(wrapper)

    // Click the X close button (first button in dialog header)
    const closeBtn = wrapper.find('[data-testid="ai-repair-dialog-content"] button')
    await closeBtn.trigger('click')

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('ai_repair_dismissed', expect.objectContaining({
      feature_area: 'ai',
      surface: 'modal',
      macro_type: 'sequence',
    }))
    wrapper.unmount()
  })

  it('does NOT fire ai_repair_dismissed when user applies the repair', async () => {
    vi.mocked(startFixDiagram as any).mockResolvedValue({ jobId: 'j1' })
    vi.mocked(getFixDiagramStatus as any).mockResolvedValue(COMPLETED_STATUS)

    const wrapper = mountRepair()
    await triggerRepair(wrapper)

    const applyBtn = wrapper.findAll('button').find(b => b.text().includes('Apply Code'))
    await applyBtn!.trigger('click')

    const eventNames = vi.mocked(trackAnalyticsEvent).mock.calls.map(c => c[0])
    expect(eventNames).not.toContain('ai_repair_dismissed')
    wrapper.unmount()
  })

  it('polls again after one second so completed repairs become visible promptly', async () => {
    vi.mocked(startFixDiagram as any).mockResolvedValue({ jobId: 'j1' })
    vi.mocked(getFixDiagramStatus as any)
      .mockResolvedValueOnce({ status: 'PROCESSING', message: 'Working', progress: 30 })
      .mockResolvedValueOnce(COMPLETED_STATUS)

    const wrapper = mountRepair()
    await triggerRepair(wrapper)

    expect(getFixDiagramStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(getFixDiagramStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()

    expect(getFixDiagramStatus).toHaveBeenCalledTimes(2)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_repair_succeeded',
      expect.objectContaining({ duration_ms: 1000, poll_count: 2 }),
    )
    wrapper.unmount()
  })

  it('uses one wall-clock budget instead of a fixed poll-attempt limit', async () => {
    vi.mocked(startFixDiagram as any).mockResolvedValue({ jobId: 'j1' })
    vi.mocked(getFixDiagramStatus as any).mockResolvedValue({
      status: 'PROCESSING',
      message: 'Working',
      progress: 30,
    })

    const wrapper = mountRepair()
    await triggerRepair(wrapper)
    await vi.advanceTimersByTimeAsync(60_000)
    await flushPromises()

    expect(getFixDiagramStatus).toHaveBeenCalledTimes(60)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_repair_failed',
      expect.objectContaining({
        failure_reason: 'client_timeout',
        failure_phase: 'timeout',
        duration_ms: 60_000,
        timeout_budget_ms: 60_000,
      }),
    )
    wrapper.unmount()
  })

  it('ignores an in-flight poll response after the dialog is closed', async () => {
    let resolveStatus: (value: typeof COMPLETED_STATUS) => void = () => {}
    vi.mocked(startFixDiagram as any).mockResolvedValue({ jobId: 'j1' })
    vi.mocked(getFixDiagramStatus as any).mockImplementation(
      () => new Promise(resolve => { resolveStatus = resolve }),
    )

    const wrapper = mountRepair()
    await triggerRepair(wrapper)
    const closeBtn = wrapper.find('[data-testid="ai-repair-dialog-content"] button')
    await closeBtn.trigger('click')

    resolveStatus(COMPLETED_STATUS)
    await flushPromises()

    const eventNames = vi.mocked(trackAnalyticsEvent).mock.calls.map(c => c[0])
    expect(eventNames).not.toContain('ai_repair_succeeded')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})
