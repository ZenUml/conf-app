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
  // Test-only mock: avoid sending a real notification email during e2e.
  if (typeof localStorage !== 'undefined' && localStorage.mockNotifyAdmin) {
    try {
      const parsed = JSON.parse(localStorage.mockNotifyAdmin) as NotifyAdminResult
      console.log('🧪 Using mock notifyAdmin response:', parsed)
      return parsed
    } catch {
      return { notified: true, adminCount: 1 }
    }
  }
  try {
    const result = await callRemote('/api/notify-admin', 'POST', input as any)
    return result as NotifyAdminResult
  } catch (err) {
    console.error('notifyAdmin failed', err)
    return { notified: false, reason: 'client_error' }
  }
}
