import { response } from "../OkResponse";
import { getDiagramlyVersions } from "../service/diagramlyService";
import { diagramlyRoute } from "./route";

export const onRequest = diagramlyRoute("versions", {
  parse: (body: { diagramId?: string }) =>
    typeof body.diagramId !== "string" || !body.diagramId.trim()
      ? response(400, "Missing diagramId")
      : { diagramId: body.diagramId },
  run: (ctx, { diagramId }) => getDiagramlyVersions(ctx, diagramId),
});
