import { response, OkResponse } from "../OkResponse";
import { chat } from "../service/diagramlyService";
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
      messages: Array<any>;
      accountId: string;
      teamId: string | undefined;
      cloudId?: string;
    } = await request.json();

    if (!body.accountId) {
      return response(400, "Missing accountId");
    }
    if (!body.messages) {
      return response(400, "Missing messages");
    }

    const result = await chat(
      {
        accountId: body.accountId,
        teamId: body.teamId,
        cloudId: data.forgeContext?.cloudId || body.cloudId,
        env,
      },
      body.messages,
    );
    return OkResponse(result);
  } catch (e) {
    console.log(`Error: ${e}`);
    return response(500, e);
  }
};
