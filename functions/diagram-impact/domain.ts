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

export interface ViewerKeyInput {
  secret: string;
  cloudId: string;
  accountId: string;
}

const textEncoder = new TextEncoder();

/**
 * A tenant-scoped pseudonymous key for a passive audience member. The raw
 * account ID never reaches D1, response bodies, or logs.
 */
export async function deriveViewerKey(input: ViewerKeyInput): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(input.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const message = `diagram-audience-v1\0${input.cloudId}\0${input.accountId}`;
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function utcDayStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}
