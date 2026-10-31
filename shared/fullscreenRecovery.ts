/** Public recovery contract. Customer identity is always derived from a verified FIT. */
export const FULLSCREEN_RECOVERY_POLICY_VERSION = 'fullscreen-contact-v1' as const;
export const FULLSCREEN_RECOVERY_SCENARIOS = ['inspect_details', 'present', 'discuss', 'other'] as const;
export type RecoveryScenario = typeof FULLSCREEN_RECOVERY_SCENARIOS[number];
export type RecoveryState = 'disabled' | 'not_requested' | 'pending_activation' | 'active' | 'expired' | 'unavailable';
export type RecoveryMailState = 'queued' | 'accepted' | 'delivered' | 'bounced' | 'failed' | 'delivery_unknown';
export type RecoverySupportOutcome = 'customer_replied' | 'next_step_agreed' | 'closed';

export interface RecoveryRequest {
  id: string;
  scenarios: RecoveryScenario[];
  note: string;
  email: string;
  createdAt: string;
  mailState?: RecoveryMailState;
  supportOutcome?: RecoverySupportOutcome;
}

export interface RecoveryGrant {
  id: string;
  activatedAt: string | null;
  expiresAt: string | null;
}

export interface RecoverySnapshot {
  state: RecoveryState;
  serverNow: string;
  policyVersion: typeof FULLSCREEN_RECOVERY_POLICY_VERSION;
  exemptionOverrideReviewed?: boolean;
  supportEmail?: string;
  request?: RecoveryRequest;
  grant?: RecoveryGrant;
}

export interface RecoveryRequestInput {
  action: 'request';
  attemptId: string;
  scenarios: RecoveryScenario[];
  note: string;
  email: string;
  consent: true;
  consentVersion: typeof FULLSCREEN_RECOVERY_POLICY_VERSION;
  contentId?: string;
  customContentId?: string;
  spaceKey: string;
}

export interface RecoveryActivateInput {
  action: 'activate';
  attemptId: string;
  requestId: string;
  spaceKey: string;
}

export interface RecoveryResult {
  snapshot: RecoverySnapshot;
  outcome?: 'created' | 'reused' | 'activated' | 'already_active';
}
