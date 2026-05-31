import globals from '@/model/globals';
import {DiagramType} from "@/model/Diagram/Diagram";
import { callRemote } from '@/utils/requestUtil';

export async function diagramlyChat(messages: Array<any>) {
  return await callRemote(`/diagramly/chat`, 'POST', {
      accountId: (await globals.apWrapper._getCurrentUser()).atlassianAccountId,
      messages
    });
}

export async function startFixDiagram(
  diagramCode: string,
  errorMessage: string,
  diagramType: DiagramType,
): Promise<{ jobId: string }> {
  const accountId = (await globals.apWrapper._getCurrentUser()).atlassianAccountId;

  const startResponse = await callRemote(`/diagramly/fix-diagram`, 'POST', {
    accountId,
    diagramCode,
    errorMessage,
    diagramType: diagramType
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
  output?: { diagramCode: string };
  error?: string;
}> {
  const accountId = (await globals.apWrapper._getCurrentUser()).atlassianAccountId;

  const jobStatus = await callRemote(
    `/diagramly/job-status`,
    'POST',
    {
      jobId,
      accountId
    }
  ) as {
    id: string;
    status: 'QUEUED' | 'PROCESSING' | 'GENERATING' | 'COMPLETED' | 'FAILED';
    progress: number;
    message: string;
    output?: { diagramCode: string };
    error?: string;
  };

  return jobStatus;
}
