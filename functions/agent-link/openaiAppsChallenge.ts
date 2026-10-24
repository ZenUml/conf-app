// GET /.well-known/openai-apps-challenge — the domain check OpenAI runs before
// it accepts an MCP server for the ChatGPT plugin directory. The portal issues
// a token per submission and fetches it back from this path on the MCP host;
// the body must be that token alone, as plain text — not JSON, not a list.
//
// The token comes from the OPENAI_APPS_CHALLENGE Pages variable, not from a
// file in public/: it is only known once a submission exists, and changing it
// should not need a frontend build. Unset answers 404, so the path claims
// nothing on a deploy that is not being verified.
//
// Served from _middleware.ts for the same reason as the OAuth discovery
// documents: the Pages router never routes a directory whose name starts with
// a dot. The path must also stay in public/_routes.json.

export const OPENAI_APPS_CHALLENGE_PATH = '/.well-known/openai-apps-challenge';

export interface OpenAiAppsChallengeEnv {
  OPENAI_APPS_CHALLENGE?: string;
}

export function openaiAppsChallengeResponse(
  request: Request,
  env: OpenAiAppsChallengeEnv,
): Response | null {
  if (new URL(request.url).pathname !== OPENAI_APPS_CHALLENGE_PATH) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const token = env.OPENAI_APPS_CHALLENGE?.trim();
  if (!token) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  return new Response(request.method === 'HEAD' ? null : token, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
