/**
 * MCP tool contract the Hub exposes to the agent (Claude Code, Codex, …).
 * Input schemas are what the tool advertises; output schemas are what
 * `structuredContent` carries. The agent side only ever calls these: the
 * extension never sees MCP.
 */
import { z } from 'zod'
import {
  MAX_HEADLINE_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_SUMMARY_LENGTH,
  WAIT_FOR_MESSAGES_MAX_MS,
} from './constants'
import {
  FindingInputSchema,
  PanelMessageSchema,
  PrRefSchema,
  PrStateSchema,
  PrioritySchema,
  RepoRefSchema,
  ReviewRunSchema,
  ShaSchema,
  TagsSchema,
  TaskKindSchema,
  TaskSchema,
} from './domain'

export const TOOL_NAMES = [
  'get_active_pr',
  'begin_task',
  'report_progress',
  'post_message',
  'publish_review',
  'complete_task',
  'read_review_history',
  'delete_review_entry',
  'list_panel_messages',
  'wait_for_panel_messages',
] as const
export type ToolName = (typeof TOOL_NAMES)[number]

export const GetActivePrInput = z.object({})
export const GetActivePrOutput = z.object({
  pr: PrRefSchema.nullable(),
  documentId: z.string().nullable(),
  /** Other registered tabs, so the agent can name a PR the user is not looking at. */
  otherPrs: z.array(PrRefSchema),
})

export const BeginTaskInput = z.object({
  repo: RepoRefSchema,
  prNumber: z.number().int().positive(),
  headSha: ShaSchema.optional(),
  kind: TaskKindSchema.default('review'),
  /** First progress label, e.g. "Reading the diff". */
  label: z.string().max(200).optional(),
})
export const BeginTaskOutput = z.object({
  taskId: z.string().min(1),
  /** The tab showing that PR, if any; the panel there shows the task row. */
  documentId: z.string().nullable(),
  /** Pending messages the user already typed for this PR. */
  pendingMessages: z.array(PanelMessageSchema),
})

export const ReportProgressInput = z.object({
  taskId: z.string().min(1),
  text: z.string().min(1).max(200),
})
export const ReportProgressOutput = z.object({ ok: z.literal(true) })

export const PostMessageInput = z.object({
  taskId: z.string().min(1),
  text: z.string().min(1).max(MAX_MESSAGE_LENGTH),
})
export const PostMessageOutput = z.object({ ok: z.literal(true) })

export const PublishReviewInput = z.object({
  taskId: z.string().min(1),
  headSha: ShaSchema.optional(),
  headline: z.string().min(1).max(MAX_HEADLINE_LENGTH),
  summary: z.string().min(1).max(MAX_SUMMARY_LENGTH),
  priority: PrioritySchema.optional(),
  findings: z.array(FindingInputSchema).default([]),
  tags: TagsSchema.default([]),
  prState: PrStateSchema.default('unknown'),
  mergeable: z.boolean().optional(),
  /** GitHub login of the PR author (`gh pr view --json author`). Lets "My PRs" show the row before a status sync. */
  authorLogin: z.string().min(1).max(39).optional(),
})
export const PublishReviewOutput = z.object({ runId: z.string().min(1) })

export const CompleteTaskInput = z.object({
  taskId: z.string().min(1),
  outcome: z.enum(['completed', 'cancelled', 'failed']).default('completed'),
  reason: z.string().max(500).optional(),
})
export const CompleteTaskOutput = z.object({ task: TaskSchema })

export const ReadReviewHistoryInput = z.object({
  repo: RepoRefSchema,
  prNumber: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(50).default(10),
})
export const ReadReviewHistoryOutput = z.object({ runs: z.array(ReviewRunSchema) })

/** Remove the list entry and all its earlier local reviews so an older run cannot reappear. */
export const DeleteReviewEntryInput = z.object({
  repo: RepoRefSchema,
  prNumber: z.number().int().positive(),
})
export const DeleteReviewEntryOutput = z.object({
  deleted: z.boolean(),
  deletedRuns: z.number().int().nonnegative(),
})

export const ListPanelMessagesInput = z.object({
  taskId: z.string().optional(),
  /** Only messages created after this epoch-ms. */
  since: z.number().optional(),
})
export const ListPanelMessagesOutput = z.object({ messages: z.array(PanelMessageSchema) })

export const WaitForPanelMessagesInput = z.object({
  taskId: z.string().optional(),
  timeoutMs: z.number().int().positive().max(WAIT_FOR_MESSAGES_MAX_MS).default(WAIT_FOR_MESSAGES_MAX_MS),
})
export const WaitForPanelMessagesOutput = ListPanelMessagesOutput

export const TOOL_SCHEMAS = {
  get_active_pr: { input: GetActivePrInput, output: GetActivePrOutput },
  begin_task: { input: BeginTaskInput, output: BeginTaskOutput },
  report_progress: { input: ReportProgressInput, output: ReportProgressOutput },
  post_message: { input: PostMessageInput, output: PostMessageOutput },
  publish_review: { input: PublishReviewInput, output: PublishReviewOutput },
  complete_task: { input: CompleteTaskInput, output: CompleteTaskOutput },
  read_review_history: { input: ReadReviewHistoryInput, output: ReadReviewHistoryOutput },
  delete_review_entry: { input: DeleteReviewEntryInput, output: DeleteReviewEntryOutput },
  list_panel_messages: { input: ListPanelMessagesInput, output: ListPanelMessagesOutput },
  wait_for_panel_messages: { input: WaitForPanelMessagesInput, output: WaitForPanelMessagesOutput },
} as const
