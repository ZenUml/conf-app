import { OkResponse, response } from "../OkResponse";
import { getDiagramlyVersions } from "../service/diagramlyService";
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

    const body: { diagramId?: string } = await request.json();
    if (typeof body.diagramId !== "string" || !body.diagramId.trim()) {
      return response(400, "Missing diagramId");
    }

    const result = await getDiagramlyVersions(
      { ...identity, env },
      body.diagramId,
    );
    return OkResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[versions] Error:", message);
    return response(500, message || "Internal server error");
  }
};
