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
  output: { diagramCode: 'A->B: fixed' },
}

const FAILED_STATUS = {
  status: 'FAILED',
  message: 'Failed',
  progress: 0,
  output: null,
  error: 'Unknown error',
}

const ORIGINAL_CODE = 'A->B: hello'

const mountRepair = () =>
  mount(AIRepair, {
    props: {
      showDialog: false,
      originalCode: ORIGINAL_CODE,
      diagramType: 'Sequence',
      error: 'syntax error on line 1',
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
      failure_reason: expect.stringContaining('failed'),
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
      failure_reason: 'network error',
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
})
