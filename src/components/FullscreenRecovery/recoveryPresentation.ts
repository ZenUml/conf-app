import type { RecoveryFeature, RecoveryFeatureScenario, RecoveryScenario, RecoverySnapshot } from '../../../shared/fullscreenRecovery'

/** Every string that names the feature lives here, keyed by feature. Add a feature by adding a key. */
interface RecoveryCopy<F extends RecoveryFeature> {
  eyebrow: string
  scenarioLabels: Record<RecoveryFeatureScenario<F>, string>
  scenariosTitle: string
  /** `limit` is the free limit the server reported; copy that does not state it ignores it. */
  scenariosLead: (limit?: number) => string
  contactLead: string
  contactIncluded: string
  readyTitle: string
  readyLead: string
  openLabel: string
  expiredTitle: string
  expiredLead: (when: string | null) => string
  expiredPrompt: string
  pendingNote: string
  repliedPrompt: string
  backLabel: string
  summaryLabel: string
  mailSubject: (reference: string) => string
  statusPending: string
  statusActive: (when: string | null) => string
  statusExpired: (when: string | null) => string
  dismissLabel: string
}

export const recoveryCopy: { [F in RecoveryFeature]: RecoveryCopy<F> } = {
  fullscreen: {
    eyebrow: 'ZenUML Lite · Fullscreen',
    scenarioLabels: {
      inspect_details: 'Inspect details on my own',
      present: 'Present this diagram to others',
      discuss: 'Discuss it with colleagues',
      other: 'Something else',
    },
    scenariosTitle: 'How will you use Fullscreen?',
    scenariosLead: () => 'This space has reached the free limit of 100 diagrams. Tell us what you need. After your request is saved, you can use Fullscreen for 7 days starting with your first successful opening.',
    contactLead: "We'll reply about this Fullscreen request at the address you provide.",
    contactIncluded: 'Current Confluence site, diagram reference, and your Fullscreen use.',
    readyTitle: 'Fullscreen is ready',
    readyLead: 'Your 7 days have not started. They begin when the diagram first opens successfully in Fullscreen.',
    openLabel: 'Open Fullscreen',
    expiredTitle: 'Your temporary Fullscreen access has ended',
    expiredLead: when => `It ended ${when ?? ''}. You can still read the diagram on this page.`,
    expiredPrompt: "Still need Fullscreen? Continue your existing request. You don't need to repeat your use case.",
    pendingNote: 'Your 7 days begin when the diagram first opens successfully in Fullscreen.',
    repliedPrompt: 'If you still need Fullscreen, reply to the original email and tell us what you need to do next. Support will review it. A reply does not automatically extend access.',
    backLabel: 'Back to diagram',
    summaryLabel: 'Fullscreen request summary',
    mailSubject: reference => `Fullscreen request ${reference}`,
    statusPending: 'Your 7 days of Fullscreen begin when the diagram first opens successfully.',
    statusActive: when => `Temporary Fullscreen access ends ${when}.`,
    statusExpired: when => `Temporary Fullscreen access ended ${when}. This open view can continue; access is checked next time you open Fullscreen.`,
    dismissLabel: 'Dismiss Fullscreen access notice',
  },
  edit: {
    eyebrow: 'ZenUML Lite · Editing',
    scenarioLabels: {
      fix_or_update: 'Fix or update a diagram',
      keep_current: 'Keep our documentation current',
      prepare_review: 'Prepare for a review or release',
      other: 'Something else',
    },
    scenariosTitle: 'How will you edit diagrams?',
    scenariosLead: limit => `This site has reached the free limit of ${limit ?? 100} diagrams. Tell us what you need. After your request is saved, you can edit for 7 days starting with your first successful save.`,
    contactLead: "We'll reply about this editing request at the address you provide.",
    contactIncluded: 'Current Confluence site, diagram reference, and your editing use.',
    readyTitle: 'Editing is ready',
    readyLead: 'Your 7 days have not started. They begin when you first save a diagram successfully.',
    openLabel: 'Open editor',
    expiredTitle: 'Your temporary editing access has ended',
    expiredLead: when => `It ended ${when ?? ''}. You can still read the diagram on this page.`,
    expiredPrompt: "Still need to edit? Continue your existing request. You don't need to repeat your use case.",
    pendingNote: 'Your 7 days begin when you first save a diagram successfully.',
    repliedPrompt: 'If you still need to edit, reply to the original email and tell us what you need to do next. Support will review it. A reply does not automatically extend access.',
    backLabel: 'Back to diagram',
    summaryLabel: 'Editing request summary',
    mailSubject: reference => `Editing request ${reference}`,
    statusPending: 'Your 7 days of editing begin when you first save a diagram successfully.',
    statusActive: when => `Temporary editing access ends ${when}.`,
    statusExpired: when => `Temporary editing access ended ${when}.`,
    dismissLabel: 'Dismiss editing access notice',
  },
}

export const scenarioLabels: Record<RecoveryFeatureScenario<'fullscreen'>, string> = recoveryCopy.fullscreen.scenarioLabels

/** Label for a scenario code of `feature`. */
export function scenarioLabel(feature: RecoveryFeature, code: RecoveryScenario): string {
  return (recoveryCopy[feature].scenarioLabels as Record<string, string>)[code]
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

export function safeSupportMailto(snapshot: RecoverySnapshot, feature: RecoveryFeature = 'fullscreen'): string | null {
  const address = snapshot.supportEmail
  if (!address || !/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(address)) return null
  const reference = snapshot.request?.id
  return `mailto:${address}${reference ? `?subject=${encodeURIComponent(recoveryCopy[feature].mailSubject(reference))}` : ''}`
}
