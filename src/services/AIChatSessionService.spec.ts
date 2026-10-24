import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureDiagramlyDiagram: vi.fn(),
  getDiagramlyJobStatus: vi.fn(),
  startDiagramChatModification: vi.fn(),
}))

vi.mock('@/services/GenerateService', () => mocks)

import { DiagramType } from '@/model/Diagram/Diagram'
import {
  AI_CHAT_SESSION_TIMEOUT_MS,
  getAIChatFailureTelemetry,
  runAIChatSession,
} from './AIChatSessionService'

const completedStatus = {
  id: 'job-1',
  status: 'COMPLETED' as const,
  progress: 100,
  message: 'Complete',
  output: {
    diagramCode: 'A -> Payment',
    versionId: 'version-2',
    versionNumber: 2,
    createdAt: '2026-08-28T00:00:00.000Z',
  },
}

describe('runAIChatSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startDiagramChatModification.mockResolvedValue({ jobId: 'job-1' })
    mocks.getDiagramlyJobStatus.mockResolvedValue(completedStatus)
  })

  it('uses an existing binding and reports the async job stages', async () => {
    const stages: string[] = []
    mocks.getDiagramlyJobStatus
      .mockResolvedValueOnce({
        id: 'job-1',
        status: 'PROCESSING',
        progress: 10,
        message: 'Starting',
      })
      .mockResolvedValueOnce({
        id: 'job-1',
        status: 'GENERATING',
        progress: -1,
        message: 'Generating',
      })
      .mockResolvedValueOnce(completedStatus)

    await expect(
      runAIChatSession({
        diagramId: 'diagram-1',
        diagramCode: 'A -> B',
        diagramType: DiagramType.Sequence,
        prompt: 'Add payment',
        pollIntervalMs: 0,
        onStage: (stage) => stages.push(stage),
      }),
    ).resolves.toEqual({
      diagramId: 'diagram-1',
      diagramCreated: false,
      updatedCode: 'A -> Payment',
      versionId: 'version-2',
      versionNumber: 2,
      createdAt: '2026-08-28T00:00:00.000Z',
      jobId: 'job-1',
      pollCount: 3,
    })

    expect(mocks.ensureDiagramlyDiagram).not.toHaveBeenCalled()
    expect(stages).toEqual([
      'queued',
      'processing',
      'generating',
      'syncing',
    ])
  })

  it('creates and binds a diagram before starting its first modification', async () => {
    const order: string[] = []
    mocks.ensureDiagramlyDiagram.mockImplementation(async () => {
      order.push('ensure')
      return { diagramId: 'diagram-new', versionId: 'version-1' }
    })
    mocks.startDiagramChatModification.mockImplementation(async () => {
      order.push('start')
      return { jobId: 'job-1' }
    })

    const result = await runAIChatSession({
      diagramCode: 'A -> B',
      diagramType: DiagramType.Sequence,
      prompt: 'Add payment',
      title: 'Checkout',
      onDiagramBound: async (diagramId) => {
        order.push(`bind:${diagramId}`)
      },
    })

    expect(result).toMatchObject({
      diagramId: 'diagram-new',
      diagramCreated: true,
    })
    expect(order).toEqual(['ensure', 'bind:diagram-new', 'start'])
    expect(mocks.ensureDiagramlyDiagram).toHaveBeenCalledWith({
      diagramCode: 'A -> B',
      diagramType: DiagramType.Sequence,
      title: 'Checkout',
    })
  })

  it('returns a benign no-change result without requiring a persisted version', async () => {
    const stages: string[] = []
    mocks.getDiagramlyJobStatus.mockResolvedValue({
      id: 'job-1',
      status: 'COMPLETED',
      progress: 100,
      message: 'No changes needed',
      output: {
        diagramCode: 'A -> B',
        noChange: true,
        repairAttempts: 3,
        durationMs: 2400,
        llmDurationMs: 2100,
      },
    })

    await expect(
      runAIChatSession({
        diagramId: 'diagram-1',
        diagramCode: 'A -> B',
        diagramType: DiagramType.Sequence,
        prompt: 'Optimize it',
        onStage: (stage) => stages.push(stage),
      }),
    ).resolves.toEqual({
      diagramId: 'diagram-1',
      diagramCreated: false,
      updatedCode: 'A -> B',
      noChange: true,
      jobId: 'job-1',
      pollCount: 1,
      repairAttempts: 3,
      backendDurationMs: 2400,
      backendLlmDurationMs: 2100,
    })
    expect(stages).toEqual(['queued'])
  })

  it('keeps a no-change syntax repair on the failure path', async () => {
    mocks.getDiagramlyJobStatus.mockResolvedValue({
      id: 'job-1',
      status: 'COMPLETED',
      progress: 100,
      message: 'No changes needed',
      output: {
        diagramCode: 'A -> B)',
        noChange: true,
      },
    })

    await expect(
      runAIChatSession({
        diagramId: 'diagram-1',
        diagramCode: 'A -> B)',
        diagramType: DiagramType.Sequence,
        prompt: 'Fix the syntax issue',
        errorMessage: 'Unexpected token',
      }),
    ).rejects.toMatchObject({
      failurePhase: 'server',
      failureReason: 'job_failed',
      pollCount: 1,
    })
  })

  it.each([
    ['FAILED', 'Model unavailable', 'job_failed'],
    ['CANCELLED', 'Request cancelled', 'job_cancelled'],
  ] as const)('surfaces a %s terminal job without applying code', async (
    status,
    error,
    failureReason,
  ) => {
    mocks.getDiagramlyJobStatus.mockResolvedValue({
      id: 'job-1',
      status,
      progress: 100,
      message: 'Stopped',
      error,
    })

    await expect(
      runAIChatSession({
        diagramId: 'diagram-1',
        diagramCode: 'A -> B',
        diagramType: DiagramType.Sequence,
        prompt: 'Add payment',
      }),
    ).rejects.toMatchObject({
      message: error,
      failurePhase: 'server',
      failureReason,
      pollCount: 1,
    })
  })

  it.each([
    [{ versionId: 'version-2' }, 'diagram_code_missing'],
    [{ diagramCode: 'A -> Payment' }, 'version_id_missing'],
  ] as const)('classifies incomplete completed-job output', async (output, failureReason) => {
    mocks.getDiagramlyJobStatus.mockResolvedValue({ ...completedStatus, output })

    await expect(
      runAIChatSession({
        diagramId: 'diagram-1',
        diagramCode: 'A -> B',
        diagramType: DiagramType.Sequence,
        prompt: 'Add payment',
      }),
    ).rejects.toMatchObject({
      failurePhase: 'sync',
      failureReason,
      pollCount: 1,
    })
  })

  it('uses one wall-clock timeout budget for polling', async () => {
    mocks.getDiagramlyJobStatus.mockResolvedValue({
      id: 'job-1',
      status: 'QUEUED',
      progress: 0,
      message: 'Waiting',
    })

    await expect(
      runAIChatSession({
        diagramId: 'diagram-1',
        diagramCode: 'A -> B',
        diagramType: DiagramType.Sequence,
        prompt: 'Add payment',
        timeoutMs: 0,
      }),
    ).rejects.toMatchObject({
      message: 'Diagram update timed out after 0ms',
      failurePhase: 'timeout',
      failureReason: 'timeout',
      pollCount: 1,
    })
    expect(mocks.getDiagramlyJobStatus).toHaveBeenCalledOnce()
  })

  it('keeps polling beyond the provider\'s two-minute request budget', () => {
    expect(AI_CHAT_SESSION_TIMEOUT_MS).toBeGreaterThan(120_000)
  })

  it('classifies diagram preparation request and response failures', async () => {
    mocks.ensureDiagramlyDiagram.mockRejectedValueOnce(new Error('Unavailable'))

    await expect(
      runAIChatSession({
        diagramCode: 'A -> B',
        diagramType: DiagramType.Sequence,
        prompt: 'Add payment',
      }),
    ).rejects.toMatchObject({
      failurePhase: 'ensure',
      failureReason: 'diagram_binding_failed',
      pollCount: 0,
    })

    mocks.ensureDiagramlyDiagram.mockResolvedValueOnce({ diagramId: '' })
    await expect(
      runAIChatSession({
        diagramCode: 'A -> B',
        diagramType: DiagramType.Sequence,
        prompt: 'Add payment',
      }),
    ).rejects.toMatchObject({
      failurePhase: 'ensure',
      failureReason: 'diagram_id_missing',
      pollCount: 0,
    })
  })

  it('classifies job start request and response failures', async () => {
    mocks.startDiagramChatModification.mockRejectedValueOnce(new Error('Unavailable'))

    await expect(
      runAIChatSession({
        diagramId: 'diagram-1',
        diagramCode: 'A -> B',
        diagramType: DiagramType.Sequence,
        prompt: 'Add payment',
      }),
    ).rejects.toMatchObject({
      failurePhase: 'start',
      failureReason: 'job_start_failed',
      pollCount: 0,
    })

    mocks.startDiagramChatModification.mockResolvedValueOnce({ jobId: '' })
    await expect(
      runAIChatSession({
        diagramId: 'diagram-1',
        diagramCode: 'A -> B',
        diagramType: DiagramType.Sequence,
        prompt: 'Add payment',
      }),
    ).rejects.toMatchObject({
      failurePhase: 'start',
      failureReason: 'job_id_missing',
      pollCount: 0,
    })
  })

  it('classifies status polling failures with the attempted poll count', async () => {
    mocks.getDiagramlyJobStatus.mockRejectedValueOnce(new Error('Unavailable'))

    await expect(
      runAIChatSession({
        diagramId: 'diagram-1',
        diagramCode: 'A -> B',
        diagramType: DiagramType.Sequence,
        prompt: 'Add payment',
      }),
    ).rejects.toMatchObject({
      failurePhase: 'poll',
      failureReason: 'status_poll_failed',
      pollCount: 1,
    })
  })

  it('maps unknown UI-layer errors to a privacy-safe fallback category', () => {
    expect(getAIChatFailureTelemetry(new Error('Sensitive raw detail'))).toEqual({
      failurePhase: 'sync',
      failureReason: 'unexpected_error',
      pollCount: 0,
    })
  })

  it('does not start work for an already aborted request', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      runAIChatSession({
        diagramId: 'diagram-1',
        diagramCode: 'A -> B',
        diagramType: DiagramType.Sequence,
        prompt: 'Add payment',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.startDiagramChatModification).not.toHaveBeenCalled()
  })
})
