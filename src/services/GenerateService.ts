import {DiagramType} from "@/model/Diagram/Diagram";
import { callRemote } from '@/utils/requestUtil';

// Identity (accountId / cloudId) is intentionally NOT sent from the client.
// The Diagramly backend derives it from the verified Forge invocation token
// (see functions/diagramly/context.ts), so a client-supplied value could only
// be spoofed or drift out of sync with the authenticated caller.

export async function diagramlyChat(messages: Array<any>) {
  return await callRemote(`/diagramly/chat`, 'POST', { messages });
}

export interface AIRepairOptions {
  model?: string;
  disableReasoning?: boolean;
}

export type DiagramlyJobStatus = {
  id: string;
  status: 'QUEUED' | 'PROCESSING' | 'GENERATING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  message: string;
  output?: {
    diagramId?: string;
    diagramCode?: string;
    versionId?: string;
    versionNumber?: number;
    createdAt?: string;
    repairAttempts?: number;
    durationMs?: number;
    llmDurationMs?: number;
    timeBudgetMs?: number;
    model?: string;
    reasoningDisabled?: boolean;
    timedOut?: boolean;
  };
  error?: string;
}

export type DiagramlyVersion = {
  id: string;
  diagramId: string;
  title?: string;
  content?: { code?: string; subTypeKey?: string };
  instruction?: string;
  comment?: string;
  versionNumber: number;
  createdBy?: string;
  createdAt: string;
}

export type DiagramlyVersionsResult = {
  versions: DiagramlyVersion[];
  diagram?: {
    id: string;
    currentVersionId?: string;
    languageType?: string;
  } | null;
  draft?: { content?: { code?: string; subTypeKey?: string } } | null;
  seed?: unknown;
}

export type EnsureDiagramlyDiagramResult = {
  diagramId: string;
  versionId?: string;
  versionNumber?: number;
  createdAt?: string;
}

export type RestoreDiagramlyVersionResult = {
  diagramId: string;
  version: DiagramlyVersion;
  diagramCode: string;
}

export async function startFixDiagram(
  diagramCode: string,
  errorMessage: string,
  diagramType: DiagramType,
  options: AIRepairOptions = {},
): Promise<{ jobId: string }> {
  const startResponse = await callRemote(`/diagramly/fix-diagram`, 'POST', {
    diagramCode,
    errorMessage,
    diagramType,
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.disableReasoning !== undefined
      ? { disableReasoning: options.disableReasoning }
      : {}),
  });

  const { jobId } = startResponse as { jobId: string };
  console.log('Started async repair with jobId:', jobId);

  if (!jobId) {
    throw new Error('No jobId returned from server');
  }

  return { jobId };
}

const AI_CHAT_DIAGRAM_TYPES = new Set<string>([
  DiagramType.Sequence,
  DiagramType.Mermaid,
  DiagramType.OpenApi,
  'openapi',
  DiagramType.PlantUml,
]);

function assertAiChatDiagramType(diagramType: DiagramType | string): void {
  if (!AI_CHAT_DIAGRAM_TYPES.has(diagramType)) {
    throw new Error(`${diagramType} diagrams are not supported by AI Chat`);
  }
}

export async function startDiagramChatModification({
  diagramId,
  diagramCode,
  prompt,
  diagramType,
  errorMessage,
  model,
  disableReasoning,
}: {
  diagramId: string;
  diagramCode: string;
  prompt: string;
  diagramType: DiagramType | string;
  errorMessage?: string;
  model?: string;
  disableReasoning?: boolean;
}): Promise<{ jobId: string }> {
  if (!diagramId?.trim()) {
    throw new Error('AI Chat requires a Diagramly diagramId');
  }
  if (!diagramCode?.trim()) {
    throw new Error('AI Chat requires diagramCode');
  }
  if (!prompt?.trim()) {
    throw new Error('AI Chat requires a modification prompt');
  }
  assertAiChatDiagramType(diagramType);

  const startResponse = await callRemote('/diagramly/chat-modify', 'POST', {
    diagramId,
    diagramCode,
    command: prompt,
    diagramType,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(disableReasoning !== undefined ? { disableReasoning } : {}),
  });
  const { jobId } = startResponse as { jobId?: string };
  if (!jobId) {
    throw new Error('No jobId returned from server');
  }

  return { jobId };
}

export async function ensureDiagramlyDiagram({
  diagramId,
  diagramCode,
  diagramType,
  title,
}: {
  diagramId?: string;
  diagramCode?: string;
  diagramType: DiagramType | string;
  title?: string;
}): Promise<EnsureDiagramlyDiagramResult> {
  assertAiChatDiagramType(diagramType);
  if (!diagramId?.trim() && !diagramCode?.trim()) {
    throw new Error('AI Chat requires diagramCode when creating a diagram');
  }

  return await callRemote('/diagramly/ensure-diagram', 'POST', {
    ...(diagramId !== undefined ? { diagramId } : {}),
    ...(diagramCode !== undefined ? { diagramCode } : {}),
    diagramType,
    ...(title !== undefined ? { title } : {}),
  }) as EnsureDiagramlyDiagramResult;
}

export async function getDiagramlyVersions(
  diagramId: string,
): Promise<DiagramlyVersionsResult> {
  if (!diagramId?.trim()) {
    throw new Error('Missing diagramId');
  }

  return await callRemote('/diagramly/versions', 'POST', {
    diagramId,
  }) as DiagramlyVersionsResult;
}

export async function restoreDiagramlyVersion(
  diagramId: string,
  versionId: string,
): Promise<RestoreDiagramlyVersionResult> {
  if (!diagramId?.trim()) {
    throw new Error('Missing diagramId');
  }
  if (!versionId?.trim()) {
    throw new Error('Missing versionId');
  }

  return await callRemote('/diagramly/restore-version', 'POST', {
    diagramId,
    versionId,
  }) as RestoreDiagramlyVersionResult;
}

export async function getFixDiagramStatus(
  jobId: string
): Promise<DiagramlyJobStatus> {
  return getDiagramlyJobStatus(jobId);
}

export async function getDiagramlyJobStatus(
  jobId: string,
): Promise<DiagramlyJobStatus> {
  if (!jobId?.trim()) {
    throw new Error('Missing jobId');
  }

  return await callRemote(
    `/diagramly/job-status`,
    'POST',
    { jobId }
  ) as DiagramlyJobStatus;
}
