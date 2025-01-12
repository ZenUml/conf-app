import { response, OkResponse } from "./OkResponse";
import { generateDsl } from "./service/diagramlyService";

export const onRequest = async ({ request, env }) => {
  try {
    const body: {
      title: string;
      content: string;
      userPrompt: string;
      accountId: string;
      diagramType: string;
      teamId: string | undefined;
    } = await request.json();

    if (!body.accountId) {
      return response(400, "Missing accountId");
    }
    if (!body.title) {
      return response(400, "Missing title");
    }
    if (!body.content) {
      return response(400, "Missing content");
    }

    const result = await generateDsl(
      { accountId: body.accountId, teamId: body.teamId, env },
      body.title,
      body.content,
      body.userPrompt || '',
      undefined,
      body.diagramType
    );
    return OkResponse(result);
  } catch (e) {
    console.log(`Error: ${e}`);
    return response(500, e);
  }
};
