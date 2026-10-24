import { withTimeout } from '@/lib/withTimeout.js'
import {
  getDiagramlyJobStatus,
  type DiagramlyJobStatus,
} from '@/services/GenerateService'

export type DiagramlyJobPollFailureKind = 'timeout' | 'poll_failed' | 'aborted'

export class DiagramlyJobPollError extends Error {
  readonly kind: DiagramlyJobPollFailureKind
  readonly pollCount: number
  readonly cause?: unknown

  constructor(
    kind: DiagramlyJobPollFailureKind,
    pollCount: number,
    message: string,
    cause?: unknown,
  ) {
    super(message)
    this.name = 'DiagramlyJobPollError'
    this.kind = kind
    this.pollCount = pollCount
    this.cause = cause
  }
}

export interface PollDiagramlyJobOptions {
  signal?: AbortSignal
  /** Absolute wall-clock deadline (epoch ms) for the whole poll, in-flight request included. */
  deadlineMs: number
  intervalMs: number
  /** Called with each non-terminal status. */
  onStatus?: (status: DiagramlyJobStatus, pollCount: number) => void
  /** Called just before each status request, so callers can mirror the poll count. */
  onPoll?: (pollCount: number) => void
}

const TERMINAL: ReadonlyArray<DiagramlyJobStatus['status']> = ['COMPLETED', 'FAILED', 'CANCELLED']

function waitAbortable(delayMs: number, signal?: AbortSignal): Promise<boolean> {
  // Resolves true when the delay elapsed, false when aborted first.
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false)
    const onAbort = () => {
      clearTimeout(timer)
      resolve(false)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, Math.max(0, delayMs))
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Poll a Diagramly job until it reaches COMPLETED, FAILED or CANCELLED.
 * Rejects with DiagramlyJobPollError (kind timeout | poll_failed | aborted).
 */
export async function pollDiagramlyJob(
  jobId: string,
  options: PollDiagramlyJobOptions,
): Promise<DiagramlyJobStatus> {
  const { signal, deadlineMs, intervalMs, onStatus, onPoll } = options
  let pollCount = 0

  const aborted = () =>
    new DiagramlyJobPollError('aborted', pollCount, 'Diagramly job polling was aborted')
  const timedOut = () =>
    new DiagramlyJobPollError('timeout', pollCount, 'Diagramly job polling timed out')

  while (true) {
    if (signal?.aborted) throw aborted()
    pollCount += 1
    onPoll?.(pollCount)

    const remainingMs = deadlineMs - Date.now()
    if (remainingMs <= 0) throw timedOut()

    let status: DiagramlyJobStatus
    try {
      status = await withTimeout(getDiagramlyJobStatus(jobId), remainingMs, timedOut)
    } catch (error) {
      if (error instanceof DiagramlyJobPollError) throw error
      if (signal?.aborted) throw aborted()
      throw new DiagramlyJobPollError(
        'poll_failed',
        pollCount,
        error instanceof Error ? error.message : 'Failed to read the job status',
        error,
      )
    }
    if (signal?.aborted) throw aborted()

    if (TERMINAL.includes(status.status)) return status
    onStatus?.(status, pollCount)

    const leftMs = deadlineMs - Date.now()
    if (leftMs <= 0) throw timedOut()
    if (!(await waitAbortable(Math.min(Math.max(0, intervalMs), leftMs), signal))) {
      throw aborted()
    }
  }
}
