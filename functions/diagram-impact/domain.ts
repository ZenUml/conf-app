export type ViewerRelation = 'creator' | 'updater' | 'contributor' | 'viewer';
export type RegistrationResult = 'new_unique' | 'repeat' | 'excluded_contributor';

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
