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

export function utcDayStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}
