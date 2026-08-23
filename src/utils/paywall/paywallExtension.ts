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
export type ExtensionScope = 'self' | 'space' | 'site';
export type ExtensionUrgency = 'today' | 'this_week' | 'planning_ahead';

export interface PaywallExtensionAnswers {
  currentTask?: ExtensionTask;
  diagramAudience?: ExtensionAudience;
  aiAndDiagrams: {
    tools: AiTool[];
    diagramUsage?: AiDiagramUsage;
  };
  workflowConstraints: {
    processRequirement?: ProcessRequirement;
    cloudAiPolicy?: CloudAiPolicy;
  };
  unblockNeed: {
    scope?: ExtensionScope;
    urgency?: ExtensionUrgency;
  };
}

export interface PaywallExtensionSubmission {
  spaceKey: string;
  macroCount: number;
  idempotencyKey: string;
  answers: {
    currentTask: ExtensionTask;
    diagramAudience: ExtensionAudience;
    aiAndDiagrams: { tools: AiTool[]; diagramUsage: AiDiagramUsage };
    workflowConstraints: { processRequirement: ProcessRequirement; cloudAiPolicy: CloudAiPolicy };
    unblockNeed: { scope: ExtensionScope; urgency: ExtensionUrgency };
  };
}

export type PaywallExtensionResponse =
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

export type SubmitPaywallExtension = (
  submission: PaywallExtensionSubmission,
) => Promise<PaywallExtensionResponse>;

export const submitPaywallExtension: SubmitPaywallExtension = (submission) => (
  callRemote('/api/paywall-extension', 'POST', submission) as Promise<PaywallExtensionResponse>
);
