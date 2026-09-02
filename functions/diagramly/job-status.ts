import { response, OkResponse } from "../OkResponse";
import { callDiagramly } from "../service/diagramlyService";
import type { ForgeRequestData } from "../utils/authenticate";
import { resolveDiagramlyIdentity } from "./context";

const RETRYABLE_NETWORK_ERRORS = [
  'network connection lost',
  'the network connection was lost',
  'connection reset',
  'socket hang up',
  'fetch failed',
];

function isRetryableNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLowerCase();
  return RETRYABLE_NETWORK_ERRORS.some((fragment) =>
    normalizedMessage.includes(fragment)
  );
}

async function callJobStatusWithRetry(context: any, jobId: string) {
  try {
    return await callDiagramly(
      context,
      `/api/chat/job-status`,
      { jobId }
    );
  } catch (error) {
    if (!isRetryableNetworkError(error)) {
      throw error;
    }

    // Polling is read-only and idempotent. A single retry safely recovers when
    // the upstream completed the response but the proxy connection closed
    // before Workerd consumed the final chunk.
    console.warn('[job-status] Transient upstream network error; retrying once');
    return await callDiagramly(
      context,
      `/api/chat/job-status`,
      { jobId }
    );
  }
}

export const onRequest = async ({
  request,
  env,
  data,
}: {
  request: Request;
  env: any;
  data: ForgeRequestData;
}) => {
  try {
    const identity = resolveDiagramlyIdentity(data);
    if (identity instanceof Response) {
      return identity;
    }

    const body: { jobId: string } = await request.json();
    if (!body.jobId) {
      return response(400, "Missing jobId");
    }

    const result = await callJobStatusWithRetry(
      { ...identity, env },
      body.jobId
    );

    if (!result || typeof result !== 'object') {
      return response(500, 'Invalid response from Diagramly API');
    }

    return OkResponse(result);
  } catch (e: any) {
    if (e.message?.includes('not found') || e.message?.includes('expired')) {
      return response(404, e.message);
    }

    console.error('[job-status] Error:', e.message);
    return response(500, e.message || 'Internal server error');
  }
};
