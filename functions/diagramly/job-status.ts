import { response, OkResponse } from "../OkResponse";
import { callDiagramly } from "../service/diagramlyService";
import type { ForgeRequestData } from "../utils/authenticate";

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
    const body: {
      jobId: string;
      accountId: string;
      teamId?: string;
      cloudId?: string;
    } = await request.json();

    if (!body.jobId) {
      return response(400, "Missing jobId");
    }

    if (!body.accountId) {
      return response(400, "Missing accountId");
    }

    const result = await callDiagramly(
      {
        accountId: body.accountId,
        teamId: body.teamId,
        cloudId: data.forgeContext?.cloudId || body.cloudId,
        env,
      },
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
