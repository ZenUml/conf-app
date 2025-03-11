import {ServerErrorResponse} from "./ServerErrorResponse";
import authenticate from "./utils/authenticate";
import * as Sentry from "@sentry/cloudflare";

const AUTHENTICATED_PATHS = ['/diagramly'];

// Create a middleware function that handles authentication
const authMiddleware = async ({next, request, env}) => {
  try {
    console.log('Function request url:', request.url);

    if (AUTHENTICATED_PATHS.includes(new URL(request.url).pathname)) {
      const response = await authenticate({request, env});
      if(response.status !== 200) {
        return response;
      }
    }

    return await next();
  } catch (e) {
    // Use Sentry to capture the error
    Sentry.captureException(e);
    return ServerErrorResponse();
  }
};

export const onRequest = [
  // Make sure Sentry is the first middleware
  Sentry.sentryPagesPlugin((context) => ({
    dsn: "https://d7df1008a71541aca2063f58fe7fc0bf@o571476.ingest.sentry.io/6610196",
  })),
  // Add authentication middleware
  authMiddleware
];