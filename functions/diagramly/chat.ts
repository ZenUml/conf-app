import { response, OkResponse } from "../OkResponse";
import { chat } from "../service/diagramlyService";

export const onRequest = async ({ request, env }) => {
  try {
    const body: {
      messages: Array<any>;
      accountId: string;
      teamId: string | undefined;
    } = await request.json();

    if (!body.accountId) {
      return response(400, "Missing accountId");
    }
    if (!body.messages) {
      return response(400, "Missing messages");
    }

    const result = await chat( { accountId: body.accountId, teamId: body.teamId, env }, body.messages );
    return OkResponse(result);
  } catch (e) {
    console.log(`Error: ${e}`);
    return response(500, e);
  }
};
