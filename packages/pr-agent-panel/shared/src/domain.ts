import { z } from 'zod'
import {
  MAX_FINDINGS_PER_REVIEW,
  MAX_HEADLINE_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_TAGS_PER_REVIEW,
  MAX_TAG_LENGTH,
} from './constants'

export const ShaSchema = z.string().regex(/^[0-9a-f]{7,40}$/i)

/** Identity of one pull request as the page shows it. `title` stays local; it is never sent to analytics. */
export const PrRefSchema = z.object({
  host: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().positive(),
  headSha: ShaSchema.optional(),
  title: z.string().max(300).optional(),
  url: z.string().url().optional(),
})
export type PrRef = z.infer<typeof PrRefSchema>

export const RepoRefSchema = PrRefSchema.pick({ host: true, owner: true, repo: true })
export type RepoRef = z.infer<typeof RepoRefSchema>

/** Case-insensitive key: `github.com/owner/repo`. */
export function repoKeyOf(ref: RepoRef): string {
  return `${ref.host}/${ref.owner}/${ref.repo}`.toLowerCase()
}

export const AgentKindSchema = z.enum(['claude_code', 'codex', 'other'])
export type AgentKind = z.infer<typeof AgentKindSchema>

export const TaskKindSchema = z.enum(['review', 'chat'])
export type TaskKind = z.infer<typeof TaskKindSchema>

export const TaskStatusSchema = z.enum(['working', 'finished', 'failed', 'cancelled'])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

export const SeveritySchema = z.enum(['blocker', 'major', 'minor', 'nit'])
export type Severity = z.infer<typeof SeveritySchema>

export const PrioritySchema = z.enum(['P0', 'P1', 'P2', 'P3'])
export type Priority = z.infer<typeof PrioritySchema>

export const MergeReadinessSchema = z.enum(['ready', 'blocked', 'unknown'])
export type MergeReadiness = z.infer<typeof MergeReadinessSchema>

export const PrStateSchema = z.enum(['open', 'draft', 'merged', 'closed', 'unknown'])
export type PrState = z.infer<typeof PrStateSchema>

export const ReviewRunStatusSchema = z.enum(['running', 'completed', 'failed', 'cancelled'])
export type ReviewRunStatus = z.infer<typeof ReviewRunStatusSchema>

export const DeliveryChannelSchema = z.enum(['hook_context', 'stop_block', 'prompt_context', 'tool_poll'])
export type DeliveryChannel = z.infer<typeof DeliveryChannelSchema>

export const FindingInputSchema = z.object({
  severity: SeveritySchema,
  filePath: z.string().max(512).optional(),
  line: z.number().int().positive().optional(),
  explanation: z.string().min(1).max(MAX_SUMMARY_LENGTH),
})
export type FindingInput = z.infer<typeof FindingInputSchema>

export const FindingSchema = FindingInputSchema.extend({ id: z.string().min(1) })
export type Finding = z.infer<typeof FindingSchema>

export const TagsSchema = z.array(z.string().min(1).max(MAX_TAG_LENGTH)).max(MAX_TAGS_PER_REVIEW)

/** One AI review of one PR head. Persisted by the Hub; the left list shows only `completed` runs. */
export const ReviewRunSchema = z.object({
  runId: z.string().min(1),
  repoKey: z.string().min(1),
  pr: PrRefSchema,
  reviewedHeadSha: ShaSchema,
  status: ReviewRunStatusSchema,
  headline: z.string().max(MAX_HEADLINE_LENGTH),
  summary: z.string().max(MAX_SUMMARY_LENGTH),
  priority: PrioritySchema.optional(),
  findings: z.array(FindingSchema).max(MAX_FINDINGS_PER_REVIEW),
  tags: TagsSchema,
  prState: PrStateSchema,
  mergeable: z.boolean().optional(),
  startedAt: z.number(),
  completedAt: z.number().optional(),
  agentKind: AgentKindSchema,
  agentSessionId: z.string().optional(),
})
export type ReviewRun = z.infer<typeof ReviewRunSchema>

/** What one row of the left list needs. Derived from the latest completed run per PR. */
export const ReviewSummarySchema = z.object({
  runId: z.string().min(1),
  repoKey: z.string().min(1),
  prNumber: z.number().int().positive(),
  url: z.string().url(),
  headline: z.string(),
  summary: z.string(),
  priority: PrioritySchema.optional(),
  tags: TagsSchema,
  prState: PrStateSchema,
  /** Live GitHub merge signal; absent in older Hub payloads means unknown. */
  readiness: MergeReadinessSchema.optional(),
  readinessReason: z.string().max(100).optional(),
  /** `mergeable === false` at review time. */
  conflict: z.boolean(),
  /** The PR's current head differs from the reviewed head; the row keeps the old verdict and says so. */
  stale: z.boolean(),
  completedAt: z.number(),
})
export type ReviewSummary = z.infer<typeof ReviewSummarySchema>

export function toReviewSummary(run: ReviewRun, currentHeadSha?: string): ReviewSummary {
  const url = run.pr.url ?? `https://${run.pr.host}/${run.pr.owner}/${run.pr.repo}/pull/${run.pr.number}`
  return {
    runId: run.runId,
    repoKey: run.repoKey,
    prNumber: run.pr.number,
    url,
    headline: run.headline,
    summary: run.summary,
    priority: run.priority,
    tags: run.tags,
    prState: run.prState,
    readiness: 'unknown',
    conflict: run.mergeable === false,
    stale: isStale(run.reviewedHeadSha, currentHeadSha),
    completedAt: run.completedAt ?? run.startedAt,
  }
}

/** Stale only when both SHAs are known and differ; an unknown current head is not evidence of change. */
export function isStale(reviewedHeadSha: string, currentHeadSha?: string): boolean {
  if (!currentHeadSha) return false
  const a = reviewedHeadSha.toLowerCase()
  const b = currentHeadSha.toLowerCase()
  const n = Math.min(a.length, b.length)
  return a.slice(0, n) !== b.slice(0, n)
}

/** A message typed in the panel, queued by the Hub until an agent channel takes it. */
export const PanelMessageSchema = z.object({
  messageId: z.string().min(1),
  taskId: z.string().optional(),
  documentId: z.string().min(1),
  repoKey: z.string().min(1),
  prNumber: z.number().int().positive(),
  text: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  createdAt: z.number(),
  deliveredAt: z.number().optional(),
  channel: DeliveryChannelSchema.optional(),
})
export type PanelMessage = z.infer<typeof PanelMessageSchema>

export const AgentClientSchema = z.object({
  kind: AgentKindSchema,
  sessionId: z.string().optional(),
  connectedAt: z.number(),
})
export type AgentClient = z.infer<typeof AgentClientSchema>

/** One agent task bound to one PR and, when a tab shows that PR, to that tab. */
export const TaskSchema = z.object({
  taskId: z.string().min(1),
  kind: TaskKindSchema,
  repoKey: z.string().min(1),
  prNumber: z.number().int().positive(),
  headSha: ShaSchema.optional(),
  documentId: z.string().optional(),
  agent: AgentClientSchema,
  status: TaskStatusSchema,
  /** Latest progress text, shown with the shimmer while `working`. */
  label: z.string().max(200).optional(),
  runId: z.string().optional(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
})
export type Task = z.infer<typeof TaskSchema>

/** A tab's registration: which PR it shows. */
export const PageSessionSchema = z.object({
  documentId: z.string().min(1),
  pr: PrRefSchema,
  registeredAt: z.number(),
})
export type PageSession = z.infer<typeof PageSessionSchema>
