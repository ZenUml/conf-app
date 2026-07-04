import { response, OkResponse } from "../OkResponse";
import { chat } from "../service/diagramlyService";
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

    const body: { messages: Array<any> } = await request.json();
    if (!body.messages) {
      return response(400, "Missing messages");
    }

    const result = await chat({ ...identity, env }, body.messages);
    return OkResponse(result);
  } catch (e) {
    console.log(`Error: ${e}`);
    return response(500, e instanceof Error ? e.message : String(e));
  }
};
