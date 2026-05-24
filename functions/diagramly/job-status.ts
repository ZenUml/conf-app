import { response, OkResponse } from "../OkResponse";
import { callDiagramly } from "../service/diagramlyService";

export const onRequest = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const body: {
      jobId: string;
      accountId: string;
      teamId?: string;
    } = await request.json();

    if (!body.jobId) {
      return response(400, "Missing jobId");
    }

    if (!body.accountId) {
      return response(400, "Missing accountId");
    }

    const result = await callDiagramly(
      { accountId: body.accountId, teamId: body.teamId, env },
      `/api/chat/job-status`,
      { jobId: body.jobId }
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
