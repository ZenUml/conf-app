import {captureError, captureUninstalledMessage} from "./utils/sentry";
import {OkResponse} from "./OkResponse";
import {postData} from "./utils/zaraz";
import {saveToBucket} from "./utils/R2Bucket";

export const onRequest: PagesFunction = async ({ request, env }) => {
  try {
    const body = await request.json() as Record<string, any>;
    captureUninstalledMessage(body.key, body.clientKey, body.baseUrl);

    const domain = body.baseUrl ? new URL(body.baseUrl).hostname : 'unknown';
    await postData(body.eventType || 'uninstalled', body.key, body.clientKey, domain);
    // @ts-ignore
    await saveToBucket(env.EVENT_BUCKET, domain, body);
  } catch (e: unknown) {
    console.log(`Error: ${e}`);
    captureError(e)
  }
  return OkResponse(undefined);
};
