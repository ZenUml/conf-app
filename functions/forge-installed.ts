import { captureError } from "./utils/sentry";
import {OkResponse} from "./OkResponse";
import { upsertForgeInstallation } from "./utils/dbUtils";
import { ForgeAppRequestBody } from "./RequestBody";

export const onRequest: PagesFunction = async ({ request, env }) => {
  try {
    const data = await request.json() as ForgeAppRequestBody;
    console.log('forge-installed body:', data);

    await upsertForgeInstallation((env as any).DB, data);

  } catch (e) {
    console.log(`Error: ${e}`);
    captureError(e);
  }
  return OkResponse(undefined);
};
