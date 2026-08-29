import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureDiagramlyDiagram: vi.fn(),
  getDiagramlyJobStatus: vi.fn(),
  startDiagramChatModification: vi.fn(),
}))

vi.mock('@/services/GenerateService', () => mocks)

import { DiagramType } from '@/model/Diagram/Diagram'
import { runAIChatSession } from './AIChatSessionService'

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

  it.each([
    ['FAILED', 'Model unavailable'],
    ['CANCELLED', 'Request cancelled'],
  ] as const)('surfaces a %s terminal job without applying code', async (status, error) => {
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
    ).rejects.toThrow(error)
  })

  it('rejects completed jobs that did not persist a version', async () => {
    mocks.getDiagramlyJobStatus.mockResolvedValue({
      ...completedStatus,
      output: { diagramCode: 'A -> Payment' },
    })

    await expect(
      runAIChatSession({
        diagramId: 'diagram-1',
        diagramCode: 'A -> B',
        diagramType: DiagramType.Sequence,
        prompt: 'Add payment',
      }),
    ).rejects.toThrow('without a persisted version')
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
    ).rejects.toThrow('timed out after 0ms')
    expect(mocks.getDiagramlyJobStatus).toHaveBeenCalledOnce()
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
