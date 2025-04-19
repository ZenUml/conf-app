import {decode} from "./atlassian";
import {OkResponse, response} from "../OkResponse";
import {captureError} from "./sentry";
import { getInstallationData } from "./installationUtils";
import { getAuthorizationHeader } from "./requestUtils";

export default async function authenticate({ request, env }) {
  try {
    const jwt = getAuthorizationHeader(request);
    if (!jwt) {
      return response(401, 'Unauthorized: Missing or invalid Authorization header');
    }

    try {
      const installationData = await getInstallationData(env, request);
      decode(jwt, (installationData as any).sharedSecret);

      return OkResponse();
    } catch (e) {
      captureError(e);
      return response(401, 'Unauthorized: JWT validation failed');
    }

  } catch (e) {
    captureError(e);
    return response(500, `Unexpected error: ${e}`);
  }

}
