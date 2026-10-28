/**
 * Extension-internal messages on the `pr-panel` runtime port (content script
 * or options page ↔ background broker). Hub frames travel inside `frame`
 * envelopes unchanged and are re-validated with the shared schemas on both
 * sides; the rest is the broker's own status and control traffic.
 */
import { ExtensionFrameSchema, HubFrameSchema } from '@zenuml/pr-panel-shared'
import { z } from 'zod'

export const PORT_NAME = 'pr-panel'

export const HubStatusSchema = z.object({
  state: z.enum(['disabled', 'probing', 'connecting', 'connected', 'not_running']),
  port: z.number().int().positive().optional(),
  hubVersion: z.string().optional(),
  reason: z.enum(['not_running', 'closed', 'protocol_mismatch', 'origin_rejected', 'another_connection']).optional(),
  /** MCP access is on but the user has not granted the loopback host permission yet. */
  needsPermission: z.boolean().optional(),
})
export type HubStatusMessage = z.infer<typeof HubStatusSchema>

/** Page / options page → broker. */
export const PortRequestSchema = z.discriminatedUnion('kind', [
  /** First message on a port: which repo's reviews to replay. Answered with status + snapshot. */
  z.object({ kind: z.literal('hello'), documentId: z.string().min(1).optional(), repoKey: z.string().min(1).optional() }),
  /** Any ext → hub frame. The broker remembers `register` frames to replay after a Hub reconnect. */
  z.object({ kind: z.literal('frame'), frame: ExtensionFrameSchema }),
  z.object({ kind: z.literal('setMcpAccess'), value: z.enum(['enabled', 'disabled']) }),
  /** Options page, after the user granted the permission: probe now. */
  z.object({ kind: z.literal('reconnect') }),
  z.object({ kind: z.literal('openOptions') }),
  z.object({ kind: z.literal('continueGroup') }),
])
export type PortRequest = z.infer<typeof PortRequestSchema>

/** Broker → page / options page. */
export const PortEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status'), status: HubStatusSchema }),
  z.object({ kind: z.literal('frame'), frame: HubFrameSchema }),
])
export type PortEvent = z.infer<typeof PortEventSchema>

export function parsePortRequest(raw: unknown): PortRequest | null {
  const r = PortRequestSchema.safeParse(raw)
  return r.success ? r.data : null
}

export function parsePortEvent(raw: unknown): PortEvent | null {
  const r = PortEventSchema.safeParse(raw)
  return r.success ? r.data : null
}
