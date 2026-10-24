/**
 * WebSocket frames between the extension's service worker and the Hub.
 * One connection per browser profile carries every GitHub tab; `documentId`
 * tells tabs apart. All frames are JSON text; binary frames are rejected.
 */
import { z } from 'zod'
import { MAX_MESSAGE_LENGTH } from './constants'
import {
  AgentClientSchema,
  DeliveryChannelSchema,
  PageSessionSchema,
  PrRefSchema,
  ReviewSummarySchema,
  TaskSchema,
} from './domain'

const Base = z.object({
  v: z.literal(1),
  /** Unique per frame; replies cite it in `inReplyTo`. */
  id: z.string().min(1),
  ts: z.number(),
})

// ---------------------------------------------------------------- ext → hub

export const HelloFrame = Base.extend({
  type: z.literal('hello'),
  extVersion: z.string().min(1),
  protocolVersion: z.number().int().positive(),
})

export const RegisterFrame = Base.extend({
  type: z.literal('register'),
  documentId: z.string().min(1),
  pr: PrRefSchema,
})

export const UnregisterFrame = Base.extend({
  type: z.literal('unregister'),
  documentId: z.string().min(1),
})

/** Badge click: make this tab the one the agent's next task binds to. */
export const ActivateFrame = Base.extend({
  type: z.literal('activate'),
  documentId: z.string().min(1),
})

export const ListReviewsFrame = Base.extend({
  type: z.literal('listReviews'),
  repoKey: z.string().min(1),
  /** Current head of the PR the tab shows, so the Hub can mark stale rows. */
  currentHeadSha: z.string().optional(),
})

export const UserMessageFrame = Base.extend({
  type: z.literal('userMessage'),
  documentId: z.string().min(1),
  taskId: z.string().optional(),
  text: z.string().min(1).max(MAX_MESSAGE_LENGTH),
})

export const CancelTaskFrame = Base.extend({
  type: z.literal('cancelTask'),
  taskId: z.string().min(1),
})

export const PingFrame = Base.extend({ type: z.literal('ping') })

/**
 * UI analytics the Hub forwards to Mixpanel under feature_area=pr_agent_panel,
 * surface=github_pr. Only these events and only bounded properties: the Hub
 * drops anything else, so a page can never smuggle identifiers through here.
 */
export const TelemetryFrame = Base.extend({
  type: z.literal('telemetry'),
  event: z.enum([
    'pr_panel_review_list_shown',
    'pr_panel_review_scope_applied',
    'pr_panel_review_row_clicked',
    'pr_panel_panel_toggled',
    'pr_panel_hub_connected',
    'pr_panel_hub_disconnected',
    'pr_panel_message_sent',
    'pr_panel_preferences_changed',
  ]),
  props: z
    .object({
      review_count: z.number().int().nonnegative().optional(),
      scope_mode: z.literal('mine').optional(),
      scope_outcome: z.enum(['resolved', 'identity_unavailable']).optional(),
      visible_review_count: z.number().int().nonnegative().optional(),
      excluded_review_count: z.number().int().nonnegative().optional(),
      row_index: z.number().int().nonnegative().optional(),
      is_stale: z.boolean().optional(),
      panel_state: z.enum(['expanded', 'collapsed']).optional(),
      connect_ms: z.number().nonnegative().optional(),
      hub_disconnect_reason: z
        .enum(['not_running', 'closed', 'protocol_mismatch', 'origin_rejected', 'another_connection'])
        .optional(),
      message_length_bucket: z.enum(['short', 'medium', 'long']).optional(),
      preference_key: z.enum(['panel_collapsed', 'preferences_hidden', 'mcp_access']).optional(),
    })
    .strict()
    .default({}),
})

export const ExtensionFrameSchema = z.discriminatedUnion('type', [
  HelloFrame,
  RegisterFrame,
  UnregisterFrame,
  ActivateFrame,
  ListReviewsFrame,
  UserMessageFrame,
  CancelTaskFrame,
  PingFrame,
  TelemetryFrame,
])
export type ExtensionFrame = z.infer<typeof ExtensionFrameSchema>

// ---------------------------------------------------------------- hub → ext

export const RegisteredFrame = Base.extend({
  type: z.literal('registered'),
  protocolVersion: z.number().int().positive(),
  hubVersion: z.string().min(1),
  inReplyTo: z.string().min(1),
})

/** Full snapshot; sent after `registered`, after every change, and on request. */
export const StateFrame = Base.extend({
  type: z.literal('state'),
  activeDocumentId: z.string().nullable(),
  sessions: z.array(PageSessionSchema),
  agents: z.array(AgentClientSchema),
  tasks: z.array(TaskSchema),
})

export const ReviewsFrame = Base.extend({
  type: z.literal('reviews'),
  repoKey: z.string().min(1),
  items: z.array(ReviewSummarySchema),
  inReplyTo: z.string().optional(),
})

export const TaskEventPayload = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('started'), task: TaskSchema }),
  z.object({ kind: z.literal('progress'), text: z.string().max(200) }),
  z.object({ kind: z.literal('message'), text: z.string().max(MAX_MESSAGE_LENGTH) }),
  z.object({ kind: z.literal('published'), runId: z.string().min(1) }),
  z.object({ kind: z.literal('completed') }),
  z.object({ kind: z.literal('failed'), reason: z.string().max(500) }),
  z.object({ kind: z.literal('cancelled') }),
])
export type TaskEventPayload = z.infer<typeof TaskEventPayload>

export const TaskEventFrame = Base.extend({
  type: z.literal('taskEvent'),
  taskId: z.string().min(1),
  /** Monotonic per task; the extension drops anything it has already seen. */
  seq: z.number().int().nonnegative(),
  documentId: z.string().optional(),
  event: TaskEventPayload,
})

export const MessageQueuedFrame = Base.extend({
  type: z.literal('messageQueued'),
  messageId: z.string().min(1),
  inReplyTo: z.string().min(1),
  /** No agent is connected or none is in a turn: the panel says "queued". */
  waitingForAgent: z.boolean(),
})

export const MessageDeliveredFrame = Base.extend({
  type: z.literal('messageDelivered'),
  messageId: z.string().min(1),
  channel: DeliveryChannelSchema,
})

export const ErrorFrame = Base.extend({
  type: z.literal('error'),
  code: z.enum([
    'protocol_mismatch',
    'bad_frame',
    'unknown_document',
    'unknown_task',
    'task_not_cancellable',
    'rate_limited',
    'internal',
  ]),
  message: z.string().max(500),
  inReplyTo: z.string().optional(),
})

export const PongFrame = Base.extend({ type: z.literal('pong'), inReplyTo: z.string().min(1) })

export const HubFrameSchema = z.discriminatedUnion('type', [
  RegisteredFrame,
  StateFrame,
  ReviewsFrame,
  TaskEventFrame,
  MessageQueuedFrame,
  MessageDeliveredFrame,
  ErrorFrame,
  PongFrame,
])
export type HubFrame = z.infer<typeof HubFrameSchema>

/** Shape of `GET http://127.0.0.1:{port}/`; lets a probe tell our Hub from a stranger. */
export const HubProbeResponseSchema = z.object({
  service: z.string().min(1),
  protocolVersion: z.number().int().positive(),
  hubVersion: z.string().min(1),
})
export type HubProbeResponse = z.infer<typeof HubProbeResponseSchema>

export function parseExtensionFrame(text: string): ExtensionFrame | null {
  return safeParseJson(text, ExtensionFrameSchema)
}

export function parseHubFrame(text: string): HubFrame | null {
  return safeParseJson(text, HubFrameSchema)
}

function safeParseJson<T extends z.ZodType>(text: string, schema: T): z.infer<T> | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const result = schema.safeParse(raw)
  return result.success ? result.data : null
}
