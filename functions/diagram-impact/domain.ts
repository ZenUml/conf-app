export type ViewerRelation = 'creator' | 'updater' | 'contributor' | 'viewer';
/**
 * `write_failed`: the audience row could not be written. The request still
 * answers 200 with the count that could be read, because DiagramAudience is a
 * derived table behind one footer line and Confluence is the system of record —
 * the same reasoning as indexDiagramOnSave. The failure is not swallowed: it
 * goes to Sentry, and the client turns this outcome into
 * `diagram_audience_registration_failed` rather than reporting a success.
 */
export type RegistrationResult = 'new_unique' | 'repeat' | 'excluded_contributor' | 'write_failed';

export interface ViewerRelationInput {
  accountId: string;
  createdByAccountId?: string;
  updatedByAccountId?: string;
  isHistoricalContributor: boolean;
}

export function classifyViewerRelation(input: ViewerRelationInput): ViewerRelation {
  if (input.accountId === input.createdByAccountId) return 'creator';
  if (input.accountId === input.updatedByAccountId) return 'updater';
  return input.isHistoricalContributor ? 'contributor' : 'viewer';
}

/**
 * Which viewport rule produced a row. 1 observed the 29px attribution footer
 * at `threshold: 0.5`; 2 observes the diagram and requires
 * `min(200px, half its height)` on screen. Counts written under the two rules
 * are not comparable, so the row records which one applied.
 *
 * An old client still running in a browser sends nothing, which reads as 1.
 * An unknown value also reads as 1 rather than being trusted.
 */
export type DwellGateVersion = 1 | 2;

export function normalizeGateVersion(value: unknown): DwellGateVersion {
  return value === 2 || value === '2' ? 2 : 1;
}

export function utcDayStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}
