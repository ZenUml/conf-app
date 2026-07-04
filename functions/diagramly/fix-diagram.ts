import { response, OkResponse } from "../OkResponse";
import { modifyDiagram } from "../service/diagramlyService";
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

    const body: {
      diagramCode: string;
      errorMessage: string;
      diagramType: string;
    } = await request.json();

    if (!body.diagramCode) {
      return response(400, "Missing diagramCode");
    }
    if (!body.errorMessage) {
      return response(400, "Missing errorMessage");
    }

    const result = await modifyDiagram(
      { ...identity, env },
      body.diagramCode,
      body.errorMessage,
      body.diagramType
    );

    return OkResponse(result);
  } catch (e: any) {
    console.error('[fix-diagram] Error:', e.message);
    return response(500, e.message || 'Internal server error');
  }
};
