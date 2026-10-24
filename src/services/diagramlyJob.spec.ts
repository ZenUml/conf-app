import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getDiagramlyJobStatus: vi.fn() }))
vi.mock('@/services/GenerateService', () => ({
  getDiagramlyJobStatus: mocks.getDiagramlyJobStatus,
}))

import { DiagramlyJobPollError, pollDiagramlyJob } from '@/services/diagramlyJob'

const status = (s: string, extra: Record<string, unknown> = {}) => ({
  id: 'job-1',
  status: s,
  progress: 10,
  message: s,
  ...extra,
})

const settle = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  )

describe('pollDiagramlyJob', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.getDiagramlyJobStatus.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(['COMPLETED', 'FAILED', 'CANCELLED'])('resolves with a %s status', async (terminal) => {
    mocks.getDiagramlyJobStatus.mockResolvedValue(status(terminal))
    const onStatus = vi.fn()
    const result = await pollDiagramlyJob('job-1', {
      deadlineMs: Date.now() + 10_000,
      intervalMs: 1000,
      onStatus,
    })
    expect(result.status).toBe(terminal)
    expect(onStatus).not.toHaveBeenCalled()
    expect(mocks.getDiagramlyJobStatus).toHaveBeenCalledWith('job-1')
  })

  it('calls onStatus for each non-terminal status and waits the interval', async () => {
    mocks.getDiagramlyJobStatus
      .mockResolvedValueOnce(status('QUEUED'))
      .mockResolvedValueOnce(status('PROCESSING'))
      .mockResolvedValueOnce(status('COMPLETED'))
    const onStatus = vi.fn()
    const onPoll = vi.fn()
    const promise = pollDiagramlyJob('job-1', {
      deadlineMs: Date.now() + 60_000,
      intervalMs: 1000,
      onStatus,
      onPoll,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.getDiagramlyJobStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(mocks.getDiagramlyJobStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.getDiagramlyJobStatus).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(promise).resolves.toMatchObject({ status: 'COMPLETED' })
    expect(onStatus.mock.calls.map(([s]) => s.status)).toEqual(['QUEUED', 'PROCESSING'])
    expect(onPoll.mock.calls.map(([n]) => n)).toEqual([1, 2, 3])
  })

  it('rejects with timeout when the budget ends between polls', async () => {
    mocks.getDiagramlyJobStatus.mockResolvedValue(status('PROCESSING'))
    const outcome = settle(
      pollDiagramlyJob('job-1', { deadlineMs: Date.now() + 2500, intervalMs: 1000 }),
    )
    await vi.advanceTimersByTimeAsync(2500)
    const { error } = (await outcome) as { error: DiagramlyJobPollError }
    expect(error).toBeInstanceOf(DiagramlyJobPollError)
    expect(error).toMatchObject({ kind: 'timeout', pollCount: 4 })
    expect(mocks.getDiagramlyJobStatus).toHaveBeenCalledTimes(3)
  })

  it('rejects with timeout when the deadline hits while a request is in flight', async () => {
    mocks.getDiagramlyJobStatus.mockImplementation(() => new Promise(() => {}))
    const outcome = settle(
      pollDiagramlyJob('job-1', { deadlineMs: Date.now() + 5000, intervalMs: 1000 }),
    )
    await vi.advanceTimersByTimeAsync(4999)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(1)
    const { error } = (await outcome) as { error: DiagramlyJobPollError }
    expect(error).toMatchObject({ kind: 'timeout', pollCount: 1 })
  })

  it('rejects with aborted when aborted during the wait between polls', async () => {
    mocks.getDiagramlyJobStatus.mockResolvedValue(status('PROCESSING'))
    const controller = new AbortController()
    const outcome = settle(
      pollDiagramlyJob('job-1', {
        signal: controller.signal,
        deadlineMs: Date.now() + 60_000,
        intervalMs: 1000,
      }),
    )
    await vi.advanceTimersByTimeAsync(500)
    controller.abort()
    const { error } = (await outcome) as { error: DiagramlyJobPollError }
    expect(error).toMatchObject({ kind: 'aborted', pollCount: 1 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.getDiagramlyJobStatus).toHaveBeenCalledTimes(1)
  })

  it('rejects with aborted when aborted while a request is in flight, and ignores its result', async () => {
    let resolveStatus: (value: unknown) => void = () => {}
    mocks.getDiagramlyJobStatus.mockImplementation(
      () => new Promise((resolve) => { resolveStatus = resolve }),
    )
    const controller = new AbortController()
    const onStatus = vi.fn()
    const outcome = settle(
      pollDiagramlyJob('job-1', {
        signal: controller.signal,
        deadlineMs: Date.now() + 60_000,
        intervalMs: 1000,
        onStatus,
      }),
    )
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    resolveStatus(status('COMPLETED'))
    const { error } = (await outcome) as { error: DiagramlyJobPollError }
    expect(error).toMatchObject({ kind: 'aborted', pollCount: 1 })
    expect(onStatus).not.toHaveBeenCalled()
  })

  it('rejects with aborted without polling when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      pollDiagramlyJob('job-1', {
        signal: controller.signal,
        deadlineMs: Date.now() + 1000,
        intervalMs: 1000,
      }),
    ).rejects.toMatchObject({ kind: 'aborted', pollCount: 0 })
    expect(mocks.getDiagramlyJobStatus).not.toHaveBeenCalled()
  })

  it('rejects with poll_failed, keeping the cause and message, when a request throws', async () => {
    const cause = new Error('Unavailable')
    mocks.getDiagramlyJobStatus
      .mockResolvedValueOnce(status('PROCESSING'))
      .mockRejectedValueOnce(cause)
    const outcome = settle(
      pollDiagramlyJob('job-1', { deadlineMs: Date.now() + 60_000, intervalMs: 1000 }),
    )
    await vi.advanceTimersByTimeAsync(1000)
    const { error } = (await outcome) as { error: DiagramlyJobPollError }
    expect(error).toBeInstanceOf(DiagramlyJobPollError)
    expect(error).toMatchObject({ kind: 'poll_failed', pollCount: 2, message: 'Unavailable' })
    expect(error.cause).toBe(cause)
  })
})
