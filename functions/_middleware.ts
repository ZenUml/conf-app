import authenticate from "./utils/authenticate";
import type { ForgeRequestData } from "./utils/authenticate";
import * as Sentry from "@sentry/cloudflare";

// JSON + explicit Content-Type so this remote-facing 500 is parseable by the
// Forge bridge instead of being rejected as `text/plain` (see OkResponse.ts).
// Inlined from functions/ServerErrorResponse.ts 2026-09-02 — this was its
// only caller.
function serverErrorResponse(): Response {
  return new Response(JSON.stringify({ error: 'Something went wrong' }), {
    status: 500,
    statusText: 'Internal Server Error',
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

interface Env {
  SENTRY_DSN?: string;
}

export const AUTHENTICATED_PATHS = [
  '/diagramly',
  '/metrics-cache',
  '/forge-custom-content',
  '/forge-upload-attachment',
  '/deeplink-ticket',
  '/activation-prepared',
  '/api/diagram-impact',
  '/api/architecture-tokens',
  // Conversion queue endpoints re-verify the FIT themselves, but the claim
  // response's app identity (environmentId for the ADF extensionKey rewrite)
  // is read from the middleware-populated forgeContext — without this entry
  // the first staging job failed at stage 'claim' with an empty identity
  // (2026-08-11, job b275a201).
  '/conversion'
];

const DEEPLINK_TICKET_CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
  'access-control-max-age': '86400',
};

function isDeeplinkTicketPath(pathname: string): boolean {
  return pathname === '/deeplink-ticket' || pathname === '/deeplink-ticket/';
}

function withDeeplinkTicketCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(DEEPLINK_TICKET_CORS_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Customer deeplink paths (/d/<cloudId>/<contentId>, /i/<token>) identify a
// tenant + diagram and must never be logged verbatim
// (docs/policies/client-privacy.md). Redact to just the path prefix.
const UNLOGGED_PATH_PREFIXES = ['/d', '/i'];

export function redactedRequestUrlForLogging(url: string): string {
  const { pathname, origin } = new URL(url);
  const hit = UNLOGGED_PATH_PREFIXES.find((p) => pathname === p || pathname.startsWith(`${p}/`));
  return hit ? `${origin}${hit} [redacted]` : url;
}

// Create a middleware function that handles authentication
export const authMiddleware: PagesFunction<Env, string, ForgeRequestData> = async ({
  next,
  request,
  env,
  data,
}) => {
  try {
    console.log('Function request url:', redactedRequestUrlForLogging(request.url));

    const { pathname } = new URL(request.url);
    const isDeeplinkTicket = isDeeplinkTicketPath(pathname);
    if (isDeeplinkTicket && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: DEEPLINK_TICKET_CORS_HEADERS });
    }

    if (AUTHENTICATED_PATHS.some(path => pathname.startsWith(path))) {
      const response = await authenticate({request, env, data});
      if(response.status !== 200) {
        return isDeeplinkTicket ? withDeeplinkTicketCors(response) : response;
      }
    }

    const response = await next();
    return isDeeplinkTicket ? withDeeplinkTicketCors(response) : response;
  } catch (e) {
    // Log the error to console first as a fallback
    console.error('Authentication middleware error:', e);

    // Don't try to use Sentry directly here - the Sentry middleware will capture this error
    return serverErrorResponse();
  }
};

// Make sure Sentry is the first middleware so it can capture errors from subsequent middleware
const sentryMiddleware = Sentry.sentryPagesPlugin<Env, string, ForgeRequestData>((context) => ({
  dsn: context.env.SENTRY_DSN,
  // Set tracesSampleRate to 1.0 to capture 100% of spans for tracing.
  // Learn more at
  // https://docs.sentry.io/platforms/javascript/configuration/options/#traces-sample-rate
  tracesSampleRate: 1.0,
}));

export const onRequest = [
  sentryMiddleware,
  authMiddleware
];
