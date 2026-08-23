import { callRemote } from '@/utils/requestUtil';

export type ExtensionTask =
  | 'architecture_design'
  | 'design_review'
  | 'technical_documentation'
  | 'incident_review'
  | 'understand_existing_system'
  | 'team_communication'
  | 'other';

export type ExtensionAudience =
  | 'self'
  | 'development_team'
  | 'architect_tech_lead'
  | 'manager_engineering_lead'
  | 'another_team'
  | 'security_platform_governance'
  | 'documentation_readers';

export type AiTool =
  | 'none'
  | 'github_copilot'
  | 'cursor'
  | 'claude_code'
  | 'chatgpt'
  | 'windsurf'
  | 'other'
  | 'not_sure';

export type AiDiagramUsage =
  | 'none'
  | 'ai_without_diagrams'
  | 'mermaid'
  | 'zenuml'
  | 'other_diagram_as_code'
  | 'not_sure';

export type ProcessRequirement =
  | 'required_template'
  | 'required_without_template'
  | 'not_required'
  | 'not_sure';
export type CloudAiPolicy = 'allowed' | 'restricted' | 'not_allowed' | 'not_sure';
export type ExtensionScope = 'self' | 'space' | 'site' | 'not_sure';
export type ExtensionUrgency = 'today' | 'this_week' | 'no_hard_deadline' | 'planning_ahead';
export type ExtensionUrgencyV2 = 'today' | 'this_week' | 'no_hard_deadline';
export type AiDiagramUse = 'regularly' | 'occasionally' | 'interested' | 'no';

export interface PaywallExtensionAnswers {
  /** Version 2 keeps only the operational answers needed for routing. */
  unblockNeed: {
    scope?: ExtensionScope;
    urgency?: ExtensionUrgencyV2;
  };
  /** Optional product-research answer; omitted when the user skips it. */
  aiDiagramUse?: AiDiagramUse;
}

export interface PaywallExtensionSubmissionV2 {
  spaceKey: string;
  macroCount: number;
  idempotencyKey: string;
  questionnaireVersion: 2;
  answers: {
    unblockNeed: { scope: ExtensionScope; urgency: ExtensionUrgencyV2 };
    aiDiagramUse?: AiDiagramUse;
  };
}

/** Legacy shape retained so old clients can roll out behind the new backend. */
export interface LegacyPaywallExtensionSubmission {
  spaceKey: string;
  macroCount: number;
  idempotencyKey: string;
  answers: {
    currentTask: ExtensionTask;
    diagramAudience: ExtensionAudience;
    aiAndDiagrams: { tools: AiTool[]; diagramUsage: AiDiagramUsage };
    workflowConstraints: { processRequirement: ProcessRequirement; cloudAiPolicy: CloudAiPolicy };
    unblockNeed: { scope: Exclude<ExtensionScope, 'not_sure'>; urgency: Exclude<ExtensionUrgency, 'no_hard_deadline' | 'planning_ahead'> };
  };
}

export type PaywallExtensionSubmission = PaywallExtensionSubmissionV2 | LegacyPaywallExtensionSubmission;

export interface PaywallAdminContactRouting {
  routingOutcome: 'automatic' | 'manual' | 'suppressed';
  reasonCodes: string[];
  overrideUsed: boolean;
  cacheAgeHours: number | null;
}

type PaywallExtensionResult =
  | {
      status: 'granted';
      requestId: string;
      isReplay: boolean;
      grant: {
        grantId: string;
        grantedAt: string;
        expiresAt: string;
        extensionDays: 7;
      };
    }
  | {
      status: 'manual_review';
      requestId: string;
      isReplay: boolean;
      priorGrantCount: 1;
      message: string;
    };

export type PaywallExtensionResponse = PaywallExtensionResult & {
  // Optional during a rolling backend/frontend deployment. Current backend
  // responses always include metadata and never include the contact address.
  adminContactRouting?: PaywallAdminContactRouting;
};

export type SubmitPaywallExtension = (
  submission: PaywallExtensionSubmission,
) => Promise<PaywallExtensionResponse>;

export const submitPaywallExtension: SubmitPaywallExtension = (submission) => (
  callRemote('/api/paywall-extension', 'POST', submission) as Promise<PaywallExtensionResponse>
);
