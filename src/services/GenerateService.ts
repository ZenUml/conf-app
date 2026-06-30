import globals from '@/model/globals';
import { getContext } from '@/model/globals/forgeGlobal';
import {DiagramType} from "@/model/Diagram/Diagram";
import { callRemote } from '@/utils/requestUtil';

async function getDiagramlyIdentity() {
  const [user, context] = await Promise.all([
    globals.apWrapper._getCurrentUser(),
    getContext(),
  ]);

  return {
    accountId: user.atlassianAccountId,
    cloudId: context?.cloudId,
  };
}

export async function diagramlyChat(messages: Array<any>) {
  const identity = await getDiagramlyIdentity();
  return await callRemote(`/diagramly/chat`, 'POST', {
    ...identity,
    messages,
  });
}

export async function startFixDiagram(
  diagramCode: string,
  errorMessage: string,
  diagramType: DiagramType,
): Promise<{ jobId: string }> {
  const identity = await getDiagramlyIdentity();

  const startResponse = await callRemote(`/diagramly/fix-diagram`, 'POST', {
    ...identity,
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
  const identity = await getDiagramlyIdentity();

  const jobStatus = await callRemote(
    `/diagramly/job-status`,
    'POST',
    {
      jobId,
      ...identity,
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
