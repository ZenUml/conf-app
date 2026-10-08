export type ViewerAccountKind = 'anonymous' | 'guest' | 'licensed' | 'unknown';

// Red-phase scaffold: the specs import this module, so it must exist. The real
// implementation lands in the fix commit.
export async function viewerAccountKind(_input: {
  accountId?: string;
  clientDomain: string;
  now?: number;
  fetchCurrentUser?: () => Promise<unknown>;
}): Promise<ViewerAccountKind> {
  throw new Error('not implemented');
}
