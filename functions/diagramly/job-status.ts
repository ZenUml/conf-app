import { response } from "../OkResponse";
import { callDiagramly } from "../service/diagramlyService";
import { diagramlyRoute } from "./route";

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

export const onRequest = diagramlyRoute("job-status", {
  parse: (body: { jobId?: string }) =>
    body.jobId ? { jobId: body.jobId } : response(400, "Missing jobId"),
  run: async (ctx, { jobId }) => {
    let result;
    try {
      result = await callJobStatusWithRetry(ctx, jobId);
    } catch (e: any) {
      if (e.message?.includes('not found') || e.message?.includes('expired')) {
        return response(404, e.message);
      }
      throw e;
    }

    if (!result || typeof result !== 'object') {
      return response(500, 'Invalid response from Diagramly API');
    }

    return result;
  },
});
