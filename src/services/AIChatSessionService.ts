import type { DiagramType } from '@/model/Diagram/Diagram'
import {
  ensureDiagramlyDiagram,
  getDiagramlyJobStatus,
  startDiagramChatModification,
  type DiagramlyJobStatus,
} from '@/services/GenerateService'

export type AIChatSessionStage =
  | 'ensuring'
  | 'queued'
  | 'processing'
  | 'generating'
  | 'syncing'

export type AIChatFailurePhase =
  | 'ensure'
  | 'start'
  | 'poll'
  | 'server'
  | 'timeout'
  | 'sync'

export type AIChatFailureReason =
  | 'diagram_binding_failed'
  | 'diagram_id_missing'
  | 'job_start_failed'
  | 'job_id_missing'
  | 'status_poll_failed'
  | 'job_failed'
  | 'job_cancelled'
  | 'diagram_code_missing'
  | 'version_id_missing'
  | 'timeout'
  | 'unexpected_error'

export type AIChatFailureTelemetry = {
  failurePhase: AIChatFailurePhase
  failureReason: AIChatFailureReason
  pollCount: number
}

export class AIChatSessionError extends Error {
  readonly name = 'AIChatSessionError'

  constructor(
    message: string,
    readonly failurePhase: AIChatFailurePhase,
    readonly failureReason: AIChatFailureReason,
    readonly pollCount: number,
  ) {
    super(message)
  }
}

type AIChatSessionResultBase = {
  diagramId: string
  diagramCreated: boolean
  updatedCode: string
  jobId: string
  pollCount?: number
  repairAttempts?: number
  backendDurationMs?: number
  backendLlmDurationMs?: number
}

export type AIChatSessionResult =
  | (AIChatSessionResultBase & {
      noChange: true
      versionId?: never
      versionNumber?: never
      createdAt?: never
    })
  | (AIChatSessionResultBase & {
      noChange?: false
      versionId: string
      versionNumber?: number
      createdAt?: string
    })

export const AI_CHAT_NO_CHANGE_MESSAGE =
  'No changes were needed for the current diagram.'

export type RunAIChatSessionOptions = {
  diagramId?: string
  diagramCode: string
  diagramType: DiagramType | string
  prompt: string
  title?: string
  errorMessage?: string
  model?: string
  disableReasoning?: boolean
  timeoutMs?: number
  pollIntervalMs?: number
  signal?: AbortSignal
  onStage?: (stage: AIChatSessionStage, status?: DiagramlyJobStatus) => void
  onDiagramBound?: (diagramId: string) => void | Promise<void>
}

// Diagramly's provider layer allows a single model request to run for up to
// 120 seconds. Keep polling beyond that boundary so the worker has time to
// persist the completed version and expose it through job status.
export const AI_CHAT_SESSION_TIMEOUT_MS = 135_000
const DEFAULT_POLL_INTERVAL_MS = 2_000

function createAbortError(): Error {
  const error = new Error('AI Chat request was cancelled')
  error.name = 'AbortError'
  return error
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError()
}

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function sessionFailure(
  error: unknown,
  failurePhase: AIChatFailurePhase,
  failureReason: AIChatFailureReason,
  pollCount: number,
  fallbackMessage: string,
): AIChatSessionError {
  if (error instanceof AIChatSessionError) return error
  return new AIChatSessionError(
    failureMessage(error, fallbackMessage),
    failurePhase,
    failureReason,
    pollCount,
  )
}

export function getAIChatFailureTelemetry(error: unknown): AIChatFailureTelemetry {
  if (error instanceof AIChatSessionError) {
    return {
      failurePhase: error.failurePhase,
      failureReason: error.failureReason,
      pollCount: error.pollCount,
    }
  }
  return {
    failurePhase: 'sync',
    failureReason: 'unexpected_error',
    pollCount: 0,
  }
}

function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  assertNotAborted(signal)
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', handleAbort)
      reject(createAbortError())
    }

    signal?.addEventListener('abort', handleAbort, { once: true })
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, Math.max(0, delayMs))
  })
}

function stageFromStatus(
  status: DiagramlyJobStatus,
): AIChatSessionStage | undefined {
  if (status.status === 'QUEUED') return 'queued'
  if (status.status === 'PROCESSING') return 'processing'
  if (status.status === 'GENERATING') return 'generating'
  return undefined
}

export async function runAIChatSession(
  options: RunAIChatSessionOptions,
): Promise<AIChatSessionResult> {
  const timeoutMs = options.timeoutMs ?? AI_CHAT_SESSION_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  assertNotAborted(options.signal)

  let pollCount = 0

  let diagramId = options.diagramId?.trim() || ''
  let diagramCreated = false
  if (!diagramId) {
    options.onStage?.('ensuring')
    try {
      const ensured = await ensureDiagramlyDiagram({
        diagramCode: options.diagramCode,
        diagramType: options.diagramType,
        title: options.title,
      })
      assertNotAborted(options.signal)
      if (!ensured.diagramId?.trim()) {
        throw new AIChatSessionError(
          'Diagramly did not return a diagramId',
          'ensure',
          'diagram_id_missing',
          pollCount,
        )
      }

      diagramId = ensured.diagramId
      diagramCreated = true
      await options.onDiagramBound?.(diagramId)
      assertNotAborted(options.signal)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw sessionFailure(
        error,
        'ensure',
        'diagram_binding_failed',
        pollCount,
        'Failed to prepare the diagram for AI Chat',
      )
    }
  }

  let jobId = ''
  try {
    const started = await startDiagramChatModification({
      diagramId,
      diagramCode: options.diagramCode,
      prompt: options.prompt,
      diagramType: options.diagramType,
      ...(options.errorMessage !== undefined
        ? { errorMessage: options.errorMessage }
        : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(options.disableReasoning !== undefined
        ? { disableReasoning: options.disableReasoning }
        : {}),
    })
    assertNotAborted(options.signal)
    jobId = started.jobId?.trim() || ''
    if (!jobId) {
      throw new AIChatSessionError(
        'Diagramly did not return a jobId',
        'start',
        'job_id_missing',
        pollCount,
      )
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw sessionFailure(
      error,
      'start',
      'job_start_failed',
      pollCount,
      'Failed to start the AI Chat request',
    )
  }
  assertNotAborted(options.signal)
  options.onStage?.('queued')

  const deadline = Date.now() + Math.max(0, timeoutMs)
  while (true) {
    assertNotAborted(options.signal)
    pollCount += 1
    let status: DiagramlyJobStatus
    try {
      status = await getDiagramlyJobStatus(jobId)
    } catch (error) {
      if (options.signal?.aborted) throw createAbortError()
      throw sessionFailure(
        error,
        'poll',
        'status_poll_failed',
        pollCount,
        'Failed to read the AI Chat job status',
      )
    }
    assertNotAborted(options.signal)

    const stage = stageFromStatus(status)
    if (stage) options.onStage?.(stage, status)

    if (status.status === 'COMPLETED') {
      const updatedCode = status.output?.diagramCode
      if (!updatedCode) {
        throw new AIChatSessionError(
          'Diagramly job completed without diagram code',
          'sync',
          'diagram_code_missing',
          pollCount,
        )
      }

      const resultTelemetry = {
        ...(status.output?.repairAttempts !== undefined
          ? { repairAttempts: status.output.repairAttempts }
          : {}),
        ...(status.output?.durationMs !== undefined
          ? { backendDurationMs: status.output.durationMs }
          : {}),
        ...(status.output?.llmDurationMs !== undefined
          ? { backendLlmDurationMs: status.output.llmDurationMs }
          : {}),
      }

      if (status.output?.noChange === true) {
        if (options.errorMessage?.trim()) {
          throw new AIChatSessionError(
            'Diagramly syntax repair completed without a persisted change',
            'server',
            'job_failed',
            pollCount,
          )
        }
        return {
          diagramId,
          diagramCreated,
          updatedCode,
          noChange: true,
          jobId,
          pollCount,
          ...resultTelemetry,
        }
      }

      options.onStage?.('syncing', status)
      const versionId = status.output?.versionId
      if (!versionId) {
        throw new AIChatSessionError(
          'Diagramly job completed without a persisted version',
          'sync',
          'version_id_missing',
          pollCount,
        )
      }

      return {
        diagramId,
        diagramCreated,
        updatedCode,
        versionId,
        versionNumber: status.output?.versionNumber,
        createdAt: status.output?.createdAt,
        jobId,
        pollCount,
        ...resultTelemetry,
      }
    }

    if (status.status === 'FAILED' || status.status === 'CANCELLED') {
      throw new AIChatSessionError(
        status.error ||
          status.message ||
          `Diagram update ${status.status.toLowerCase()}`,
        'server',
        status.status === 'FAILED' ? 'job_failed' : 'job_cancelled',
        pollCount,
      )
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      throw new AIChatSessionError(
        `Diagram update timed out after ${timeoutMs}ms`,
        'timeout',
        'timeout',
        pollCount,
      )
    }
    await wait(Math.min(Math.max(0, pollIntervalMs), remainingMs), options.signal)
  }
}
