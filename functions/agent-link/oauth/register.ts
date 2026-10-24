// POST /agent-link/oauth/register — RFC 7591 Dynamic Client Registration.
// The endpoint advertised as `registration_endpoint` in asMetadata.ts.
import { handleRegister } from './authServer';
import { loadGrantStore, type OAuthEnv } from './appConfig';

export const onRequestPost: PagesFunction<OAuthEnv> = async ({ request, env }) => {
  const { store } = loadGrantStore(env);
  return handleRegister(request, { store });
};
