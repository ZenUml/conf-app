import { requestConfluenceJson as request } from '@/utils/byline/confluenceRequest'

/**
 * Can this person edit the page? True only on an OK response that says so;
 * every other outcome, including a throw, is false (no offer).
 */
export async function canEditPage(pageId: string, accountId: string): Promise<boolean> {
  try {
    const res = await request(`/wiki/rest/api/content/${encodeURIComponent(pageId)}/permission/check`, 'POST', {
      subject: { type: 'user', identifier: accountId },
      operation: 'update',
    })
    if (!res.ok) return false
    const body = await res.json()
    return body?.hasPermission === true
  } catch {
    return false
  }
}
