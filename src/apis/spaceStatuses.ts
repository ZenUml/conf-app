import { callRemote } from '@/utils/requestUtil'

export interface PaidStatus { isPaid: boolean; decisionKnown: boolean }
/** One authenticated Forge request for all rows; omitted/invalid results stay unknown. */
export async function getSpaceStatuses(spaceKeys: string[]): Promise<Record<string, PaidStatus>> {
  const statuses: Record<string, PaidStatus> = {}
  // Keep batches within the server's bounded request size.
  for (let i = 0; i < Math.ceil(spaceKeys.length / 200); i++) {
    const keys = spaceKeys.slice(i * 200, (i + 1) * 200)
    const query = keys.map(key => `spaceKey=${encodeURIComponent(key)}`).join('&')
    const response = await callRemote(`/api/space-status?${query}`, 'GET')
    const result = keys.length === 1 ? { [keys[0]]: response } : response?.statuses
    if (!result || typeof result !== 'object') throw new Error('Paid status unavailable')
    for (const key of keys) {
      const status = result[key]
      if (status && typeof status.isPaid === 'boolean' && typeof status.decisionKnown === 'boolean') statuses[key] = status
    }
  }
  return statuses
}
