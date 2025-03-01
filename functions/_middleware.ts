import {captureError, ConfigToucan} from "./ConfigToucan";
import {ServerErrorResponse} from "./ServerErrorResponse";
import authenticate from "./utils/authenticate";

const AUTHENTICATED_PATHS = ['/diagramly'];

export const onRequest: PagesFunction = async ({next, request, env, waitUntil}) => {
  try {
    console.log('Function request url:', request.url);

    if (AUTHENTICATED_PATHS.includes(new URL(request.url).pathname)) {
      const response = await authenticate({request, env});
      if(response.status !== 200) {
        return response;
      }
    }

    ConfigToucan(request, waitUntil);
    return await next();
  } catch (e) {
    captureError(e);
    return ServerErrorResponse();
  }
}