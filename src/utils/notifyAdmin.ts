import { callRemote } from '@/utils/requestUtil'

export interface NotifyAdminInput {
  spaceKey: string
  requesterDisplayName?: string
  macroId?: string
}

export interface NotifyAdminResult {
  notified: boolean
  reason?: 'rate_limited' | 'no_admins' | 'send_failed' | 'client_error'
  adminCount?: number
}

export async function notifyAdmin(input: NotifyAdminInput): Promise<NotifyAdminResult> {
  try {
    const result = await callRemote('/api/notify-admin', 'POST', input as any)
    return result as NotifyAdminResult
  } catch (err) {
    console.error('notifyAdmin failed', err)
    return { notified: false, reason: 'client_error' }
  }
}
