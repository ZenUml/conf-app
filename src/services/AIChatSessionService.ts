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

export type AIChatSessionResult = {
  diagramId: string
  diagramCreated: boolean
  updatedCode: string
  versionId: string
  versionNumber?: number
  createdAt?: string
  jobId: string
}

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

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_POLL_INTERVAL_MS = 2_000

function createAbortError(): Error {
  const error = new Error('AI Chat request was cancelled')
  error.name = 'AbortError'
  return error
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError()
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  assertNotAborted(options.signal)

  let diagramId = options.diagramId?.trim() || ''
  let diagramCreated = false
  if (!diagramId) {
    options.onStage?.('ensuring')
    const ensured = await ensureDiagramlyDiagram({
      diagramCode: options.diagramCode,
      diagramType: options.diagramType,
      title: options.title,
    })
    assertNotAborted(options.signal)
    if (!ensured.diagramId?.trim()) {
      throw new Error('Diagramly did not return a diagramId')
    }

    diagramId = ensured.diagramId
    diagramCreated = true
    await options.onDiagramBound?.(diagramId)
    assertNotAborted(options.signal)
  }

  const { jobId } = await startDiagramChatModification({
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
  options.onStage?.('queued')

  const deadline = Date.now() + Math.max(0, timeoutMs)
  while (true) {
    assertNotAborted(options.signal)
    const status = await getDiagramlyJobStatus(jobId)
    assertNotAborted(options.signal)

    const stage = stageFromStatus(status)
    if (stage) options.onStage?.(stage, status)

    if (status.status === 'COMPLETED') {
      options.onStage?.('syncing', status)
      const updatedCode = status.output?.diagramCode
      const versionId = status.output?.versionId
      if (!updatedCode) {
        throw new Error('Diagramly job completed without diagram code')
      }
      if (!versionId) {
        throw new Error('Diagramly job completed without a persisted version')
      }

      return {
        diagramId,
        diagramCreated,
        updatedCode,
        versionId,
        versionNumber: status.output?.versionNumber,
        createdAt: status.output?.createdAt,
        jobId,
      }
    }

    if (status.status === 'FAILED' || status.status === 'CANCELLED') {
      throw new Error(
        status.error ||
          status.message ||
          `Diagram update ${status.status.toLowerCase()}`,
      )
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      throw new Error(`Diagram update timed out after ${timeoutMs}ms`)
    }
    await wait(Math.min(Math.max(0, pollIntervalMs), remainingMs), options.signal)
  }
}
