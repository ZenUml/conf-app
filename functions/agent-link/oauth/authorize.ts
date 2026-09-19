// GET /agent-link/oauth/authorize — start the Atlassian 3LO consent.
// All logic lives in atlassianLeg.ts so it can be tested without a Worker.
import { handleAuthorize } from './atlassianLeg';
import type { OAuthEnv } from './appConfig';

export const onRequestGet: PagesFunction<OAuthEnv> = async ({ request, env }) => {
  return handleAuthorize(request, { env, fetchImpl: (url, init) => fetch(url, init) });
};
