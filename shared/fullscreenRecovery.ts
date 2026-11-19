/** Public recovery contract. Customer identity is always derived from a verified FIT. */

/** One recovery gate serves several features. Add a feature here and in the definition table below. */
export const RECOVERY_FEATURES = ['fullscreen', 'edit'] as const;
export type RecoveryFeature = typeof RECOVERY_FEATURES[number];

/** What differs per feature in the shared contract. Literal types are kept so each stays a union, not `string`. */
export const RECOVERY_FEATURE_DEFINITIONS = {
  fullscreen: {
    policyVersion: 'fullscreen-contact-v1',
    scenarios: ['inspect_details', 'present', 'discuss', 'other'],
  },
  edit: {
    policyVersion: 'edit-contact-v1',
    scenarios: ['fix_or_update', 'keep_current', 'prepare_review', 'other'],
  },
} as const satisfies Record<RecoveryFeature, { policyVersion: string; scenarios: readonly string[] }>;

export type RecoveryPolicyVersion = typeof RECOVERY_FEATURE_DEFINITIONS[RecoveryFeature]['policyVersion'];
export type RecoveryScenario = typeof RECOVERY_FEATURE_DEFINITIONS[RecoveryFeature]['scenarios'][number];
/** The scenario codes of one feature. */
export type RecoveryFeatureScenario<F extends RecoveryFeature> = typeof RECOVERY_FEATURE_DEFINITIONS[F]['scenarios'][number];

/** An absent value means `fullscreen`, the only feature older clients know; any unknown value is `null`. */
export function resolveRecoveryFeature(value: unknown): RecoveryFeature | null {
  if (value === undefined) return 'fullscreen';
  return (RECOVERY_FEATURES as readonly unknown[]).includes(value) ? value as RecoveryFeature : null;
}

export const FULLSCREEN_RECOVERY_POLICY_VERSION = RECOVERY_FEATURE_DEFINITIONS.fullscreen.policyVersion;
export const FULLSCREEN_RECOVERY_SCENARIOS = RECOVERY_FEATURE_DEFINITIONS.fullscreen.scenarios;
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
  policyVersion: RecoveryPolicyVersion;
  exemptionOverrideReviewed?: boolean;
  /** `edit` only: the free limit shown to the user ("reached the free limit of N diagrams"). The server decides; the client never compares it. */
  limit?: number;
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
  consentVersion: RecoveryPolicyVersion;
  /** Omitted for `fullscreen`, so the wire format stays what older clients send. */
  feature?: RecoveryFeature;
  contentId?: string;
  customContentId?: string;
  spaceKey: string;
}

export interface RecoveryActivateInput {
  action: 'activate';
  attemptId: string;
  requestId: string;
  spaceKey: string;
  /** Omitted for `fullscreen`. */
  feature?: RecoveryFeature;
}

export interface RecoveryResult {
  snapshot: RecoverySnapshot;
  outcome?: 'created' | 'reused' | 'activated' | 'already_active';
}
