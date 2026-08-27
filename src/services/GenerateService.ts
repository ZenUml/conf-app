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

export async function getFixDiagramStatus(
  jobId: string
): Promise<{
  id: string;
  status: 'QUEUED' | 'PROCESSING' | 'GENERATING' | 'COMPLETED' | 'FAILED';
  progress: number;
  message: string;
  output?: {
    diagramCode?: string;
    repairAttempts?: number;
    durationMs?: number;
    timeBudgetMs?: number;
    model?: string;
    reasoningDisabled?: boolean;
    timedOut?: boolean;
  };
  error?: string;
}> {
  const jobStatus = await callRemote(
    `/diagramly/job-status`,
    'POST',
    { jobId }
  ) as {
    id: string;
    status: 'QUEUED' | 'PROCESSING' | 'GENERATING' | 'COMPLETED' | 'FAILED';
    progress: number;
    message: string;
    output?: {
      diagramCode?: string;
      repairAttempts?: number;
      durationMs?: number;
      timeBudgetMs?: number;
      model?: string;
      reasoningDisabled?: boolean;
      timedOut?: boolean;
    };
    error?: string;
  };

  return jobStatus;
}
