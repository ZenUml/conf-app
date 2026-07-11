import { response, OkResponse } from "../OkResponse";
import { callDiagramly } from "../service/diagramlyService";
import type { ForgeRequestData } from "../utils/authenticate";
import { resolveDiagramlyIdentity } from "./context";

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

    const result = await callDiagramly(
      { ...identity, env },
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
