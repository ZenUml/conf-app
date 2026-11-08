import { response } from "../OkResponse";
import { restoreDiagramlyVersion } from "../service/diagramlyService";
import { diagramlyRoute } from "./route";

export const onRequest = diagramlyRoute("restore-version", {
  parse: (body: { diagramId?: string; versionId?: string }) => {
    if (typeof body.diagramId !== "string" || !body.diagramId.trim()) {
      return response(400, "Missing diagramId");
    }
    if (typeof body.versionId !== "string" || !body.versionId.trim()) {
      return response(400, "Missing versionId");
    }
    return { diagramId: body.diagramId, versionId: body.versionId };
  },
  run: (ctx, { diagramId, versionId }) =>
    restoreDiagramlyVersion(ctx, diagramId, versionId),
});
