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
    // Log the error to console first as a fallback
    console.error('Authentication middleware error:', e);

    // Don't try to use Sentry directly here - the Sentry middleware will capture this error
    return ServerErrorResponse();
  }
};

// Make sure Sentry is the first middleware so it can capture errors from subsequent middleware
export const onRequest = [
  Sentry.sentryPagesPlugin((context) => ({
    dsn: "https://d7df1008a71541aca2063f58fe7fc0bf@o571476.ingest.sentry.io/6610196",
    // Set tracesSampleRate to 1.0 to capture 100% of spans for tracing.
    // Learn more at
    // https://docs.sentry.io/platforms/javascript/configuration/options/#traces-sample-rate
    tracesSampleRate: 1.0,
  })),
  authMiddleware
];
