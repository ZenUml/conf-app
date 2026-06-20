import globals from '@/model/globals';
import {DiagramType} from "@/model/Diagram/Diagram";
import { callRemote } from '@/utils/requestUtil';

const DEFAULT_FIX_COMMAND = 'Please resolve the issue with minimal code modifications. Preserve the original style and comments. Only address the errors; if the code lacks clarity, use the fewest words possible to improve it.';

const localDiagramlyTypeMap: Partial<Record<DiagramType | string, { diagramType: string; subTypeKey: string }>> = {
  [DiagramType.Sequence]: { diagramType: 'sequence', subTypeKey: 'GENERAL' },
  [DiagramType.Mermaid]: { diagramType: 'flow', subTypeKey: 'FLOWCHART' },
  [DiagramType.OpenApi]: { diagramType: 'openapi', subTypeKey: 'GENERAL' },
  openapi: { diagramType: 'openapi', subTypeKey: 'GENERAL' },
  [DiagramType.PlantUml]: { diagramType: 'plantuml', subTypeKey: 'GENERAL' },
};

export type DiagramlyJobStatus = {
  id: string;
  status: 'QUEUED' | 'PROCESSING' | 'GENERATING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  message: string;
  output?: { diagramCode?: string };
  error?: string;
}

function isStandaloneEnv(): boolean {
  try {
    return typeof window !== 'undefined' && window.self === window.top;
  } catch {
    return false;
  }
}

function shouldUseLocalDiagramlyApi(): boolean {
  if (import.meta.env.MODE !== 'development' || !isStandaloneEnv()) {
    return false;
  }

  const localApiEnabled = import.meta.env.VITE_DIAGRAMLY_LOCAL_API_ENABLED;
  if (localApiEnabled === 'true') return true;
  if (localApiEnabled === 'false') return false;

  return import.meta.env.PRODUCT_TYPE === 'diagramly';
}

async function getCurrentAccountId(): Promise<string> {
  return (await globals.apWrapper._getCurrentUser()).atlassianAccountId;
}

function getLocalDiagramlyTypeInfo(diagramType: DiagramType | string) {
  const typeInfo = localDiagramlyTypeMap[diagramType];
  if (!typeInfo) {
    throw new Error(`Unsupported diagram type for AI Chat: ${diagramType}`);
  }
  return typeInfo;
}

function extractJobId(result: any): string {
  const jobId = result?.jobId || result?.data?.jobId || result?.id;
  if (!jobId) {
    throw new Error('No jobId returned from server');
  }
  return jobId;
}

async function callLocalDiagramlyApi<T>(
  path: string,
  payload: any,
  accountId: string,
): Promise<T> {
  const baseUrl = (import.meta.env.VITE_DIAGRAMLY_LOCAL_API_BASE_URL || '').replace(/\/$/, '');
  const apiKey = import.meta.env.VITE_DIAGRAMLY_LOCAL_API_KEY;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-external-id': accountId,
  };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  let body: any;
  try {
    body = responseText ? JSON.parse(responseText) : undefined;
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    const message = body?.error || body?.details || responseText || 'No body';
    throw new Error(`HTTP ${response.status}: ${message}`);
  }

  return body as T;
}

export async function diagramlyChat(messages: Array<any>) {
  const accountId = await getCurrentAccountId();
  if (shouldUseLocalDiagramlyApi()) {
    return await callLocalDiagramlyApi(`/api/chat/messages`, { messages }, accountId);
  }

  return await callRemote(`/diagramly/chat`, 'POST', {
      accountId,
      messages
    });
}

export async function startFixDiagram(
  diagramCode: string,
  errorMessage: string,
  diagramType: DiagramType,
): Promise<{ jobId: string }> {
  const accountId = await getCurrentAccountId();

  if (shouldUseLocalDiagramlyApi()) {
    const typeInfo = getLocalDiagramlyTypeInfo(diagramType);
    const startResponse = await callLocalDiagramlyApi(`/api/chat/modify-async`, {
      diagramCode,
      diagramType: typeInfo.diagramType,
      command: DEFAULT_FIX_COMMAND,
      errorMessage,
      subTypeKey: typeInfo.subTypeKey,
    }, accountId);

    const jobId = extractJobId(startResponse);
    console.log('Started local async repair with jobId:', jobId);
    return { jobId };
  }

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

export async function startDiagramChatModification({
  diagramCode,
  prompt,
  diagramType,
  errorMessage,
}: {
  diagramCode: string;
  prompt: string;
  diagramType: DiagramType | string;
  errorMessage?: string;
}): Promise<{ jobId: string }> {
  if (diagramType === DiagramType.Graph || diagramType === 'graph') {
    throw new Error('Graph diagrams are not supported by AI Chat yet');
  }

  const accountId = await getCurrentAccountId();

  if (shouldUseLocalDiagramlyApi()) {
    const typeInfo = getLocalDiagramlyTypeInfo(diagramType);
    const startResponse = await callLocalDiagramlyApi(`/api/chat/modify-async`, {
      diagramCode,
      diagramType: typeInfo.diagramType,
      command: prompt,
      errorMessage,
      subTypeKey: typeInfo.subTypeKey,
    }, accountId);

    return { jobId: extractJobId(startResponse) };
  }

  const startResponse = await callRemote(`/diagramly/chat-modify`, 'POST', {
    accountId,
    diagramCode,
    command: prompt,
    errorMessage,
    diagramType,
  });

  const { jobId } = startResponse as { jobId: string };
  if (!jobId) {
    throw new Error('No jobId returned from server');
  }

  return { jobId };
}

export async function getFixDiagramStatus(
  jobId: string
): Promise<DiagramlyJobStatus> {
  return getDiagramlyJobStatus(jobId);
}

export async function getDiagramlyJobStatus(
  jobId: string
): Promise<DiagramlyJobStatus> {
  const accountId = await getCurrentAccountId();

  if (shouldUseLocalDiagramlyApi()) {
    return await callLocalDiagramlyApi<DiagramlyJobStatus>(
      `/api/chat/job-status`,
      { jobId },
      accountId,
    );
  }

  const jobStatus = await callRemote(
    `/diagramly/job-status`,
    'POST',
    {
      jobId,
      accountId
    }
  ) as DiagramlyJobStatus;

  return jobStatus;
}
