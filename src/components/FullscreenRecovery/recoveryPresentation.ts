import type { RecoveryScenario, RecoverySnapshot } from '../../../shared/fullscreenRecovery'

export const scenarioLabels: Record<RecoveryScenario, string> = {
  inspect_details: 'Inspect details on my own',
  present: 'Present this diagram to others',
  discuss: 'Discuss it with colleagues',
  other: 'Something else',
}

export function fullLocalDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(date)
}

export function safeSupportMailto(snapshot: RecoverySnapshot): string | null {
  const address = snapshot.supportEmail
  if (!address || !/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(address)) return null
  const reference = snapshot.request?.id
  return `mailto:${address}${reference ? `?subject=${encodeURIComponent(`Fullscreen request ${reference}`)}` : ''}`
}
